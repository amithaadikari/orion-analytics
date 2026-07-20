import { describe, expect, it } from 'vitest';
import { accountChangeEligibility, effectiveMembership, maskTradingAccount, type TradingAccountHistoryItem, type TradingAccountView } from '@/lib/trading-accounts';

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

  it('does not count first registration as a Standard replacement cooldown', () => {
    const registration = history('Registration', '2026-07-21T11:00:00Z');
    expect(accountChangeEligibility({ membershipTier: 'Standard', currentAccount, clientStatus: 'Active', eligibleLicenses: 1, history: [registration], now })).toMatchObject({ canChange: true, nextChangeAt: null });
  });

  it('unlocks Standard exactly seven days after the last client replacement', () => {
    const replacement = history('Replacement', '2026-07-14T12:00:00Z');
    expect(accountChangeEligibility({ membershipTier: 'Standard', currentAccount, clientStatus: 'Active', eligibleLicenses: 1, history: [replacement], now })).toMatchObject({ canChange: true, nextChangeAt: null });
    const tooRecent = history('Replacement', '2026-07-14T12:00:01Z');
    expect(accountChangeEligibility({ membershipTier: 'Standard', currentAccount, clientStatus: 'Active', eligibleLicenses: 1, history: [tooRecent], now })).toMatchObject({ canChange: false, cooldownReason: 'standard' });
  });

  it('lets Pro replace without a seven-day wait but enforces the rolling security ceiling', () => {
    const one = history('Replacement', '2026-07-21T10:00:00Z');
    expect(accountChangeEligibility({ membershipTier: 'Pro', currentAccount, clientStatus: 'Active', eligibleLicenses: 1, history: [one], now }).canChange).toBe(true);
    const two = history('Reactivation', '2026-07-21T11:00:00Z');
    expect(accountChangeEligibility({ membershipTier: 'Pro', currentAccount, clientStatus: 'Active', eligibleLicenses: 1, history: [one, two], now })).toMatchObject({ canChange: false, cooldownReason: 'pro-security' });
  });

  it('allows first registration only for an active client with an active license', () => {
    expect(accountChangeEligibility({ membershipTier: 'Standard', currentAccount: null, clientStatus: 'Active', eligibleLicenses: 1, history: [], now }).canChange).toBe(true);
    expect(accountChangeEligibility({ membershipTier: 'Standard', currentAccount: null, clientStatus: 'Suspended', eligibleLicenses: 1, history: [], now }).cooldownReason).toBe('inactive');
    expect(accountChangeEligibility({ membershipTier: 'Standard', currentAccount: null, clientStatus: 'Active', eligibleLicenses: 0, history: [], now }).cooldownReason).toBe('no-license');
  });

  it('masks all but the final four account digits', () => {
    expect(maskTradingAccount('123456789')).toBe('•••••6789');
    expect(maskTradingAccount('1234')).toBe('1234');
    expect(maskTradingAccount(null)).toBe('Not registered');
  });
});

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
