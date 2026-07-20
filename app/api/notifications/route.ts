import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const limitSchema = z.coerce.number().int().min(1).max(100).default(30);
const updateSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.array(z.string().uuid()).min(1).max(100).optional(),
  all: z.literal(true).optional(),
  read: z.boolean().default(true),
}).superRefine((value, context) => {
  const selectors = [Boolean(value.id), Boolean(value.ids), Boolean(value.all)].filter(Boolean).length;
  if (selectors === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose one or more notifications, or mark all notifications.' });
  if (selectors > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Use only one notification selector at a time.' });
});

export async function GET(request: Request) {
  const { user, client } = await getPortalSession();
  if (!user) return jsonError('Authentication required', 401);
  if (!client) return jsonError('A linked client account is required', 403);

  const url = new URL(request.url);
  const limit = limitSchema.safeParse(url.searchParams.get('limit') || undefined);
  if (!limit.success) return jsonError('Invalid notification limit');

  const db = createSupabaseAdminClient();
  const [linkedRowsResult, unreadResult] = await Promise.all([
    db.from('client_notifications')
      .select('id,ticket_id,kind,title,message,href,read_at,created_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(limit.data),
    db.from('client_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('read_at', null),
  ]);
  // Keep the portal available during a rolling deployment where the application
  // can arrive shortly before the migration that adds support-ticket links.
  const rowsResult = linkedRowsResult.error && isMissingTicketLinkColumn(linkedRowsResult.error)
    ? await db.from('client_notifications')
      .select('id,kind,title,message,href,read_at,created_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(limit.data)
    : linkedRowsResult;
  if (rowsResult.error || unreadResult.error) return jsonError('Notifications are temporarily unavailable', 500);

  const notifications = (rowsResult.data || []).map((notification) => {
    const row = notification as typeof notification & { ticket_id?: unknown };
    const { ticket_id: ticketId, ...publicRow } = row;
    return {
      ...publicRow,
      ticketId: typeof ticketId === 'string' ? ticketId : null,
      href: safeInternalHref(publicRow.href),
    };
  });
  return Response.json({ notifications, unreadCount: Number(unreadResult.count || 0) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function PATCH(request: Request) {
  const { user, client } = await getPortalSession();
  if (!user) return jsonError('Authentication required', 401);
  if (!client) return jsonError('A linked client account is required', 403);
  if (!rateLimit(request, `portal-notifications:${user.id}`).allowed) return jsonError('Too many notification updates', 429);

  let body: unknown;
  try { body = await readJson(request, 4_000); } catch { return jsonError('Invalid notification update'); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid notification update');

  const db = createSupabaseAdminClient();
  const readAt = parsed.data.read ? new Date().toISOString() : null;
  let query = db.from('client_notifications').update({ read_at: readAt }).eq('client_id', client.id);
  if (parsed.data.id) query = query.eq('id', parsed.data.id);
  else if (parsed.data.ids) query = query.in('id', [...new Set(parsed.data.ids)]);
  else query = parsed.data.read ? query.is('read_at', null) : query.not('read_at', 'is', null);
  const { data, error } = await query.select('id,read_at');
  if (error) return jsonError('Unable to update notifications', 500);
  if (parsed.data.id && !data?.length) return jsonError('Notification not found', 404);

  const { count, error: countError } = await db.from('client_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .is('read_at', null);
  return Response.json({ updated: data?.length || 0, ...(countError ? {} : { unreadCount: Number(count || 0) }) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function safeInternalHref(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://portal.invalid');
    if (url.origin !== 'https://portal.invalid') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function isMissingTicketLinkColumn(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || '';
  return error.code === '42703'
    || error.code === 'PGRST204'
    || (message.includes('ticket_id') && (message.includes('column') || message.includes('schema cache')));
}
