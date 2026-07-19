import { requireAdminApi } from '@/lib/auth';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

type SearchResult = {
  id: string;
  kind: 'client' | 'license' | 'payment';
  title: string;
  subtitle: string;
  section: 'clients' | 'licenses' | 'payments';
  search: string;
};
type ClientSearchRow = { id:string; full_name:string; email?:string|null; telegram_username?:string|null; country?:string|null; plan:string; status:string };
type LicenseSearchRow = { id:string; client_id:string; license_key:string; account_number?:string|null; platform:string; plan:string; status:string };
type PaymentSearchRow = { id:string; client_id:string; reference_id?:string|null; plan:string; method:string; status:string; amount:number|string; currency:string };

export async function GET(request: Request) {
  const { user, admin } = await requireAdminApi();
  if (!user || !admin) return jsonError('Unauthorized', 401);
  const query = normalizeQuery(new URL(request.url).searchParams.get('q'));
  if (query.length < 2) return Response.json({ results: [] }, { headers: { 'Cache-Control': 'private, no-store' } });

  const db = createSupabaseAdminClient();
  let clients: ClientSearchRow[], licenses: LicenseSearchRow[], payments: PaymentSearchRow[];
  try {
    [clients, licenses, payments] = await Promise.all([
      readAll<ClientSearchRow>((from, to) => db.from('clients').select('id,full_name,email,telegram_username,country,plan,status').order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
      readAll<LicenseSearchRow>((from, to) => db.from('licenses').select('id,client_id,license_key,account_number,platform,plan,status').order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
      readAll<PaymentSearchRow>((from, to) => db.from('client_payments').select('id,client_id,reference_id,plan,method,status,amount,currency').order('updated_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
    ]);
  } catch {
    return jsonError('Command search is temporarily unavailable', 500);
  }
  const clientNames = new Map(clients.map((client) => [client.id, client.full_name]));
  const results: SearchResult[] = [];

  for (const client of clients) {
    if (!matches(query, client.full_name, client.email, client.telegram_username, client.country, client.plan, client.status)) continue;
    results.push({ id: client.id, kind: 'client', title: client.full_name, subtitle: `${client.plan} · ${client.status}${client.country ? ` · ${client.country}` : ''}`, section: 'clients', search: client.full_name });
    if (results.filter((result) => result.kind === 'client').length === 7) break;
  }

  for (const license of licenses) {
    const clientName = clientNames.get(license.client_id) || 'Client record';
    if (!matches(query, license.license_key, license.account_number, license.platform, license.plan, license.status, clientName)) continue;
    results.push({ id: license.id, kind: 'license', title: license.license_key, subtitle: `${clientName} · ${license.platform} ${license.plan} · ${license.status}`, section: 'licenses', search: license.license_key });
    if (results.filter((result) => result.kind === 'license').length === 7) break;
  }

  for (const payment of payments) {
    const clientName = clientNames.get(payment.client_id) || 'Client record';
    if (!matches(query, payment.reference_id, payment.plan, payment.method, payment.status, payment.currency, String(payment.amount), clientName)) continue;
    const reference = payment.reference_id || `${payment.currency} ${Number(payment.amount).toLocaleString()}`;
    results.push({ id: payment.id, kind: 'payment', title: reference, subtitle: `${clientName} · ${payment.plan} · ${payment.status}`, section: 'payments', search: payment.reference_id || clientName });
    if (results.filter((result) => result.kind === 'payment').length === 7) break;
  }

  return Response.json({ results: results.slice(0, 18) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

function normalizeQuery(value: string | null) {
  return (value || '').normalize('NFKC').trim().toLocaleLowerCase().slice(0, 120);
}

function matches(query: string, ...values: unknown[]) {
  return values.some((value) => typeof value === 'string' && value.normalize('NFKC').toLocaleLowerCase().includes(query));
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function readAll<T>(readPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = [];
  const pageSize = 1_000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error('Command search row limit exceeded');
}
