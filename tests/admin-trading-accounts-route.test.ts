import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(), createSupabaseAdminClient: vi.fn(), loadSnapshot: vi.fn(), publicError: vi.fn(), rateLimit: vi.fn(), sameOrigin: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/trading-accounts-server', () => ({ loadTradingAccountSnapshot: mocks.loadSnapshot, publicTradingAccountError: mocks.publicError }));
vi.mock('@/lib/client-security', () => ({ accountSecurityRateLimit: mocks.rateLimit, isExactSameOrigin: mocks.sameOrigin }));

import { GET, PATCH, POST } from '@/app/api/admin/trading-accounts/[clientId]/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ clientId }) };

describe('admin trading-accounts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-user-1' }, admin: { id: 'admin-1', role: 'admin', email: 'owner@example.com' }, mfaRequired: false, supabase: {} });
    mocks.rateLimit.mockReturnValue(true);
    mocks.sameOrigin.mockReturnValue(true);
    mocks.loadSnapshot.mockResolvedValue(snapshot());
    mocks.publicError.mockReturnValue({ status: 409, code: 'ACCOUNT_CONFLICT', message: 'Conflict', nextChangeAt: null });
  });

  it('allows analysts to inspect but not mutate client account state', async () => {
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'analyst-user' }, admin: { id: 'analyst-1', role: 'analyst' }, mfaRequired: false, supabase: {} });
    mocks.createSupabaseAdminClient.mockReturnValue({});
    expect((await GET(new Request('https://admin.example/api'), context)).status).toBe(200);
    const denied = await POST(adminRequest('POST', accountBody()), context);
    expect(denied.status).toBe(403);
  });

  it('uses the admin-only atomic function and records a mandatory reason', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(adminRequest('POST', accountBody()), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('change_registered_real_account_admin', expect.objectContaining({
      p_admin_user_id: 'admin-user-1', p_client_id: clientId, p_request_id: requestId,
      p_override_reason: 'Client confirmed a broker migration.',
    }));
  });

  it('updates membership through the database function rather than the generic client API', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await PATCH(adminRequest('PATCH', { tier: 'Pro', status: 'Active', startedAt: '2026-07-21T00:00:00.000Z', expiresAt: '2027-07-21T00:00:00.000Z' }), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_client_membership_admin', expect.objectContaining({ p_admin_user_id: 'admin-user-1', p_client_id: clientId, p_tier: 'Pro' }));
  });

  it('rejects short reasons and cross-site writes before calling an RPC', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    expect((await POST(adminRequest('POST', { ...accountBody(), overrideReason: 'short' }), context)).status).toBe(400);
    mocks.sameOrigin.mockReturnValue(false);
    expect((await PATCH(adminRequest('PATCH', { tier: 'Standard', status: 'Active', startedAt: null, expiresAt: null }), context)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

function adminRequest(method: string, body: Record<string, unknown>) {
  return new Request('https://admin.orionscalper.com/api/admin/trading-accounts/client', { method, headers: { origin: 'https://admin.orionscalper.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function accountBody() { return { requestId, accountNumber: '12345678', broker: 'Broker Ltd', brokerServer: 'Broker-Live', platform: 'MT5', currency: 'USD', overrideReason: 'Client confirmed a broker migration.' }; }
function snapshot() { return { serverTime: '2026-07-21T12:00:00Z', clientStatus: 'Active', membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null }, currentAccount: null, licensesBound: 0, eligibleLicenses: 1, canChange: true, nextChangeAt: null, cooldownDays: 7, cooldownReason: null, legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [] }; }
