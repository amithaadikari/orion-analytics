import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadSnapshot: vi.fn(),
  publicError: vi.fn(),
  hashInstallationId: vi.fn(),
  rateLimit: vi.fn(),
  sameOrigin: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/license-runtime-server', () => ({
  loadLicenseRuntimeSnapshot: mocks.loadSnapshot,
  publicLicenseRuntimeError: mocks.publicError,
  hashInstallationId: mocks.hashInstallationId,
}));
vi.mock('@/lib/client-security', () => ({ accountSecurityRateLimit: mocks.rateLimit, isExactSameOrigin: mocks.sameOrigin }));

import { GET, POST } from '@/app/api/license-runtime/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const licenseId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const installationId = 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ';

describe('client license runtime API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({ user: { id: 'auth-user-1' }, client: { id: clientId }, mfaRequired: false, supabase: {} });
    mocks.rateLimit.mockReturnValue(true);
    mocks.sameOrigin.mockReturnValue(true);
    mocks.hashInstallationId.mockReturnValue('b'.repeat(64));
    mocks.publicError.mockReturnValue({ status: 409, code: 'INSTALLATION_CHANGE_RATE_LIMIT', message: 'Security limit', nextChangeAt: '2026-08-02T00:00:00Z' });
  });

  it('loads only the authenticated client snapshot and honors MFA', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({});
    mocks.loadSnapshot.mockResolvedValue(snapshot());
    expect((await GET()).status).toBe(200);
    expect(mocks.loadSnapshot).toHaveBeenCalledWith({}, clientId);
    mocks.getPortalSession.mockResolvedValue({ user: { id: 'auth-user-1' }, client: { id: clientId }, mfaRequired: true, supabase: {} });
    expect((await GET()).status).toBe(403);
  });

  it('rejects cross-site and authority fields before an RPC', async () => {
    mocks.sameOrigin.mockReturnValue(false);
    expect((await POST(request(demoBody()))).status).toBe(403);
    mocks.sameOrigin.mockReturnValue(true);
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot());
    const response = await POST(request({ ...demoBody(), clientId, plan: 'Lifetime', platform: 'MT4' }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('registers the exact Demo identity through the client-scoped RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Registration' }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ demo: true }));
    const response = await POST(request(demoBody()));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_license_demo_account_client', {
      p_auth_user_id: 'auth-user-1', p_request_id: requestId, p_license_id: licenseId,
      p_account_number: '87654321', p_broker_server: 'Broker-Demo',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(clientId);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('Lifetime');
  });

  it('hashes the installation ID and never sends the raw value to PostgreSQL', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Registration' }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ installation: true }));
    const response = await POST(request({ action: 'setInstallation', requestId, licenseId, installationId, deviceLabel: 'Home laptop', intent: 'Activate' }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('activate_license_installation_client', {
      p_auth_user_id: 'auth-user-1', p_request_id: requestId, p_license_id: licenseId,
      p_installation_hash: 'b'.repeat(64), p_installation_hint: '••••-WXYZ', p_device_label: 'Home laptop',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(installationId);
  });

  it('returns a stale-state conflict without invoking an RPC when installation intent no longer matches', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot({ installation: true }));
    const response = await POST(request({ action: 'setInstallation', requestId, licenseId, installationId, deviceLabel: 'New VPS', intent: 'Activate' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'PAIRING_STATE_CHANGED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a stale-state conflict without invoking an RPC when Demo intent no longer matches', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot({ demo: true }));
    const response = await POST(request(demoBody()));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'PAIRING_STATE_CHANGED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('temporarily accepts a legacy confirmation phrase as the equivalent semantic intent', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, changeKind: 'Registration' }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ demo: true }));
    const response = await POST(request({
      action: 'setDemoAccount', requestId, licenseId, accountNumber: '87654321', brokerServer: 'Broker-Demo', confirmation: 'REGISTER DEMO',
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_license_demo_account_client', {
      p_auth_user_id: 'auth-user-1', p_request_id: requestId, p_license_id: licenseId,
      p_account_number: '87654321', p_broker_server: 'Broker-Demo',
    });
  });

  it.each([
    ['Demo', { ...demoBody(), confirmation: 'REGISTER DEMO' }],
    ['installation', { action: 'setInstallation', requestId, licenseId, installationId, deviceLabel: 'Home laptop', intent: 'Activate', confirmation: 'ACTIVATE DEVICE' }],
  ])('rejects %s requests that mix semantic intent with a legacy confirmation', async (_kind, body) => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('approves a pending installation through the authenticated atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, status: 'Approved', changeKind: 'Registration' }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.loadSnapshot.mockResolvedValue(snapshot({ installation: true }));
    const response = await POST(request({ action: 'resolveInstallationRequest', pairingRequestId: requestId, decision: 'Approve' }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('resolve_license_installation_approval_client', {
      p_auth_user_id: 'auth-user-1', p_request_id: requestId, p_decision: 'Approve',
    });
    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rejects browser-supplied authority fields from an installation decision', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request({ action: 'resolveInstallationRequest', pairingRequestId: requestId, decision: 'Reject', licenseId, clientId }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not report an expired approval request as a successful activation', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, status: 'Expired', code: 'PAIRING_EXPIRED' }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request({ action: 'resolveInstallationRequest', pairingRequestId: requestId, decision: 'Approve' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'PAIRING_EXPIRED' });
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/license-runtime', { method: 'POST', headers: { origin: 'https://app.orionscalper.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function demoBody() {
  return { action: 'setDemoAccount', requestId, licenseId, accountNumber: '87654321', brokerServer: 'Broker-Demo', intent: 'Register' };
}

function snapshot(options: { demo?: boolean; installation?: boolean } = {}) {
  return {
    serverTime: '2026-08-01T00:00:00Z', clientStatus: 'Active',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    licenses: [{
      id: licenseId, maskedLicenseKey: 'ORN-••••-••••-••••-PQRT', plan: 'Basic', platform: 'MT5', status: 'Active', expiresAt: null, bindingVersion: 1, eligible: true,
      demoAccount: options.demo ? { id: 'demo-1', maskedAccountNumber: '••••4321', brokerServer: 'Broker-Demo', platform: 'MT5', registeredAt: '2026-08-01T00:00:00Z' } : null,
      installation: options.installation ? { id: 'install-1', hint: '••••-WXYZ', label: 'Home laptop', activatedAt: '2026-08-01T00:00:00Z', lastSeenAt: null } : null,
      pendingInstallationRequest: null,
      canChangeDemo: true, nextDemoChangeAt: null, demoCooldownReason: null,
      canReplaceInstallation: true, nextInstallationChangeAt: null, installationCooldownReason: null,
    }],
  };
}
