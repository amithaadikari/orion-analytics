import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadClientTradingAnalytics: vi.fn(),
  publicTradingAnalyticsError: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/trading-analytics-server', () => ({
  loadClientTradingAnalytics: mocks.loadClientTradingAnalytics,
  publicTradingAnalyticsError: mocks.publicTradingAnalyticsError,
}));

import { GET } from '@/app/api/trading-analytics/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';

describe('client trading analytics API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'auth-user-1' }, client: { id: clientId }, admin: null, mfaRequired: false, supabase: {},
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ service: true });
    mocks.loadClientTradingAnalytics.mockResolvedValue({
      availability: 'waiting_first_sync',
      activity: { items: [], hasMore: false, incompleteHistoryExcluded: false },
    });
    mocks.publicTradingAnalyticsError.mockReturnValue({ status: 503, message: 'Trading analytics are unavailable.' });
  });

  it('derives ownership from the authenticated session and returns private data', async () => {
    const request = new Request(`https://admin.orionscalper.com/api/trading-analytics?connectionId=${connectionId}&range=90d`);
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.loadClientTradingAnalytics).toHaveBeenCalledWith({ service: true }, clientId, {
      connectionId, range: '90d',
    });
    await expect(response.json()).resolves.toMatchObject({
      availability: 'waiting_first_sync',
      activity: { items: [], hasMore: false, incompleteHistoryExcluded: false },
    });
  });

  it('honors authentication and MFA before service-role access', async () => {
    mocks.getPortalSession.mockResolvedValue({ user: null, client: null, mfaRequired: false, supabase: {} });
    expect((await GET(new Request('https://admin.orionscalper.com/api/trading-analytics'))).status).toBe(401);
    mocks.getPortalSession.mockResolvedValue({ user: { id: 'auth-user-1' }, client: null, mfaRequired: true, supabase: {} });
    expect((await GET(new Request('https://admin.orionscalper.com/api/trading-analytics'))).status).toBe(403);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('rejects browser-supplied authority fields and malformed cursors', async () => {
    expect((await GET(new Request(`https://admin.orionscalper.com/api/trading-analytics?clientId=${clientId}&plan=Lifetime`))).status).toBe(400);
    expect((await GET(new Request('https://admin.orionscalper.com/api/trading-analytics?cursor=not+a+cursor'))).status).toBe(400);
    expect(mocks.loadClientTradingAnalytics).not.toHaveBeenCalled();
  });

  it('maps server loader failures without exposing database details', async () => {
    mocks.loadClientTradingAnalytics.mockRejectedValue(new Error('relation orion_telemetry_streams does not exist'));
    const response = await GET(new Request('https://admin.orionscalper.com/api/trading-analytics'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Trading analytics are unavailable.' });
  });
});
