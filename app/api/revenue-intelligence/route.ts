import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  calculateRevenueIntelligence,
  type RevenueClientRecord,
  type RevenueGoalRecord,
  type RevenueLicenseRecord,
  type RevenuePaymentRecord,
} from '@/lib/revenue-intelligence';

export const dynamic = 'force-dynamic';

const goalSchema = z.object({
  period_month: z.string().regex(/^\d{4}-\d{2}-01$/).refine(validPeriodMonth, 'Invalid goal month'),
  currency: z.string().trim().length(3).regex(/^[a-zA-Z]{3}$/).transform((value) => value.toUpperCase()),
  target_amount: z.coerce.number().positive().max(999_999_999_999.99),
});

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function GET() {
  const { user, admin } = await requireAdminApi();
  if (!user || !admin) return jsonError('Unauthorized', 401);

  try {
    const db = createSupabaseAdminClient();
    const now = new Date();
    const periodMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const [clients, licenses, payments, goals] = await Promise.all([
      readAll<RevenueClientRecord>((from, to) => db.from('clients').select('id,full_name').order('id', { ascending: true }).range(from, to)),
      readAll<RevenueLicenseRecord>((from, to) => db.from('licenses').select('id,client_id,plan,status,platform,account_number,issued_at,expires_at').eq('status', 'Active').order('id', { ascending: true }).range(from, to)),
      readAll<RevenuePaymentRecord>((from, to) => db.from('client_payments').select('id,client_id,license_id,plan,status,amount,currency,payment_date,created_at,updated_at').order('id', { ascending: true }).range(from, to)),
      readAll<RevenueGoalRecord>((from, to) => db.from('revenue_goals').select('id,period_month,currency,target_amount,created_by,updated_at').eq('period_month', periodMonth).order('currency', { ascending: true }).range(from, to)),
    ]);

    return Response.json({
      ...calculateRevenueIntelligence({ clients, licenses, payments, goals }, now),
      canEditGoals: admin.role === 'admin',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return jsonError('Unable to load revenue intelligence', 500);
  }
}

export async function POST(request: Request) {
  const { user, admin } = await requireAdminApi();
  if (!user || !admin) return jsonError('Unauthorized', 401);
  if (admin.role !== 'admin') return jsonError('Admin access required to update revenue goals', 403);

  const parsed = goalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid revenue goal');

  const { data, error } = await createSupabaseAdminClient()
    .from('revenue_goals')
    .upsert({
      period_month: parsed.data.period_month,
      currency: parsed.data.currency,
      target_amount: parsed.data.target_amount,
      created_by: admin.email || user.email || user.id,
    }, { onConflict: 'period_month,currency' })
    .select('id,period_month,currency,target_amount,created_by,updated_at')
    .single();

  if (error) return jsonError('Unable to save the revenue goal', 500);
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function readAll<T>(readPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = [];
  const pageSize = 1_000;
  let from = 0;

  while (true) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    from += pageSize;
    if (from >= 100_000) throw new Error('Revenue intelligence row limit exceeded');
  }
}

function validPeriodMonth(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
