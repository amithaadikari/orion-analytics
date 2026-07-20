import { requireAdminApi } from '@/lib/auth';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type PaymentAmountRow = {
  id: string;
  amount: number | string;
  currency: string;
};

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function GET() {
  const { user, admin } = await requireAdminApi();
  if (!user || !admin) return jsonError('Unauthorized', 401);

  try {
    const db = createSupabaseAdminClient();
    const payments = await readAll<PaymentAmountRow>((from, to) => db
      .from('client_payments')
      .select('id,amount,currency')
      .in('status', ['Paid', 'Manually verified'])
      .order('id', { ascending: true })
      .range(from, to));

    const totals = new Map<string, { amount: number; count: number }>();
    payments.forEach((payment) => {
      const currency = payment.currency.trim().toUpperCase() || 'UNSPECIFIED';
      const current = totals.get(currency) || { amount: 0, count: 0 };
      current.amount += Number(payment.amount || 0);
      current.count += 1;
      totals.set(currency, current);
    });

    return Response.json({
      currencies: [...totals.entries()]
        .map(([currency, total]) => ({ currency, ...total }))
        .sort((left, right) => left.currency.localeCompare(right.currency)),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return jsonError('Unable to load all-time sales totals', 500);
  }
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
    if (from >= 100_000) throw new Error('Sales summary row limit exceeded');
  }
}
