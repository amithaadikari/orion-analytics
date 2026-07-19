export type RevenueClientRecord = {
  id: string;
  full_name: string;
};

export type RevenueLicenseRecord = {
  id: string;
  client_id: string;
  plan: string;
  status: string;
  platform: string;
  account_number?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
};

export type RevenuePaymentRecord = {
  id: string;
  client_id: string;
  license_id?: string | null;
  plan: string;
  status: string;
  amount: number | string;
  currency: string;
  payment_date?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type RevenueGoalRecord = {
  id?: string;
  period_month: string;
  currency: string;
  target_amount: number | string;
  created_by?: string | null;
  updated_at?: string | null;
};

export type CurrencyAmount = {
  currency: string;
  amount: number;
};

export type MrrCurrency = CurrencyAmount & {
  licenseCount: number;
};

export type RenewalEntry = {
  licenseId: string;
  clientId: string;
  clientName: string;
  plan: string;
  platform: string;
  accountNumber: string | null;
  expiresOn: string;
  daysRemaining: number;
};

export type GoalProgress = {
  currency: string;
  actualAmount: number;
  targetAmount: number | null;
  progressPercent: number | null;
};

export type ExceptionStatus = 'Refunded' | 'Failed' | 'Disputed';

export type ExceptionKpi = {
  status: ExceptionStatus;
  count: number;
  amounts: CurrencyAmount[];
};

export type ExceptionTrendPoint = {
  periodStart: string;
  periodEnd: string;
  label: string;
  refunded: number;
  failed: number;
  disputed: number;
  total: number;
};

export type CurrencySummary = {
  currency: string;
  revenueMonth: number;
  normalizedMrr: number;
  goalTarget: number | null;
  goalProgressPercent: number | null;
  refunded90d: number;
  failed90d: number;
  disputed90d: number;
};

export type RevenueIntelligenceSnapshot = {
  generatedAt: string;
  periodMonth: string;
  monthLabel: string;
  methodology: string[];
  mrr: {
    byCurrency: MrrCurrency[];
    eligibleLicenseCount: number;
    matchedLicenseCount: number;
    unmatchedLicenseCount: number;
    excludedLifetimeCount: number;
  };
  renewals: {
    windowStart: string;
    windowEnd: string;
    entries: RenewalEntry[];
  };
  goals: GoalProgress[];
  exceptions: {
    windowStart: string;
    windowEnd: string;
    kpis: ExceptionKpi[];
    trend: ExceptionTrendPoint[];
  };
  currencies: CurrencySummary[];
};

type RevenueIntelligenceInput = {
  clients: RevenueClientRecord[];
  licenses: RevenueLicenseRecord[];
  payments: RevenuePaymentRecord[];
  goals: RevenueGoalRecord[];
};

const DAY_MS = 86_400_000;
const completedStatuses = new Set(['Paid', 'Manually verified']);
const exceptionStatuses: ExceptionStatus[] = ['Refunded', 'Failed', 'Disputed'];
const termMonths: Record<string, number> = { Basic: 1, Premium: 3 };

export function calculateRevenueIntelligence(input: RevenueIntelligenceInput, now = new Date()): RevenueIntelligenceSnapshot {
  const nowMs = now.getTime();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const today = isoDay(todayMs);
  const periodMonth = isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const renewalEndMs = todayMs + 90 * DAY_MS;
  const exceptionStartMs = todayMs - 89 * DAY_MS;
  const exceptionEndMs = todayMs + DAY_MS - 1;
  const clientNames = new Map(input.clients.map((client) => [client.id, client.full_name]));

  const completedPayments = input.payments
    .filter((payment) => completedStatuses.has(payment.status) && validAmount(payment.amount) > 0 && Boolean(normalizeCurrency(payment.currency)))
    .sort(comparePaymentsNewestFirst);

  const eligibleLicenses = input.licenses
    .filter((license) => {
      const expiry = expiryEndTimestamp(license.expires_at);
      return license.status === 'Active' && Boolean(termMonths[license.plan]) && expiry !== null && expiry >= nowMs;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const excludedLifetimeCount = input.licenses.filter((license) => {
    const expiry = expiryEndTimestamp(license.expires_at);
    return license.plan === 'Lifetime' && license.status === 'Active' && (expiry === null || expiry >= nowMs);
  }).length;

  const usedPaymentIds = new Set<string>();
  const mrrTotals = new Map<string, { amount: number; licenseCount: number }>();
  let matchedLicenseCount = 0;

  for (const license of eligibleLicenses) {
    const payment = completedPayments.find((candidate) => {
      if (usedPaymentIds.has(candidate.id) || candidate.client_id !== license.client_id || candidate.plan !== license.plan) return false;
      return !candidate.license_id || candidate.license_id === license.id;
    });
    if (!payment) continue;
    const currency = normalizeCurrency(payment.currency);
    if (!currency) continue;
    usedPaymentIds.add(payment.id);
    matchedLicenseCount += 1;
    const current = mrrTotals.get(currency) || { amount: 0, licenseCount: 0 };
    current.amount += validAmount(payment.amount) / termMonths[license.plan];
    current.licenseCount += 1;
    mrrTotals.set(currency, current);
  }

  const mrrByCurrency = [...mrrTotals.entries()]
    .map(([currency, value]) => ({ currency, amount: roundMoney(value.amount), licenseCount: value.licenseCount }))
    .sort(byCurrency);

  const renewals = input.licenses
    .map((license) => {
      const expiryDay = dayStartTimestamp(license.expires_at);
      if (license.status !== 'Active' || !termMonths[license.plan] || expiryDay === null || expiryDay < todayMs || expiryDay > renewalEndMs) return null;
      return {
        licenseId: license.id,
        clientId: license.client_id,
        clientName: clientNames.get(license.client_id) || 'Client record',
        plan: license.plan,
        platform: license.platform,
        accountNumber: license.account_number || null,
        expiresOn: isoDay(expiryDay),
        daysRemaining: Math.round((expiryDay - todayMs) / DAY_MS),
      } satisfies RenewalEntry;
    })
    .filter((entry): entry is RenewalEntry => Boolean(entry))
    .sort((left, right) => left.expiresOn.localeCompare(right.expiresOn) || left.clientName.localeCompare(right.clientName));

  const monthRevenue = new Map<string, number>();
  for (const payment of completedPayments) {
    const paymentDay = dayStartTimestamp(payment.payment_date);
    const currency = normalizeCurrency(payment.currency);
    if (paymentDay === null || paymentDay < Date.parse(`${periodMonth}T00:00:00Z`) || paymentDay >= nextMonthMs || !currency) continue;
    monthRevenue.set(currency, (monthRevenue.get(currency) || 0) + validAmount(payment.amount));
  }
  roundMap(monthRevenue);

  const goalTargets = new Map<string, number>();
  for (const goal of input.goals) {
    if (datePart(goal.period_month) !== periodMonth) continue;
    const currency = normalizeCurrency(goal.currency);
    const target = validAmount(goal.target_amount);
    if (currency && target > 0) goalTargets.set(currency, target);
  }

  const goalCurrencies = new Set([...monthRevenue.keys(), ...goalTargets.keys(), ...mrrTotals.keys()]);
  const goals = [...goalCurrencies].sort().map((currency) => {
    const actualAmount = roundMoney(monthRevenue.get(currency) || 0);
    const targetAmount = goalTargets.has(currency) ? roundMoney(goalTargets.get(currency) || 0) : null;
    return {
      currency,
      actualAmount,
      targetAmount,
      progressPercent: targetAmount ? roundPercent(actualAmount / targetAmount * 100) : null,
    } satisfies GoalProgress;
  });

  const exceptionRows = input.payments.flatMap((payment) => {
    if (!exceptionStatuses.includes(payment.status as ExceptionStatus)) return [];
    const eventDay = dayStartTimestamp(payment.updated_at || payment.payment_date || payment.created_at);
    if (eventDay === null || eventDay < exceptionStartMs || eventDay > exceptionEndMs) return [];
    return [{ payment, eventDay, status: payment.status as ExceptionStatus }];
  });

  const exceptionKpis = exceptionStatuses.map((status) => {
    const rows = exceptionRows.filter((row) => row.status === status);
    const amounts = new Map<string, number>();
    for (const row of rows) {
      const currency = normalizeCurrency(row.payment.currency);
      if (!currency) continue;
      amounts.set(currency, (amounts.get(currency) || 0) + validAmount(row.payment.amount));
    }
    roundMap(amounts);
    return {
      status,
      count: rows.length,
      amounts: [...amounts.entries()].map(([currency, amount]) => ({ currency, amount })).sort(byCurrency),
    } satisfies ExceptionKpi;
  });

  const trend = Array.from({ length: 13 }, (_, index) => {
    const periodStartMs = exceptionStartMs + index * 7 * DAY_MS;
    const periodEndMs = Math.min(periodStartMs + 6 * DAY_MS, todayMs);
    const point: ExceptionTrendPoint = {
      periodStart: isoDay(periodStartMs),
      periodEnd: isoDay(periodEndMs),
      label: shortDate(periodStartMs),
      refunded: 0,
      failed: 0,
      disputed: 0,
      total: 0,
    };
    return point;
  });
  for (const row of exceptionRows) {
    const bucket = Math.min(12, Math.floor((row.eventDay - exceptionStartMs) / (7 * DAY_MS)));
    if (bucket < 0 || !trend[bucket]) continue;
    const key = row.status.toLowerCase() as 'refunded' | 'failed' | 'disputed';
    trend[bucket][key] += 1;
    trend[bucket].total += 1;
  }

  const exceptionAmounts = new Map<ExceptionStatus, Map<string, number>>(
    exceptionKpis.map((kpi) => [kpi.status, new Map(kpi.amounts.map((amount) => [amount.currency, amount.amount]))]),
  );
  const mrrMap = new Map(mrrByCurrency.map((row) => [row.currency, row.amount]));
  const currencySet = new Set([
    ...monthRevenue.keys(),
    ...mrrMap.keys(),
    ...goalTargets.keys(),
    ...exceptionKpis.flatMap((kpi) => kpi.amounts.map((amount) => amount.currency)),
  ]);
  const currencies = [...currencySet].sort().map((currency) => {
    const actual = roundMoney(monthRevenue.get(currency) || 0);
    const target = goalTargets.has(currency) ? roundMoney(goalTargets.get(currency) || 0) : null;
    return {
      currency,
      revenueMonth: actual,
      normalizedMrr: roundMoney(mrrMap.get(currency) || 0),
      goalTarget: target,
      goalProgressPercent: target ? roundPercent(actual / target * 100) : null,
      refunded90d: roundMoney(exceptionAmounts.get('Refunded')?.get(currency) || 0),
      failed90d: roundMoney(exceptionAmounts.get('Failed')?.get(currency) || 0),
      disputed90d: roundMoney(exceptionAmounts.get('Disputed')?.get(currency) || 0),
    } satisfies CurrencySummary;
  });

  return {
    generatedAt: now.toISOString(),
    periodMonth,
    monthLabel: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${periodMonth}T00:00:00Z`)),
    methodology: [
      'Normalized MRR uses one latest unused completed payment for each currently active Basic or Premium term license. Basic is divided by one month and Premium by three months.',
      'Lifetime, expired, missing-expiry, unmatched, non-positive, and invalid-currency records are excluded from normalized MRR. Currency values are never converted or combined.',
      'Monthly revenue uses completed payments dated in the displayed calendar month. Exception trends cover the latest 90 calendar days and use the record update date, falling back to payment or creation date.',
    ],
    mrr: {
      byCurrency: mrrByCurrency,
      eligibleLicenseCount: eligibleLicenses.length,
      matchedLicenseCount,
      unmatchedLicenseCount: eligibleLicenses.length - matchedLicenseCount,
      excludedLifetimeCount,
    },
    renewals: { windowStart: today, windowEnd: isoDay(renewalEndMs), entries: renewals },
    goals,
    exceptions: {
      windowStart: isoDay(exceptionStartMs),
      windowEnd: today,
      kpis: exceptionKpis,
      trend,
    },
    currencies,
  };
}

export type RenewalCalendarMonth = {
  key: string;
  label: string;
  leadingBlankDays: number;
  days: Array<{ date: string; day: number; inWindow: boolean; isToday: boolean; entries: RenewalEntry[] }>;
};

export function buildRenewalCalendar(renewals: RevenueIntelligenceSnapshot['renewals']): RenewalCalendarMonth[] {
  const startMs = dayStartTimestamp(renewals.windowStart);
  const endMs = dayStartTimestamp(renewals.windowEnd);
  if (startMs === null || endMs === null || endMs < startMs) return [];
  const entriesByDate = new Map<string, RenewalEntry[]>();
  for (const entry of renewals.entries) entriesByDate.set(entry.expiresOn, [...(entriesByDate.get(entry.expiresOn) || []), entry]);
  const months: RenewalCalendarMonth[] = [];
  let cursor = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), 1);
  const finalMonth = Date.UTC(new Date(endMs).getUTCFullYear(), new Date(endMs).getUTCMonth(), 1);

  while (cursor <= finalMonth) {
    const date = new Date(cursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const dayMs = Date.UTC(year, month, index + 1);
      const dateKey = isoDay(dayMs);
      return {
        date: dateKey,
        day: index + 1,
        inWindow: dayMs >= startMs && dayMs <= endMs,
        isToday: dayMs === startMs,
        entries: entriesByDate.get(dateKey) || [],
      };
    });
    months.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date),
      leadingBlankDays: date.getUTCDay(),
      days,
    });
    cursor = Date.UTC(year, month + 1, 1);
  }

  return months;
}

function comparePaymentsNewestFirst(left: RevenuePaymentRecord, right: RevenuePaymentRecord) {
  return paymentTimestamp(right) - paymentTimestamp(left) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

function paymentTimestamp(payment: RevenuePaymentRecord) {
  return dayStartTimestamp(payment.payment_date) ?? timestamp(payment.created_at) ?? 0;
}

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function validAmount(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function datePart(value?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(parsed) || isoDay(parsed) !== date ? null : date;
}

function dayStartTimestamp(value?: string | null) {
  const date = datePart(value);
  return date ? Date.parse(`${date}T00:00:00Z`) : null;
}

function expiryEndTimestamp(value?: string | null) {
  const start = dayStartTimestamp(value);
  return start === null ? null : start + DAY_MS - 1;
}

function timestamp(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isoDay(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function shortDate(value: number) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function roundMap(map: Map<string, number>) {
  for (const [key, value] of map) map.set(key, roundMoney(value));
}

function byCurrency(left: { currency: string }, right: { currency: string }) {
  return left.currency.localeCompare(right.currency);
}
