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
    const response = await POST(request({ ...validBody(), intent: 'Register' }));
    expect(response.status).toBe(403);
    expect(mocks.getPortalSession).not.toHaveBeenCalled();
  });

  it('rejects browser attempts to choose a client, plan, or membership tier', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request({ ...validBody(), intent: 'Register', clientId: '33333333-3333-4333-8333-333333333333', clientPlan: 'Lifetime', membershipTier: 'Pro' }));
    expect(response.status).toBe(400);
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects mixed semantic intent and legacy confirmation before loading account state', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request({ ...validBody(), intent: 'Register', confirmation: 'REGISTER ACCOUNT' }));
    expect(response.status).toBe(400);
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['Register', true],
    ['Replace', false],
  ] as const)('rejects stale %s intent from a fresh server snapshot', async (intent, hasAccount) => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot(hasAccount));
    const response = await POST(request({ ...validBody(), intent }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ACCOUNT_STATE_CHANGED',
      error: 'The real account status changed. Review the current account details and try again.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('registers through semantic intent and calls only the client-scoped atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Registration', reboundLicenses: 1 }, error: null });
    const db = { rpc };
    mocks.createSupabaseAdminClient.mockReturnValue(db);
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot(false)).mockResolvedValueOnce(snapshot(true));
    const response = await POST(request({ ...validBody(), intent: 'Register' }));
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

  it('accepts Replace intent when the server has a current account', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Replacement', reboundLicenses: 1 }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot(true)).mockResolvedValueOnce(snapshot(true));
    const response = await POST(request({ ...validBody(), intent: 'Replace' }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['Basic', 'Premium'] as const)('blocks %s replacement before calling the RPC', async (clientPlan) => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot(true, { clientPlan }));
    const response = await POST(request({ ...validBody(), intent: 'Replace' }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'REAL_ACCOUNT_CHANGE_REQUIRES_LIFETIME',
      nextChangeAt: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not treat an archived Basic identity as a new first registration', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot(false, { clientPlan: 'Basic', hasRegisteredAccount: true }));
    const response = await POST(request({ ...validBody(), intent: 'Register' }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('temporarily accepts the legacy phrase as the equivalent semantic registration intent', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Registration', reboundLicenses: 1 }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot(false)).mockResolvedValueOnce(snapshot(true));
    const response = await POST(request({ ...validBody(), confirmation: 'REGISTER ACCOUNT' }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('returns the authoritative cooldown date without changing the old binding', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'ACCOUNT_CHANGE_COOLDOWN:2026-07-28T12:00:00Z' } });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot(true));
    const response = await POST(request({ ...validBody(), intent: 'Replace' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ACCOUNT_CHANGE_COOLDOWN', nextChangeAt: '2026-07-28T12:00:00Z' });
    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(1);
  });
});

function request(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/trading-accounts', {
    method: 'POST',
    headers: { origin: 'https://app.orionscalper.com', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return { requestId, accountNumber: '12345678', broker: 'Broker Ltd', brokerServer: 'Broker-Live', platform: 'MT5', currency: 'USD' };
}

function snapshot(hasAccount: boolean, options: { clientPlan?: 'Free' | 'Basic' | 'Premium' | 'Lifetime'; hasRegisteredAccount?: boolean } = {}) {
  return {
    serverTime: '2026-07-21T12:00:00Z',
    clientStatus: 'Active',
    clientPlan: options.clientPlan || 'Lifetime',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    currentAccount: hasAccount ? {
      id: 'account-1',
      accountNumber: '12345678',
      maskedAccountNumber: '••••5678',
      broker: 'Broker Ltd',
      brokerServer: 'Broker-Live',
      platform: 'MT5',
      currency: 'USD',
      status: 'Active',
      verifiedAt: '2026-07-21T12:00:00Z',
      registeredAt: '2026-07-21T12:00:00Z',
      deactivatedAt: null,
    } : null,
    hasRegisteredAccount: options.hasRegisteredAccount ?? hasAccount,
    licensesBound: hasAccount ? 1 : 0,
    eligibleLicenses: 1,
    canChange: true,
    nextChangeAt: null,
    cooldownDays: 7,
    cooldownReason: null,
    legacyReview: { pendingCount: 0, suggestedAccountNumber: null },
    history: [],
  };
}
