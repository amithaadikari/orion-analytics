import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accountSecurityRateLimit: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  getPortalSession: vi.fn(),
  isExactSameOrigin: vi.fn(),
  loadClientTradingAlerts: vi.fn(),
  publicTradingAlertsError: vi.fn(),
  updateClientTradingAlerts: vi.fn(),
}));

vi.mock('@/lib/client-security', () => ({
  accountSecurityRateLimit: mocks.accountSecurityRateLimit,
  isExactSameOrigin: mocks.isExactSameOrigin,
}));
vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/trading-alerts-server', () => ({
  loadClientTradingAlerts: mocks.loadClientTradingAlerts,
  publicTradingAlertsError: mocks.publicTradingAlertsError,
  updateClientTradingAlerts: mocks.updateClientTradingAlerts,
}));

import { GET, PATCH } from '@/app/api/trading-alerts/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const snapshot = {
  generatedAt: '2026-07-21T15:00:00Z',
  connection: {
    id: connectionId,
    plan: 'Premium',
    platform: 'MT5',
    accountType: 'Real',
    maskedAccountNumber: '•••5678',
    brokerServer: 'OrionBroker-Live01',
    currency: 'USD',
  },
  access: {
    plan: 'Premium',
    connectionHealth: true,
    finalClose: true,
    advancedEvents: true,
    riskGuardrails: true,
  },
  preferences: {
    connectionHealth: true,
    finalClose: true,
    tradeOpened: true,
    partialClose: true,
    dailyLossEnabled: false,
    dailyLossLimit: null,
    drawdownEnabled: false,
    drawdownPercent: null,
    equityFloorEnabled: false,
    equityFloor: null,
  },
  monitoring: {
    activeRules: 4,
    activeBreaches: 0,
    lastEvaluatedAt: null,
    lastAlertAt: null,
  },
};

describe('client trading alerts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'auth-user-1' },
      client: { id: clientId },
      admin: null,
      mfaRequired: false,
      supabase: {},
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ service: true });
    mocks.isExactSameOrigin.mockReturnValue(true);
    mocks.accountSecurityRateLimit.mockReturnValue(true);
    mocks.loadClientTradingAlerts.mockResolvedValue(snapshot);
    mocks.updateClientTradingAlerts.mockResolvedValue(snapshot);
    mocks.publicTradingAlertsError.mockImplementation((error: { code?: string }) => {
      if (error?.code === 'PREMIUM_REQUIRED') {
        return { status: 403, message: 'Premium or Lifetime is required for advanced trading alerts.' };
      }
      if (error?.code === 'ALERTS_MIGRATION_REQUIRED') {
        return { status: 503, message: 'Trading alerts are waiting for the latest database migration.' };
      }
      return { status: 500, message: 'Trading alerts are temporarily unavailable.' };
    });
  });

  it.each([
    ['unauthenticated', { user: null, client: null, mfaRequired: false }, 401, 'Authentication required'],
    ['awaiting MFA', { user: { id: 'auth-user-1' }, client: null, mfaRequired: true }, 403, 'Authenticator verification required'],
    ['without a linked client', { user: { id: 'auth-user-1' }, client: null, mfaRequired: false }, 403, 'A linked Orion client account is required'],
  ])('rejects GET access when %s before service-role access', async (_label, session, status, message) => {
    mocks.getPortalSession.mockResolvedValue({ ...session, admin: null, supabase: {} });

    const response = await GET(getRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadClientTradingAlerts).not.toHaveBeenCalled();
  });

  it('delegates GET ownership to the authenticated client and returns private headers', async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.loadClientTradingAlerts).toHaveBeenCalledWith({ service: true }, clientId, connectionId);
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it('rejects unknown GET authority fields and malformed connections before database access', async () => {
    expect((await GET(new Request(`https://app.orionscalper.com/api/trading-alerts?connectionId=${connectionId}&clientId=${clientId}&plan=Lifetime`))).status).toBe(400);
    expect((await GET(new Request('https://app.orionscalper.com/api/trading-alerts?connectionId=not-a-uuid'))).status).toBe(400);
    expect((await GET(new Request('https://app.orionscalper.com/api/trading-alerts'))).status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadClientTradingAlerts).not.toHaveBeenCalled();
  });

  it('requires exact-origin JSON mutations before reading the session', async () => {
    mocks.isExactSameOrigin.mockReturnValue(false);
    let response = await PATCH(patchRequest({ connectionId, preferences: { finalClose: false } }));
    expect(response.status).toBe(403);
    expect(mocks.getPortalSession).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.isExactSameOrigin.mockReturnValue(true);
    response = await PATCH(new Request('https://app.orionscalper.com/api/trading-alerts', {
      method: 'PATCH',
      headers: { origin: 'https://app.orionscalper.com', 'content-type': 'text/plain' },
      body: JSON.stringify({ connectionId, preferences: { finalClose: false } }),
    }));
    expect(response.status).toBe(415);
    expect(mocks.getPortalSession).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown authority field', { connectionId, clientId, plan: 'Lifetime', preferences: { finalClose: false } }],
    ['an empty preference patch', { connectionId, preferences: {} }],
    ['an unknown preference', { connectionId, preferences: { finalClose: false, executeTrade: true } }],
    ['an invalid connection id', { connectionId: 'not-a-uuid', preferences: { finalClose: false } }],
    ['a sub-cent monetary threshold', { connectionId, preferences: { dailyLossLimit: 0.001 } }],
    ['an excessive drawdown threshold', { connectionId, preferences: { drawdownPercent: 91 } }],
  ])('strictly rejects %s without delegating the update', async (_label, body) => {
    const response = await PATCH(patchRequest(body));

    expect(response.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.updateClientTradingAlerts).not.toHaveBeenCalled();
  });

  it('rate limits an authenticated mutation before reading or writing alert state', async () => {
    mocks.accountSecurityRateLimit.mockReturnValue(false);

    const response = await PATCH(patchRequest({ connectionId, preferences: { finalClose: false } }));

    expect(response.status).toBe(429);
    expect(mocks.accountSecurityRateLimit).toHaveBeenCalledWith(expect.any(Request), 'auth-user-1', {
      scope: 'trading-alerts',
      limit: 20,
    });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.updateClientTradingAlerts).not.toHaveBeenCalled();
  });

  it('delegates a strict preference patch inside the authenticated client scope', async () => {
    const preferences = {
      tradeOpened: false,
      dailyLossEnabled: true,
      dailyLossLimit: 125.5,
      drawdownEnabled: true,
      drawdownPercent: 12,
    };

    const response = await PATCH(patchRequest({ connectionId, preferences }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.updateClientTradingAlerts).toHaveBeenCalledWith(
      { service: true },
      clientId,
      connectionId,
      preferences,
    );
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it('maps server-side Premium enforcement without exposing implementation details', async () => {
    const error = Object.assign(new Error('PREMIUM_REQUIRED: internal plan row'), {
      code: 'PREMIUM_REQUIRED',
      status: 403,
    });
    mocks.updateClientTradingAlerts.mockRejectedValue(error);

    const response = await PATCH(patchRequest({ connectionId, preferences: { tradeOpened: true } }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Premium or Lifetime is required for advanced trading alerts.',
    });
    expect(mocks.publicTradingAlertsError).toHaveBeenCalledWith(error);
  });

  it('maps missing-schema GET failures to the public migration response', async () => {
    const error = Object.assign(new Error('relation missing'), {
      code: 'ALERTS_MIGRATION_REQUIRED',
      status: 503,
    });
    mocks.loadClientTradingAlerts.mockRejectedValue(error);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Trading alerts are waiting for the latest database migration.',
    });
    expect(mocks.publicTradingAlertsError).toHaveBeenCalledWith(error);
  });
});

function getRequest() {
  return new Request(`https://app.orionscalper.com/api/trading-alerts?connectionId=${connectionId}`);
}

function patchRequest(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/trading-alerts', {
    method: 'PATCH',
    headers: { origin: 'https://app.orionscalper.com', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}
