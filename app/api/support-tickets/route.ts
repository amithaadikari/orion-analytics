import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const categories = ['General', 'License', 'Payment', 'Setup', 'Technical'] as const;
const priorities = ['Low', 'Normal', 'High', 'Urgent'] as const;
const statuses = ['Open', 'Waiting on client', 'In progress', 'Resolved', 'Closed'] as const;

const listSchema = z.object({
  ticketId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  status: z.enum(statuses).optional(),
  scope: z.enum(['self']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
const createSchema = z.object({
  clientId: z.string().uuid().optional(),
  subject: z.string().trim().min(4).max(180),
  category: z.enum(categories),
  priority: z.enum(priorities).default('Normal'),
  message: z.string().trim().min(1).max(4000),
});
const updateSchema = z.object({
  ticketId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000).optional(),
  status: z.enum(statuses).optional(),
  priority: z.enum(priorities).optional(),
}).refine((value) => value.message || value.status || value.priority, 'Add a reply or choose a ticket update.');

export async function GET(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (!session.admin && !session.client) return jsonError('A linked Orion account is required', 403);

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    ticketId: url.searchParams.get('ticketId') || undefined,
    clientId: url.searchParams.get('clientId') || undefined,
    status: url.searchParams.get('status') || undefined,
    scope: url.searchParams.get('scope') || undefined,
    limit: url.searchParams.get('limit') || undefined,
  });
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid support-ticket query');
  const selfScope = parsed.data.scope === 'self';
  if (selfScope && !session.client) return jsonError('A linked client account is required for the client portal', 403);
  if ((!session.admin || selfScope) && parsed.data.clientId) return jsonError('Client filtering is available only to administrators', 403);

  const db = createSupabaseAdminClient();
  let query = db.from('support_tickets')
    .select('id,client_id,subject,category,priority,status,created_at,updated_at,closed_at,clients(full_name,email)')
    .order('updated_at', { ascending: false })
    .limit(parsed.data.limit);
  if (session.client && (!session.admin || selfScope)) query = query.eq('client_id', session.client.id);
  if (session.admin && !selfScope && parsed.data.clientId) query = query.eq('client_id', parsed.data.clientId);
  if (parsed.data.ticketId) query = query.eq('id', parsed.data.ticketId);
  if (parsed.data.status) query = query.eq('status', parsed.data.status);

  const { data: tickets, error } = await query;
  if (error) return jsonError('Support tickets are temporarily unavailable', 500);
  const ticketIds = (tickets || []).map((ticket) => ticket.id);
  let messages: Record<string, unknown>[] = [];
  if (ticketIds.length) {
    let messageQuery = db.from('support_ticket_messages')
      .select('id,ticket_id,client_id,author_type,body,created_at')
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: true })
      .limit(2000);
    if (session.client && (!session.admin || selfScope)) messageQuery = messageQuery.eq('client_id', session.client.id);
    const messageResult = await messageQuery;
    if (messageResult.error) return jsonError('Support messages are temporarily unavailable', 500);
    messages = messageResult.data || [];
  }

  return Response.json({
    actor: {
      type: session.admin && !selfScope ? 'admin' : 'client',
      canManage: !selfScope && session.admin?.role === 'admin',
    },
    tickets: (tickets || []).map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      closedAt: ticket.closed_at,
      client: session.admin && !selfScope ? clientSummary(ticket.clients) : undefined,
      messages: messages.filter((message) => message.ticket_id === ticket.id).map((message) => ({
        id: message.id,
        authorType: message.author_type,
        body: message.body,
        createdAt: message.created_at,
      })),
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (!session.admin && !session.client) return jsonError('A linked Orion account is required', 403);
  if (!rateLimit(request, `support-create:${session.user.id}`).allowed) return jsonError('Too many support requests', 429);
  const scope = readScope(request);
  if (scope === 'invalid') return jsonError('Invalid support scope');
  const selfScope = scope === 'self';
  if (selfScope && !session.client) return jsonError('A linked client account is required for the client portal', 403);
  const actingAdmin = selfScope ? null : session.admin;

  let body: unknown;
  try { body = await readJson(request, 8_000); } catch { return jsonError('Invalid support request'); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid support request');
  if (actingAdmin && actingAdmin.role !== 'admin') return jsonError('Admin write access required', 403);
  if (actingAdmin && !parsed.data.clientId) return jsonError('Choose a client for this ticket');
  if (!actingAdmin && parsed.data.clientId) return jsonError('Clients cannot create tickets for another account', 403);

  const clientId = actingAdmin ? parsed.data.clientId! : session.client!.id;
  const db = createSupabaseAdminClient();
  if (actingAdmin) {
    const { data: target } = await db.from('clients').select('id').eq('id', clientId).maybeSingle();
    if (!target) return jsonError('Client not found', 404);
  }

  const { data: ticketId, error } = await db.rpc('create_support_ticket_atomic', {
    p_client_id: clientId,
    p_subject: parsed.data.subject,
    p_category: parsed.data.category,
    p_priority: parsed.data.priority,
    p_author_type: actingAdmin ? 'Admin' : 'Client',
    p_author_email: actingAdmin?.email || session.user.email || null,
    p_message: parsed.data.message,
  });
  if (error || !ticketId) return jsonError(error?.message.includes('function') ? 'Apply the command-suite migration before using support tickets' : 'Unable to create the support ticket', error?.message.includes('function') ? 503 : 500);
  return Response.json({ ticketId }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (!session.admin && !session.client) return jsonError('A linked Orion account is required', 403);
  if (!rateLimit(request, `support-update:${session.user.id}`).allowed) return jsonError('Too many support updates', 429);
  const scope = readScope(request);
  if (scope === 'invalid') return jsonError('Invalid support scope');
  const selfScope = scope === 'self';
  if (selfScope && !session.client) return jsonError('A linked client account is required for the client portal', 403);
  const actingAdmin = selfScope ? null : session.admin;

  let body: unknown;
  try { body = await readJson(request, 8_000); } catch { return jsonError('Invalid support update'); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid support update');
  if (actingAdmin && actingAdmin.role !== 'admin') return jsonError('Admin write access required', 403);
  if (!actingAdmin && parsed.data.priority) return jsonError('Ticket priority can be changed only by Orion support', 403);
  if (!actingAdmin && parsed.data.status && parsed.data.status !== 'Closed') return jsonError('Clients may close a ticket, but cannot set internal support states', 403);

  const db = createSupabaseAdminClient();
  let ticketQuery = db.from('support_tickets').select('id,client_id,subject,status,priority').eq('id', parsed.data.ticketId);
  if (session.client && (!session.admin || selfScope)) ticketQuery = ticketQuery.eq('client_id', session.client.id);
  const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();
  if (ticketError || !ticket) return jsonError('Support ticket not found', 404);
  if (ticket.status === 'Closed' && parsed.data.message && parsed.data.status === undefined) return jsonError('Choose a new status before replying to a closed ticket', 409);

  const nextStatus = parsed.data.status || (parsed.data.message ? (actingAdmin ? 'Waiting on client' : 'Open') : ticket.status);
  const priority = parsed.data.priority || ticket.priority;
  const { data: updated, error: updateError } = await db.rpc('update_support_ticket_atomic', {
    p_ticket_id: ticket.id,
    p_client_id: ticket.client_id,
    p_message: parsed.data.message || null,
    p_author_type: actingAdmin ? 'Admin' : 'Client',
    p_author_email: actingAdmin?.email || session.user.email || null,
    p_status: nextStatus,
    p_priority: priority,
  });
  if (updateError) return jsonError(updateError.message.includes('function') ? 'Apply the command-suite migration before using support tickets' : 'Unable to update the support ticket safely', updateError.message.includes('function') ? 503 : 500);
  if (!updated) return jsonError('This ticket changed while you were replying. Refresh it before trying again.', 409);
  return Response.json({ ok: true, ticketId: ticket.id, status: nextStatus, priority }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function clientSummary(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const client = row as { full_name?: unknown; email?: unknown };
  return {
    fullName: typeof client.full_name === 'string' ? client.full_name : 'Orion client',
    email: typeof client.email === 'string' ? client.email : null,
  };
}

function readScope(request: Request) {
  const value = new URL(request.url).searchParams.get('scope');
  if (value === null) return null;
  return value === 'self' ? 'self' as const : 'invalid' as const;
}
