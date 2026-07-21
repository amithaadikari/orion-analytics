import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  hashInstallationId: vi.fn(),
  missingSchema: vi.fn(),
  pairingPollProof: vi.fn(),
  hashPairingPollProof: vi.fn(),
  generatePairingMatchCode: vi.fn(),
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/license-runtime-server', () => ({
  hashInstallationId: mocks.hashInstallationId,
  isMissingLicenseRuntimeSchema: mocks.missingSchema,
}));
vi.mock('@/lib/license-device-pairing-server', () => ({
  pairingPollProof: mocks.pairingPollProof,
  hashPairingPollProof: mocks.hashPairingPollProof,
  generatePairingMatchCode: mocks.generatePairingMatchCode,
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  getClientIp: mocks.getClientIp,
  hashIp: mocks.hashIp,
}));

import { POST } from '@/app/api/license/device-requests/route';
import { hashLicenseKey } from '@/lib/license-keys';

const licenseKey = 'ORN-ACDE-FGHJ-KLMN-PQRT';
const installationId = 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ';
const pairingRequestId = '33333333-3333-4333-8333-333333333333';
const proof = 'c'.repeat(64);

describe('EA installation approval request API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 10 });
    mocks.getClientIp.mockReturnValue('203.0.113.40');
    mocks.hashIp.mockReturnValue('d'.repeat(64));
    mocks.hashInstallationId.mockReturnValue('a'.repeat(64));
    mocks.pairingPollProof.mockReturnValue(proof);
    mocks.hashPairingPollProof.mockReturnValue('b'.repeat(64));
    mocks.generatePairingMatchCode.mockReturnValue('482731');
    mocks.missingSchema.mockReturnValue(false);
  });

  it('creates a pending request using only hashed installation and polling authority', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      accepted: true, code: 'PAIRING_PENDING', status: 'Pending', requestId: pairingRequestId,
      matchCode: '482731', expiresAt: '2026-08-02T00:10:00Z', reused: false,
    }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request(createBody()));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      accepted: true, status: 'Pending', requestId: pairingRequestId, matchCode: '482731', pollAfterSeconds: 15,
    });
    expect(rpc).toHaveBeenCalledWith('request_license_installation_approval', {
      p_key_hash: hashLicenseKey(licenseKey),
      p_installation_hash: 'a'.repeat(64),
      p_installation_hint: '••••-WXYZ',
      p_device_label: 'Home MT5 terminal',
      p_account_number: '87654321',
      p_broker_server: 'Broker-Demo',
      p_platform: 'MT5',
      p_account_type: 'Demo',
      p_poll_proof_hash: 'b'.repeat(64),
      p_match_code: '482731',
      p_request_ip_hash: 'd'.repeat(64),
    });
    expect(rpc.mock.calls[1]?.[0]).toBe('cleanup_license_installation_approval_state');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(licenseKey);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(installationId);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(proof);
  });

  it('returns immediate approval when this installation is already active', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({
      data: { accepted: true, code: 'INSTALLATION_ALREADY_ACTIVE', status: 'Approved' }, error: null,
    }) });
    const response = await POST(request(createBody()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true, code: 'INSTALLATION_ALREADY_ACTIVE', status: 'Approved', pollAfterSeconds: 0,
    });
  });

  it('polls with a one-way hash of the deterministic proof', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      found: true, code: 'PAIRING_APPROVED', status: 'Approved', expiresAt: '2026-08-02T00:10:00Z', resolvedAt: '2026-08-02T00:02:00Z',
    }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request({ action: 'status', requestId: pairingRequestId, pollProof: proof }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ found: true, code: 'PAIRING_APPROVED', status: 'Approved', pollAfterSeconds: 0 });
    expect(rpc).toHaveBeenCalledWith('poll_license_installation_approval', {
      p_request_id: pairingRequestId,
      p_poll_proof_hash: 'b'.repeat(64),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(proof);
  });

  it('does not run global cleanup on every pending poll', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      found: true, code: 'PAIRING_PENDING', status: 'Pending', expiresAt: '2026-08-02T00:10:00Z', resolvedAt: null,
    }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(request({ action: 'status', requestId: pairingRequestId, pollProof: proof }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ found: true, code: 'PAIRING_PENDING', status: 'Pending', pollAfterSeconds: 15 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('returns the same not-found response for an unknown request or proof', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { found: false, code: 'INVALID_PAIRING_REQUEST' }, error: null }) });
    const response = await POST(request({ action: 'status', requestId: pairingRequestId, pollProof: proof }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ found: false, code: 'INVALID_PAIRING_REQUEST' });
  });

  it('rejects malformed, extra, non-JSON, and rate-limited requests before database access', async () => {
    expect((await POST(request({ ...createBody(), clientId: 'secret' }))).status).toBe(400);
    expect((await POST(new Request('https://admin.orionscalper.com/api/license/device-requests', { method: 'POST', body: '{}' }))).status).toBe(415);
    mocks.rateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    expect((await POST(request(createBody()))).status).toBe(429);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('reports the additive migration boundary without leaking database details', async () => {
    mocks.missingSchema.mockReturnValue(true);
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function missing' } }) });
    const response = await POST(request(createBody()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ accepted: false, code: 'PAIRING_MIGRATION_REQUIRED' });
  });
});

function createBody() {
  return {
    action: 'create', licenseKey, installationId, accountNumber: '87654321', brokerServer: 'Broker-Demo',
    platform: 'MT5', accountType: 'Demo', deviceLabel: 'Home MT5 terminal',
  };
}

function request(body: Record<string, unknown>) {
  return new Request('https://admin.orionscalper.com/api/license/device-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40' },
    body: JSON.stringify(body),
  });
}
