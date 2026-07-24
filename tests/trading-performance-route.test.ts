import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadClientTradingPerformance: vi.fn(),
  publicTradingPerformanceError: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock('@/lib/trading-performance-server', () => ({
  loadClientTradingPerformance: mocks.loadClientTradingPerformance,
  publicTradingPerformanceError: mocks.publicTradingPerformanceError,
}));

import { GET } from '@/app/api/trading-performance/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';

describe('client trading performance API', () => {
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
    mocks.loadClientTradingPerformance.mockResolvedValue({
      availability: 'ready',
      access: { plan: 'Premium', csvExport: true },
      performance: { overview: { closedTrades: 3 } },
    });
    mocks.publicTradingPerformanceError.mockImplementation((error: { code?: string; status?: number }) => {
      if (error?.code === 'PERFORMANCE_MIGRATION_REQUIRED') {
        return {
          status: 503,
          message: 'Performance Intelligence is waiting for the latest database migration.',
        };
      }
      if (error?.code === 'CONNECTION_NOT_FOUND') {
        return { status: 404, message: 'The selected trading connection was not found.' };
      }
      return { status: 500, message: 'Performance Intelligence is temporarily unavailable.' };
    });
  });

  it.each([
    ['unauthenticated', { user: null, client: null, mfaRequired: false }, 401, 'Authentication required'],
    ['awaiting MFA', { user: { id: 'auth-user-1' }, client: null, mfaRequired: true }, 403, 'Authenticator verification required'],
    ['without a linked client', { user: { id: 'auth-user-1' }, client: null, mfaRequired: false }, 403, 'A linked Orion client account is required'],
  ])('rejects %s access before service-role work', async (_label, session, status, message) => {
    mocks.getPortalSession.mockResolvedValue({ ...session, admin: null, supabase: {} });

    const response = await GET(performanceRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadClientTradingPerformance).not.toHaveBeenCalled();
  });

  it('derives ownership from the authenticated session and returns private data', async () => {
    const response = await GET(performanceRequest(`?connectionId=${connectionId}&range=90d`));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.loadClientTradingPerformance).toHaveBeenCalledWith(
      { service: true },
      clientId,
      { connectionId, range: '90d' },
    );
    await expect(response.json()).resolves.toMatchObject({
      availability: 'ready',
      access: { plan: 'Premium' },
      performance: { overview: { closedTrades: 3 } },
    });
  });

  it('supports a server-selected connection without browser authority fields', async () => {
    const response = await GET(performanceRequest('?range=7d'));

    expect(response.status).toBe(200);
    expect(mocks.loadClientTradingPerformance).toHaveBeenCalledWith(
      { service: true },
      clientId,
      { range: '7d' },
    );
  });

  it.each([
    ['a browser-supplied client and plan', `?connectionId=${connectionId}&range=7d&clientId=${clientId}&plan=Lifetime`],
    ['an invalid connection', '?connectionId=not-a-uuid&range=7d'],
    ['an invalid range', `?connectionId=${connectionId}&range=500d`],
    ['an unknown query key', `?connectionId=${connectionId}&range=7d&format=csv`],
  ])('rejects %s before service-role access', async (_label, search) => {
    const response = await GET(performanceRequest(search));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid performance request' });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadClientTradingPerformance).not.toHaveBeenCalled();
  });

  it('isolates an unapplied performance migration behind the new endpoint', async () => {
    const error = Object.assign(new Error('function read_orion_performance_intelligence does not exist'), {
      code: 'PERFORMANCE_MIGRATION_REQUIRED',
      status: 503,
    });
    mocks.loadClientTradingPerformance.mockRejectedValue(error);

    const response = await GET(performanceRequest(`?connectionId=${connectionId}&range=7d`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Performance Intelligence is waiting for the latest database migration.',
    });
    expect(mocks.publicTradingPerformanceError).toHaveBeenCalledWith(error);
  });

  it('does not expose database details from an unexpected loader failure', async () => {
    mocks.loadClientTradingPerformance.mockRejectedValue(
      new Error('select * from private.orion_closed_deals failed'),
    );

    const response = await GET(performanceRequest(`?connectionId=${connectionId}&range=7d`));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Performance Intelligence is temporarily unavailable.',
    });
  });
});

function performanceRequest(search = '') {
  return new Request(`https://app.orionscalper.com/api/trading-performance${search}`);
}
