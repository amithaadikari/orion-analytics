import { describe, expect, it } from 'vitest';
import {
  buildRenewalCalendar,
  calculateRevenueIntelligence,
  type RevenueLicenseRecord,
  type RevenuePaymentRecord,
} from '@/lib/revenue-intelligence';
import { formatMoneyWithCode } from '@/lib/money';

const now = new Date('2026-07-19T12:00:00.000Z');

function license(value: Partial<RevenueLicenseRecord> & Pick<RevenueLicenseRecord, 'id' | 'client_id' | 'plan'>): RevenueLicenseRecord {
  return { status: 'Active', platform: 'MT5', expires_at: '2026-08-01', ...value };
}

function payment(value: Partial<RevenuePaymentRecord> & Pick<RevenuePaymentRecord, 'id' | 'client_id' | 'plan' | 'status' | 'amount' | 'currency'>): RevenuePaymentRecord {
  return { created_at: '2026-07-01T10:00:00.000Z', payment_date: '2026-07-01', ...value };
}

describe('revenue intelligence calculations', () => {
  it('formats revenue with two decimals and an explicit currency code', () => {
    expect(formatMoneyWithCode(479, 'usd')).toBe('$479.00 USD');
  });

  it('normalizes MRR by original currency using the latest completed payment and excludes Lifetime or inactive terms', () => {
    const snapshot = calculateRevenueIntelligence({
      clients: [{ id: 'client-a', full_name: 'Client A' }, { id: 'client-b', full_name: 'Client B' }],
      licenses: [
        license({ id: 'basic-a', client_id: 'client-a', plan: 'Basic', expires_at: '2026-08-01' }),
        license({ id: 'premium-b', client_id: 'client-b', plan: 'Premium', expires_at: '2026-09-01' }),
        license({ id: 'lifetime-a', client_id: 'client-a', plan: 'Lifetime', expires_at: null }),
        license({ id: 'expired-a', client_id: 'client-a', plan: 'Basic', expires_at: '2026-07-18' }),
        license({ id: 'missing-expiry', client_id: 'client-b', plan: 'Premium', expires_at: null }),
      ],
      payments: [
        payment({ id: 'basic-old', client_id: 'client-a', license_id: 'basic-a', plan: 'Basic', status: 'Paid', amount: 100, currency: 'USD', payment_date: '2026-07-01' }),
        payment({ id: 'basic-new', client_id: 'client-a', license_id: 'basic-a', plan: 'Basic', status: 'Manually verified', amount: 120, currency: 'USD', payment_date: '2026-07-10' }),
        payment({ id: 'premium', client_id: 'client-b', license_id: 'premium-b', plan: 'Premium', status: 'Paid', amount: 300, currency: 'EUR', payment_date: '2026-07-05' }),
        payment({ id: 'lifetime', client_id: 'client-a', license_id: 'lifetime-a', plan: 'Lifetime', status: 'Paid', amount: 1_000, currency: 'USD', payment_date: '2026-07-06' }),
      ],
      goals: [],
    }, now);

    expect(snapshot.mrr.byCurrency).toEqual([
      { currency: 'EUR', amount: 100, licenseCount: 1 },
      { currency: 'USD', amount: 120, licenseCount: 1 },
    ]);
    expect(snapshot.mrr).toMatchObject({ eligibleLicenseCount: 2, matchedLicenseCount: 2, unmatchedLicenseCount: 0, excludedLifetimeCount: 1 });
  });

  it('does not reuse one unlinked payment for multiple active licenses', () => {
    const snapshot = calculateRevenueIntelligence({
      clients: [{ id: 'client-a', full_name: 'Client A' }],
      licenses: [
        license({ id: 'basic-a', client_id: 'client-a', plan: 'Basic' }),
        license({ id: 'basic-b', client_id: 'client-a', plan: 'Basic' }),
      ],
      payments: [payment({ id: 'one-payment', client_id: 'client-a', license_id: null, plan: 'Basic', status: 'Paid', amount: 75, currency: 'USD' })],
      goals: [],
    }, now);

    expect(snapshot.mrr.byCurrency).toEqual([{ currency: 'USD', amount: 75, licenseCount: 1 }]);
    expect(snapshot.mrr.unmatchedLicenseCount).toBe(1);
  });

  it('keeps monthly revenue, goals, and exception amounts separated by currency', () => {
    const snapshot = calculateRevenueIntelligence({
      clients: [],
      licenses: [],
      payments: [
        payment({ id: 'usd-paid', client_id: 'a', plan: 'Basic', status: 'Paid', amount: 200, currency: 'USD', payment_date: '2026-07-02' }),
        payment({ id: 'eur-paid', client_id: 'b', plan: 'Premium', status: 'Paid', amount: 300, currency: 'EUR', payment_date: '2026-07-03' }),
        payment({ id: 'refund', client_id: 'a', plan: 'Basic', status: 'Refunded', amount: 20, currency: 'USD', payment_date: '2026-07-04' }),
        payment({ id: 'late-refund', client_id: 'a', plan: 'Basic', status: 'Refunded', amount: 15, currency: 'USD', payment_date: '2026-01-04', updated_at: '2026-07-18T08:00:00.000Z' }),
        payment({ id: 'failed', client_id: 'b', plan: 'Premium', status: 'Failed', amount: 30, currency: 'EUR', payment_date: null, updated_at: '2026-07-05T08:00:00.000Z' }),
        payment({ id: 'old-dispute', client_id: 'a', plan: 'Basic', status: 'Disputed', amount: 40, currency: 'USD', payment_date: '2026-01-01' }),
      ],
      goals: [
        { period_month: '2026-07-01', currency: 'USD', target_amount: 1_000 },
        { period_month: '2026-07-01', currency: 'EUR', target_amount: 600 },
      ],
    }, now);

    expect(snapshot.goals).toEqual([
      { currency: 'EUR', actualAmount: 300, targetAmount: 600, progressPercent: 50 },
      { currency: 'USD', actualAmount: 200, targetAmount: 1_000, progressPercent: 20 },
    ]);
    expect(snapshot.exceptions.kpis).toEqual([
      { status: 'Refunded', count: 2, amounts: [{ currency: 'USD', amount: 35 }] },
      { status: 'Failed', count: 1, amounts: [{ currency: 'EUR', amount: 30 }] },
      { status: 'Disputed', count: 0, amounts: [] },
    ]);
    expect(snapshot.currencies.find((row) => row.currency === 'USD')).toMatchObject({ revenueMonth: 200, refunded90d: 35, failed90d: 0 });
    expect(snapshot.currencies.find((row) => row.currency === 'EUR')).toMatchObject({ revenueMonth: 300, refunded90d: 0, failed90d: 30 });
  });

  it('includes only active term renewals from today through day 90 and builds month grids', () => {
    const snapshot = calculateRevenueIntelligence({
      clients: [{ id: 'a', full_name: 'Alpha' }],
      licenses: [
        license({ id: 'today', client_id: 'a', plan: 'Basic', expires_at: '2026-07-19' }),
        license({ id: 'day-90', client_id: 'a', plan: 'Premium', expires_at: '2026-10-17' }),
        license({ id: 'day-91', client_id: 'a', plan: 'Basic', expires_at: '2026-10-18' }),
        license({ id: 'past', client_id: 'a', plan: 'Basic', expires_at: '2026-07-18' }),
        license({ id: 'lifetime', client_id: 'a', plan: 'Lifetime', expires_at: null }),
      ],
      payments: [],
      goals: [],
    }, now);

    expect(snapshot.renewals.entries.map((entry) => [entry.licenseId, entry.daysRemaining])).toEqual([['today', 0], ['day-90', 90]]);
    const calendar = buildRenewalCalendar(snapshot.renewals);
    expect(calendar.map((month) => month.key)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(calendar.flatMap((month) => month.days).filter((day) => day.entries.length).map((day) => day.date)).toEqual(['2026-07-19', '2026-10-17']);
  });
});
