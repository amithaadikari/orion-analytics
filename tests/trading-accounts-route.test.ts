import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadSnapshot: vi.fn(),
  publicError: vi.fn(),
  rateLimit: vi.fn(),
  sameOrigin: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/trading-accounts-server', () => ({ loadTradingAccountSnapshot: mocks.loadSnapshot, publicTradingAccountError: mocks.publicError }));
vi.mock('@/lib/client-security', () => ({ accountSecurityRateLimit: mocks.rateLimit, isExactSameOrigin: mocks.sameOrigin }));

import { GET, POST } from '@/app/api/trading-accounts/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';

describe('client trading-accounts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({ user: { id: 'auth-user-1', email: 'client@example.com' }, client: { id: clientId }, admin: null, mfaRequired: false, supabase: {} });
    mocks.rateLimit.mockReturnValue(true);
    mocks.sameOrigin.mockReturnValue(true);
    mocks.publicError.mockReturnValue({ status: 409, code: 'ACCOUNT_CHANGE_COOLDOWN', message: 'Standard membership can replace a real account once every 7 days.', nextChangeAt: '2026-07-28T12:00:00Z' });
  });

  it('returns only the authenticated client snapshot and honors MFA', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({});
    mocks.loadSnapshot.mockResolvedValue(snapshot(false));
    expect((await GET()).status).toBe(200);
    expect(mocks.loadSnapshot).toHaveBeenCalledWith({}, clientId);
    mocks.getPortalSession.mockResolvedValue({ user: { id: 'auth-user-1' }, client: null, mfaRequired: true, supabase: {} });
    const denied = await GET();
    expect(denied.status).toBe(403);
  });

  it('rejects cross-site requests before authentication', async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const response = await POST(request({ ...validBody(), confirmation: 'REGISTER ACCOUNT' }));
    expect(response.status).toBe(403);
    expect(mocks.getPortalSession).not.toHaveBeenCalled();
  });

  it('rejects browser attempts to choose a client or membership tier', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn() });
    mocks.loadSnapshot.mockResolvedValue(snapshot(false));
    const response = await POST(request({ ...validBody(), confirmation: 'REGISTER ACCOUNT', clientId: '33333333-3333-4333-8333-333333333333', membershipTier: 'Pro' }));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseAdminClient().rpc).not.toHaveBeenCalled();
  });

  it('requires the correct typed confirmation for the current server state', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot(true));
    const response = await POST(request({ ...validBody(), confirmation: 'REGISTER ACCOUNT' }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls the client-scoped atomic RPC without accepting client or membership decisions', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Registration', reboundLicenses: 1 }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot(false)).mockResolvedValueOnce(snapshot(true));
    const response = await POST(request({ ...validBody(), confirmation: 'REGISTER ACCOUNT' }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('change_registered_real_account_client', {
      p_auth_user_id: 'auth-user-1',
      p_request_id: requestId,
      p_account_number: '12345678',
      p_broker: 'Broker Ltd',
      p_broker_server: 'Broker-Live',
      p_platform: 'MT5',
      p_currency: 'USD',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(clientId);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('membership');
  });

  it('returns the authoritative cooldown date without changing the old binding', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'ACCOUNT_CHANGE_COOLDOWN:2026-07-28T12:00:00Z' } });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot(true));
    const response = await POST(request({ ...validBody(), confirmation: 'CHANGE ACCOUNT' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ACCOUNT_CHANGE_COOLDOWN', nextChangeAt: '2026-07-28T12:00:00Z' });
    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(1);
  });
});

function request(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/trading-accounts', { method: 'POST', headers: { origin: 'https://app.orionscalper.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function validBody() {
  return { requestId, accountNumber: '12345678', broker: 'Broker Ltd', brokerServer: 'Broker-Live', platform: 'MT5', currency: 'USD' };
}

function snapshot(hasAccount: boolean) {
  return {
    serverTime: '2026-07-21T12:00:00Z', clientStatus: 'Active',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    currentAccount: hasAccount ? { id: 'account-1', accountNumber: '12345678', maskedAccountNumber: '••••5678', broker: 'Broker Ltd', brokerServer: 'Broker-Live', platform: 'MT5', currency: 'USD', status: 'Active', verifiedAt: '2026-07-21T12:00:00Z', registeredAt: '2026-07-21T12:00:00Z', deactivatedAt: null } : null,
    licensesBound: hasAccount ? 1 : 0, eligibleLicenses: 1, canChange: true, nextChangeAt: null, cooldownDays: 7, cooldownReason: null,
    legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [],
  };
}
