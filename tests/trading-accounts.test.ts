import { describe, expect, it } from 'vitest';
import { accountChangeEligibility, canonicalClientPlan, effectiveMembership, maskTradingAccount, type ClientPlan, type TradingAccountHistoryItem, type TradingAccountView } from '@/lib/trading-accounts';

const now = new Date('2026-07-21T12:00:00.000Z');
const currentAccount: TradingAccountView = {
  id: 'account-1', accountNumber: '12345678', maskedAccountNumber: '••••5678', broker: 'Broker', brokerServer: 'Broker-Live',
  platform: 'MT5', currency: 'USD', status: 'Active', verifiedAt: now.toISOString(), registeredAt: now.toISOString(), deactivatedAt: null,
};

describe('trading-account membership and eligibility', () => {
  it('treats only currently active, in-date Pro membership as Pro', () => {
    expect(effectiveMembership({ membership_tier: 'Pro', membership_status: 'Active', membership_started_at: '2026-07-01T00:00:00Z', membership_expires_at: '2026-08-01T00:00:00Z' }, now).effectiveTier).toBe('Pro');
    expect(effectiveMembership({ membership_tier: 'Pro', membership_status: 'Expired', membership_expires_at: '2026-08-01T00:00:00Z' }, now).effectiveTier).toBe('Standard');
    expect(effectiveMembership({ membership_tier: 'Pro', membership_status: 'Active', membership_expires_at: '2026-07-21T11:59:59Z' }, now).effectiveTier).toBe('Standard');
    expect(effectiveMembership({ membership_tier: 'Pro', membership_status: 'Active', membership_started_at: '2026-07-22T00:00:00Z' }, now).effectiveTier).toBe('Standard');
  });

  it.each(['Free', 'Basic', 'Premium', 'Lifetime'] as const)('allows a genuine first registration for the %s plan', (clientPlan) => {
    expect(eligibility({ clientPlan, currentAccount: null, hasRegisteredAccount: false }).canChange).toBe(true);
  });

  it.each(['Free', 'Basic', 'Premium'] as const)('locks a prior real identity on the %s plan', (clientPlan) => {
    expect(eligibility({ clientPlan })).toMatchObject({ canChange: false, nextChangeAt: null, cooldownReason: 'plan-locked' });
    expect(eligibility({ clientPlan, currentAccount: null, hasRegisteredAccount: true })).toMatchObject({ canChange: false, cooldownReason: 'plan-locked' });
  });

  it('does not count first registration as a Lifetime Standard replacement cooldown', () => {
    const registration = history('Registration', '2026-07-21T11:00:00Z');
    expect(eligibility({ clientPlan: 'Lifetime', history: [registration] })).toMatchObject({ canChange: true, nextChangeAt: null });
  });

  it('unlocks Lifetime Standard exactly seven days after the last client replacement', () => {
    const replacement = history('Replacement', '2026-07-14T12:00:00Z');
    expect(eligibility({ clientPlan: 'Lifetime', history: [replacement] })).toMatchObject({ canChange: true, nextChangeAt: null });
    const tooRecent = history('Replacement', '2026-07-14T12:00:01Z');
    expect(eligibility({ clientPlan: 'Lifetime', history: [tooRecent] })).toMatchObject({ canChange: false, cooldownReason: 'standard' });
  });

  it('lets Lifetime Pro replace without a seven-day wait but enforces the rolling security ceiling', () => {
    const one = history('Replacement', '2026-07-21T10:00:00Z');
    expect(eligibility({ clientPlan: 'Lifetime', membershipTier: 'Pro', history: [one] }).canChange).toBe(true);
    const two = history('Reactivation', '2026-07-21T11:00:00Z');
    expect(eligibility({ clientPlan: 'Lifetime', membershipTier: 'Pro', history: [one, two] })).toMatchObject({ canChange: false, cooldownReason: 'pro-security' });
  });

  it('requires an active client and eligible license before every plan decision', () => {
    expect(eligibility({ clientPlan: 'Lifetime', currentAccount: null, hasRegisteredAccount: false, clientStatus: 'Suspended' }).cooldownReason).toBe('inactive');
    expect(eligibility({ clientPlan: 'Lifetime', currentAccount: null, hasRegisteredAccount: false, eligibleLicenses: 0 }).cooldownReason).toBe('no-license');
  });

  it('normalizes known plans and fails unknown values closed as Free', () => {
    expect(canonicalClientPlan(' lifetime ')).toBe('Lifetime');
    expect(canonicalClientPlan('Basic')).toBe('Basic');
    expect(canonicalClientPlan('corrupted-plan')).toBe('Free');
  });

  it('masks all but the final four account digits', () => {
    expect(maskTradingAccount('123456789')).toBe('•••••6789');
    expect(maskTradingAccount('1234')).toBe('••34');
    expect(maskTradingAccount('12')).toBe('••');
    expect(maskTradingAccount(null)).toBe('Not registered');
  });
});

function eligibility(overrides: {
  clientPlan?: ClientPlan;
  membershipTier?: 'Standard' | 'Pro';
  currentAccount?: TradingAccountView | null;
  hasRegisteredAccount?: boolean;
  clientStatus?: string;
  eligibleLicenses?: number;
  history?: TradingAccountHistoryItem[];
} = {}) {
  return accountChangeEligibility({
    clientPlan: overrides.clientPlan || 'Lifetime',
    membershipTier: overrides.membershipTier || 'Standard',
    currentAccount: overrides.currentAccount === undefined ? currentAccount : overrides.currentAccount,
    hasRegisteredAccount: overrides.hasRegisteredAccount ?? true,
    clientStatus: overrides.clientStatus || 'Active',
    eligibleLicenses: overrides.eligibleLicenses ?? 1,
    history: overrides.history || [],
    now,
  });
}

function history(changeKind: TradingAccountHistoryItem['changeKind'], createdAt: string): TradingAccountHistoryItem {
  return {
    id: `${changeKind}-${createdAt}`,
    changedBy: 'Client',
    changeKind,
    membershipTier: 'Standard',
    previousAccount: changeKind === 'Registration' ? null : { maskedAccountNumber: '••••1111', platform: 'MT5' },
    newAccount: { maskedAccountNumber: '••••5678', platform: 'MT5', broker: 'Broker', brokerServer: 'Broker-Live' },
    nextClientChangeAt: null,
    createdAt,
  };
}
