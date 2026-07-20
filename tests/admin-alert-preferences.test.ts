import { describe, expect, it } from 'vitest';
import { preferredQueueCount } from '@/components/admin-action-center';

describe('administrator header alert preferences', () => {
  const counts = { registrations: 3, payments: 2, licenses: 4, support: 5, suspended: 2 };

  it('includes every actionable category by default', () => {
    expect(preferredQueueCount(counts)).toBe(16);
  });

  it('only includes categories enabled for the header attention badge', () => {
    expect(preferredQueueCount(counts, {
      registrationAlerts: false,
      paymentAlerts: true,
      licenseAlerts: false,
      supportAlerts: true,
    })).toBe(9);
  });

  it('always includes suspended accounts when optional alerts are muted', () => {
    expect(preferredQueueCount(counts, {
      registrationAlerts: false,
      paymentAlerts: false,
      licenseAlerts: false,
      supportAlerts: false,
    })).toBe(2);
  });
});
