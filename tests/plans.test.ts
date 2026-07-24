import { describe, expect, it } from 'vitest';
import { checkoutPath, checkoutSelectionPath, normalizePlan, planFromPath, plans, safeAuthNext, safeMfaNext } from '@/lib/plans';

describe('client plan handoff', () => {
  it('normalizes only published Orion editions', () => {
    expect(normalizePlan(' PREMIUM ')).toBe('premium');
    expect(normalizePlan('enterprise')).toBeNull();
    expect(normalizePlan(null)).toBeNull();
  });

  it('keeps authentication redirects on approved portal paths', () => {
    expect(safeAuthNext('/checkout?plan=basic')).toBe('/checkout?plan=basic');
    expect(safeAuthNext('/portal/trading')).toBe('/portal/trading');
    expect(safeAuthNext('/portal/performance')).toBe('/portal/performance');
    expect(safeAuthNext('/portal/profile')).toBe('/portal/profile');
    expect(safeAuthNext('/portal/settings')).toBe('/portal/settings');
    expect(safeAuthNext('/reset-password')).toBe('/reset-password');
    expect(safeAuthNext('/invoice/550e8400-e29b-41d4-a716-446655440000')).toBe('/invoice/550e8400-e29b-41d4-a716-446655440000');
    expect(safeAuthNext('/receipt/550e8400-e29b-41d4-a716-446655440000')).toBe('/receipt/550e8400-e29b-41d4-a716-446655440000');
    expect(safeAuthNext('/invoice/not-a-uuid')).toBe('/portal');
    expect(safeAuthNext('/receipt/550e8400-e29b-41d4-a716-446655440000/extra')).toBe('/portal');
    expect(safeAuthNext('//evil.example')).toBe('/portal');
    expect(safeAuthNext('/\\evil.example')).toBe('/portal');
    expect(safeAuthNext('https://evil.example')).toBe('/portal');
    expect(safeAuthNext('/dashboard')).toBe('/portal');
    expect(safeMfaNext('/dashboard')).toBe('/dashboard');
    expect(safeMfaNext('/dashboard?section=payments')).toBe('/dashboard?section=payments');
    expect(safeMfaNext('/portal/performance')).toBe('/portal/performance');
    expect(safeMfaNext('/portal/settings')).toBe('/portal/settings');
    expect(safeMfaNext('//evil.example')).toBe('/portal');
  });

  it('advertises the trading analytics included with each edition', () => {
    expect(plans.basic.highlights).toContain('7-day live trading dashboard');
    expect(plans.premium.highlights).toContain('90-day analytics + advanced metrics');
    expect(plans.lifetime.highlights).toContain('All recorded analytics + advanced metrics');
  });

  it('builds and reads safe checkout paths', () => {
    expect(checkoutPath('lifetime')).toBe('/checkout?plan=lifetime');
    expect(checkoutPath(null)).toBe('/portal');
    expect(checkoutSelectionPath(null)).toBe('/checkout');
    expect(checkoutSelectionPath('basic')).toBe('/checkout?plan=basic');
    expect(planFromPath('/checkout?plan=premium')).toBe('premium');
    expect(planFromPath('/checkout?plan=enterprise')).toBeNull();
    expect(planFromPath('//evil.example?plan=premium')).toBeNull();
  });
});
