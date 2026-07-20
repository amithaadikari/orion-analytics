import { describe, expect, it } from 'vitest';
import { checkoutPath, checkoutSelectionPath, normalizePlan, planFromPath, safeAuthNext } from '@/lib/plans';

describe('client plan handoff', () => {
  it('normalizes only published Orion editions', () => {
    expect(normalizePlan(' PREMIUM ')).toBe('premium');
    expect(normalizePlan('enterprise')).toBeNull();
    expect(normalizePlan(null)).toBeNull();
  });

  it('keeps authentication redirects on approved portal paths', () => {
    expect(safeAuthNext('/checkout?plan=basic')).toBe('/checkout?plan=basic');
    expect(safeAuthNext('/portal/profile')).toBe('/portal/profile');
    expect(safeAuthNext('/reset-password')).toBe('/reset-password');
    expect(safeAuthNext('//evil.example')).toBe('/portal');
    expect(safeAuthNext('/\\evil.example')).toBe('/portal');
    expect(safeAuthNext('https://evil.example')).toBe('/portal');
    expect(safeAuthNext('/dashboard')).toBe('/portal');
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
