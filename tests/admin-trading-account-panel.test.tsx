// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminTradingAccountPanel from '@/components/admin-trading-account-panel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('admin trading-account panel', () => {
  it('keeps analyst access read-only while showing membership and binding state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot()), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<AdminTradingAccountPanel clientId="11111111-1111-4111-8111-111111111111" canWrite={false} />);
    expect(await screen.findByText('••••5678')).toBeTruthy();
    expect(screen.getByText(/Analyst access is read-only/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save membership' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Override and rebind' })).toBeNull();
  });
});

function snapshot() {
  return {
    serverTime: '2026-07-21T12:00:00Z', clientStatus: 'Active', clientPlan: 'Basic', membership: { storedTier: 'Pro', effectiveTier: 'Pro', status: 'Active', startedAt: null, expiresAt: null },
    currentAccount: { id: 'account-1', accountNumber: '12345678', maskedAccountNumber: '••••5678', broker: 'Broker Ltd', brokerServer: 'Broker-Live', platform: 'MT5', currency: 'USD', status: 'Active', verifiedAt: '2026-07-21T12:00:00Z', registeredAt: '2026-07-21T12:00:00Z', deactivatedAt: null },
    hasRegisteredAccount: true, licensesBound: 1, eligibleLicenses: 1, eligiblePlatforms: ['MT5'], canChange: false, nextChangeAt: null, cooldownDays: 7, cooldownReason: 'plan-locked', legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [],
  };
}
