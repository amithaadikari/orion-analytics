import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/security';

const clientSchema = z.object({
  full_name: z.string().trim().min(2).max(120), email: z.string().trim().email().or(z.literal('')).optional(),
  telegram_username: z.string().trim().max(80).optional(), phone: z.string().trim().max(40).optional(), country: z.string().trim().max(80).optional(),
  plan: z.enum(['Basic', 'Premium', 'Lifetime']), status: z.enum(['Active', 'Expired', 'Suspended']), notes: z.string().trim().max(2000).optional()
});
const licenseSchema = z.object({ client_id: z.string().uuid(), license_key: z.string().trim().min(8).max(120), platform: z.enum(['MT4', 'MT5']), account_number: z.string().trim().max(80).optional(), plan: z.enum(['Basic', 'Premium', 'Lifetime']), status: z.enum(['Active', 'Expired', 'Suspended']), expires_at: z.string().nullable().optional() });
const paymentSchema = z.object({ client_id: z.string().uuid(), method: z.enum(['Crypto','Bank Transfer','Card','PayPal','Wise','Skrill','Cash','Other']), status: z.enum(['Pending','Paid','Failed','Refunded','Disputed','Manually verified']), amount: z.coerce.number().min(0).max(100000000), currency: z.string().trim().min(3).max(6), payment_date: z.string().nullable().optional(), reference_id: z.string().trim().max(160).optional(), notes: z.string().trim().max(1000).optional() });

async function session(write = false) {
  const auth = await requireAdminApi();
  if (!auth.user || !auth.admin) return null;
  if (write && auth.admin.role !== 'admin') return null;
  return auth;
}

export async function GET() {
  const auth = await session();
  if (!auth) return jsonError('Unauthorized', 401);
  const db = createSupabaseAdminClient();
  const [clients, licenses, payments, activity] = await Promise.all([
    db.from('clients').select('*').order('created_at', { ascending: false }).limit(5000),
    db.from('licenses').select('*').order('created_at', { ascending: false }).limit(5000),
    db.from('client_payments').select('*').order('created_at', { ascending: false }).limit(5000),
    db.from('client_activity').select('*').order('created_at', { ascending: false }).limit(10000)
  ]);
  const error = clients.error || licenses.error || payments.error || activity.error;
  if (error) return jsonError(error.message.includes('does not exist') ? 'Phase 3 database migration has not been applied yet.' : 'Unable to load business data', 500);
  const clientRows = clients.data || []; const licenseRows = licenses.data || []; const paymentRows = payments.data || []; const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); const today = now.toISOString().slice(0, 10);
  const paid = paymentRows.filter((row) => ['Paid', 'Manually verified'].includes(row.status));
  const sum = (rows: typeof paymentRows) => rows.reduce((total, row) => total + Number(row.amount || 0), 0);
  return Response.json({
    clients: clientRows, licenses: licenseRows, payments: paymentRows, activity: activity.data || [],
    metrics: { totalClients: clientRows.length, activeClients: clientRows.filter((row) => row.status === 'Active').length, expiringLicenses: licenseRows.filter((row) => row.status === 'Active' && row.expires_at && new Date(row.expires_at) <= new Date(Date.now() + 30 * 86400000)).length, pendingPayments: paymentRows.filter((row) => row.status === 'Pending').length, revenueToday: sum(paid.filter((row) => row.payment_date === today)), revenueMonth: sum(paid.filter((row) => row.payment_date && new Date(row.payment_date) >= monthStart)) }
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const auth = await session(true); if (!auth) return jsonError('Admin access required', 403);
  const body = await request.json().catch(() => null); if (!body || typeof body !== 'object') return jsonError('Invalid request');
  const db = createSupabaseAdminClient(); const resource = String(body.resource || ''); let parsed; let table = ''; let action = '';
  if (resource === 'client') { parsed = clientSchema.safeParse(body.data); table = 'clients'; action = 'Client created'; }
  else if (resource === 'license') { parsed = licenseSchema.safeParse(body.data); table = 'licenses'; action = 'License generated'; }
  else if (resource === 'payment') { parsed = paymentSchema.safeParse(body.data); table = 'client_payments'; action = 'Payment recorded'; }
  else return jsonError('Unknown resource');
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid data');
  const payload = clean(parsed.data); const { data, error } = await db.from(table).insert(payload).select('*').single();
  if (error) return jsonError(error.message, 400);
  const clientId = resource === 'client' ? data.id : data.client_id;
  await db.from('client_activity').insert({ client_id: clientId, action, details: describe(resource, data), actor_email: auth.admin!.email });
  return Response.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await session(true); if (!auth) return jsonError('Admin access required', 403);
  const body = await request.json().catch(() => null); if (!body?.id) return jsonError('Missing record id');
  const schemas = { client: clientSchema.partial(), license: licenseSchema.partial(), payment: paymentSchema.partial() } as const;
  const tables = { client: 'clients', license: 'licenses', payment: 'client_payments' } as const; const resource = body.resource as keyof typeof schemas;
  if (!schemas[resource]) return jsonError('Unknown resource'); const parsed = schemas[resource].safeParse(body.data); if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid data');
  const db = createSupabaseAdminClient(); const { data, error } = await db.from(tables[resource]).update(clean(parsed.data)).eq('id', body.id).select('*').single(); if (error) return jsonError(error.message, 400);
  const clientId = resource === 'client' ? data.id : data.client_id; await db.from('client_activity').insert({ client_id: clientId, action: `${resource[0].toUpperCase()}${resource.slice(1)} updated`, details: describe(resource, data), actor_email: auth.admin!.email });
  return Response.json(data);
}

export async function DELETE(request: Request) {
  const auth = await session(true); if (!auth) return jsonError('Admin access required', 403);
  const body = await request.json().catch(() => null);
  const resource = body?.resource as 'client' | 'license' | 'payment';
  const id = z.string().uuid().safeParse(body?.id);
  if (!id.success || !['client', 'license', 'payment'].includes(resource)) return jsonError('Invalid delete request');
  const tables = { client: 'clients', license: 'licenses', payment: 'client_payments' } as const;
  const db = createSupabaseAdminClient();
  const { data: existing, error: findError } = await db.from(tables[resource]).select('*').eq('id', id.data).single();
  if (findError || !existing) return jsonError('Record not found', 404);
  const clientId = resource === 'client' ? existing.id : existing.client_id;
  if (resource !== 'client') {
    await db.from('client_activity').insert({
      client_id: clientId,
      action: `${resource[0].toUpperCase()}${resource.slice(1)} deleted`,
      details: describe(resource, existing),
      actor_email: auth.admin!.email
    });
  }
  const { error } = await db.from(tables[resource]).delete().eq('id', id.data);
  if (error) return jsonError(error.message, 400);
  return Response.json({ ok: true });
}

function clean<T extends Record<string, unknown>>(value: T) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === '' ? null : item])); }
function describe(resource: string, data: Record<string, unknown>) { if (resource === 'payment') return `${data.status} · ${data.currency} ${data.amount} · ${data.method}`; if (resource === 'license') return `${data.license_key} · ${data.platform} · ${data.status}`; return `${data.full_name} · ${data.plan} · ${data.status}`; }
