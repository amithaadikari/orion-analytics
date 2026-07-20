import { describe, expect, it } from 'vitest';
import { compatibleReleaseForPlan, effectiveLicenseStatus } from '@/lib/portal-activation';

describe('portal activation release selection', () => {
  it('preserves a manually suspended status after the expiry date passes', () => {
    expect(effectiveLicenseStatus({ plan: 'Basic', platform: 'MT5', status: 'Suspended', expires_at: '2020-01-01' })).toBe('suspended');
  });

  it('selects the newest release matching the current plan license platform', () => {
    const licenses = [
      { plan: 'Premium', platform: 'MT4', status: 'Active', expires_at: '2099-12-31' },
      { plan: 'Basic', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' },
    ];
    const releases = [
      { id: 'newest-mt4', platform: 'MT4', download_url: 'https://downloads.example.com/mt4.ex4' },
      { id: 'matching-mt5', platform: 'MT5', download_url: 'https://downloads.example.com/mt5.ex5' },
    ];

    expect(compatibleReleaseForPlan('Basic', licenses, releases)?.id).toBe('matching-mt5');
  });

  it('accepts a release published for both supported platforms', () => {
    const licenses = [{ plan: 'Basic', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' }];
    const releases = [{ id: 'both', platform: 'Both', download_url: 'https://downloads.example.com/orion.zip' }];

    expect(compatibleReleaseForPlan('Basic', licenses, releases)?.id).toBe('both');
  });

  it('does not expose a Both-platform release without an active current-plan license', () => {
    const licenses = [
      { plan: 'Premium', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' },
      { plan: 'Basic', platform: 'MT5', status: 'Expired', expires_at: '2026-01-01' },
    ];
    const releases = [{ id: 'both', platform: 'Both', download_url: 'https://downloads.example.com/orion.zip' }];

    expect(compatibleReleaseForPlan('Basic', licenses, releases, Date.parse('2026-07-20T00:00:00Z'))).toBeUndefined();
  });

  it('uses the current channel assignment when a Both package is live for only one platform', () => {
    const licenses = [{ plan: 'Basic', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' }];
    const releases = [
      { id: 'mt4-only-current', platform: 'Both', current_platforms: ['MT4'], download_url: 'protected' },
      { id: 'mt5-current', platform: 'MT5', current_platforms: ['MT5'], download_url: 'protected' },
    ];

    expect(compatibleReleaseForPlan('Basic', licenses, releases)?.id).toBe('mt5-current');
  });
});
