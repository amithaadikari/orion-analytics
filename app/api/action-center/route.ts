import { requireAdminApi } from '@/lib/auth';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

type ClientQueueRow = {
  id: string;
  full_name: string;
  country?: string | null;
  plan: string;
  status: string;
  created_at: string;
};

type PaymentQueueRow = {
  id: string;
  client_id: string;
  plan: string;
  method: string;
  amount: number;
  currency: string;
  payment_date?: string | null;
  created_at: string;
};

type LicenseQueueRow = {
  id: string;
  client_id: string;
  platform: string;
  plan: string;
  expires_at: string;
};

export async function GET() {
  const { user, admin } = await requireAdminApi();
  if (!user || !admin || admin.role !== 'admin') return jsonError('Admin access required', 403);

  const db = createSupabaseAdminClient();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryStart = new Date(todayUtc).toISOString();
  const expiryEnd = new Date(todayUtc + 31 * 86_400_000 - 1).toISOString();

  let [
    pendingRegistrationCount,
    pendingRegistrationRows,
    freeRegistrationCount,
    freeRegistrationRows,
    pendingPaymentCount,
    pendingPaymentRows,
    expiringLicenseCount,
    expiringLicenseRows,
    suspendedClientCount,
    suspendedClientRows,
  ] = await Promise.all([
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'Pending').is('reviewed_at', null),
    db.from('clients').select('id,full_name,country,plan,status,created_at').eq('status', 'Pending').is('reviewed_at', null).order('created_at', { ascending: true }).limit(8),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('plan', 'Free').not('auth_user_id', 'is', null).neq('status', 'Pending').is('reviewed_at', null),
    db.from('clients').select('id,full_name,country,plan,status,created_at').eq('plan', 'Free').not('auth_user_id', 'is', null).neq('status', 'Pending').is('reviewed_at', null).order('created_at', { ascending: false }).limit(8),
    db.from('client_payments').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    db.from('client_payments').select('id,client_id,plan,method,amount,currency,payment_date,created_at').eq('status', 'Pending').order('created_at', { ascending: true }).limit(8),
    db.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'Active').gte('expires_at', expiryStart).lte('expires_at', expiryEnd),
    db.from('licenses').select('id,client_id,platform,plan,expires_at').eq('status', 'Active').gte('expires_at', expiryStart).lte('expires_at', expiryEnd).order('expires_at', { ascending: true }).limit(8),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'Suspended'),
    db.from('clients').select('id,full_name,country,plan,status,created_at').eq('status', 'Suspended').order('created_at', { ascending: false }).limit(8),
  ]);

  const reviewSchemaMissing = [pendingRegistrationCount, pendingRegistrationRows, freeRegistrationCount, freeRegistrationRows]
    .some((result) => result.error?.message.includes('reviewed_at'));
  if (reviewSchemaMissing) {
    [pendingRegistrationCount, pendingRegistrationRows, freeRegistrationCount, freeRegistrationRows] = await Promise.all([
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
      db.from('clients').select('id,full_name,country,plan,status,created_at').eq('status', 'Pending').order('created_at', { ascending: true }).limit(8),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('plan', 'Free').not('auth_user_id', 'is', null).neq('status', 'Pending'),
      db.from('clients').select('id,full_name,country,plan,status,created_at').eq('plan', 'Free').not('auth_user_id', 'is', null).neq('status', 'Pending').order('created_at', { ascending: false }).limit(8),
    ]);
  }

  const results = [pendingRegistrationCount, pendingRegistrationRows, freeRegistrationCount, freeRegistrationRows, pendingPaymentCount, pendingPaymentRows, expiringLicenseCount, expiringLicenseRows, suspendedClientCount, suspendedClientRows];
  if (results.some((result) => result.error)) return jsonError('Unable to load the action center', 500);

  const payments = (pendingPaymentRows.data || []) as PaymentQueueRow[];
  const licenses = (expiringLicenseRows.data || []) as LicenseQueueRow[];
  const linkedClientIds = [...new Set([...payments.map((row) => row.client_id), ...licenses.map((row) => row.client_id)])];
  const linkedClients = linkedClientIds.length
    ? await db.from('clients').select('id,full_name').in('id', linkedClientIds)
    : { data: [], error: null };
  if (linkedClients.error) return jsonError('Unable to load action details', 500);
  const clientNames = new Map((linkedClients.data || []).map((row) => [row.id, row.full_name]));

  const registrations = [
    ...((pendingRegistrationRows.data || []) as ClientQueueRow[]),
    ...((freeRegistrationRows.data || []) as ClientQueueRow[]),
  ].sort((left, right) => left.created_at.localeCompare(right.created_at)).slice(0, 8);
  const suspended = (suspendedClientRows.data || []) as ClientQueueRow[];

  const counts = {
    registrations: Number(pendingRegistrationCount.count || 0) + Number(freeRegistrationCount.count || 0),
    payments: Number(pendingPaymentCount.count || 0),
    licenses: Number(expiringLicenseCount.count || 0),
    suspended: Number(suspendedClientCount.count || 0),
  };

  return Response.json({
    counts: { ...counts, total: counts.registrations + counts.payments + counts.licenses + counts.suspended },
    queues: {
      registrations: registrations.map((row) => ({
        id: row.id,
        label: row.full_name,
        detail: `${row.plan} plan · ${row.status}`,
        context: row.country || 'Country not set',
        date: row.created_at,
      })),
      payments: payments.map((row) => ({
        id: row.id,
        label: clientNames.get(row.client_id) || 'Client record',
        detail: `${row.currency} ${Number(row.amount).toLocaleString()} · ${row.method}`,
        context: `${row.plan} plan · Pending verification`,
        date: row.payment_date || row.created_at,
        amount: Number(row.amount),
        currency: row.currency,
      })),
      licenses: licenses.map((row) => ({
        id: row.id,
        label: clientNames.get(row.client_id) || 'Client record',
        detail: `${row.platform} · ${row.plan}`,
        context: 'Active license nearing expiry',
        date: row.expires_at,
        expires_at: row.expires_at,
        days_remaining: utcCalendarDays(row.expires_at, todayUtc),
      })),
      suspended: suspended.map((row) => ({
        id: row.id,
        label: row.full_name,
        detail: `${row.plan} plan · Suspended status`,
        context: row.country || 'Country not set',
        date: row.created_at,
      })),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

function utcCalendarDays(value: string, todayUtc: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const expiryUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((expiryUtc - todayUtc) / 86_400_000);
}
