import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(), createSupabaseAdminClient: vi.fn(), loadSnapshot: vi.fn(), publicError: vi.fn(), rateLimit: vi.fn(), sameOrigin: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/license-runtime-server', () => ({ loadLicenseRuntimeSnapshot: mocks.loadSnapshot, publicLicenseRuntimeError: mocks.publicError }));
vi.mock('@/lib/client-security', () => ({ accountSecurityRateLimit: mocks.rateLimit, isExactSameOrigin: mocks.sameOrigin }));

import { GET, POST } from '@/app/api/admin/license-runtime/[clientId]/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const licenseId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const context = { params: Promise.resolve({ clientId }) };

describe('admin license runtime API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-user-1' }, admin: { id: 'admin-1', role: 'admin' }, mfaRequired: false });
    mocks.rateLimit.mockReturnValue(true);
    mocks.sameOrigin.mockReturnValue(true);
    mocks.loadSnapshot.mockResolvedValue(snapshot());
    mocks.publicError.mockReturnValue({ status: 409, code: 'PAIRING_CONFLICT', message: 'Conflict', nextChangeAt: null });
  });

  it('allows analysts to inspect installation state but not reset it', async () => {
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'analyst-user' }, admin: { id: 'analyst-1', role: 'analyst' }, mfaRequired: false });
    mocks.createSupabaseAdminClient.mockReturnValue({});
    expect((await GET(new Request('https://admin.orionscalper.com/api'), context)).status).toBe(200);
    expect((await POST(adminRequest(resetBody()), context)).status).toBe(403);
  });

  it('uses the admin-only emergency reset with a mandatory audit reason', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(adminRequest(resetBody()), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('reset_license_installation_admin', {
      p_admin_user_id: 'admin-user-1', p_client_id: clientId, p_request_id: requestId, p_license_id: licenseId,
      p_reason: 'Client lost access to the previous VPS.',
    });
  });

  it('rejects short reasons and cross-site writes before the RPC', async () => {
    const rpc = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    expect((await POST(adminRequest({ ...resetBody(), reason: 'lost' }), context)).status).toBe(400);
    mocks.sameOrigin.mockReturnValue(false);
    expect((await POST(adminRequest(resetBody()), context)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

function adminRequest(body: Record<string, unknown>) {
  return new Request('https://admin.orionscalper.com/api/admin/license-runtime/client', { method: 'POST', headers: { origin: 'https://admin.orionscalper.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function resetBody() { return { action: 'resetInstallation', requestId, licenseId, reason: 'Client lost access to the previous VPS.' }; }
function snapshot() { return { serverTime: '2026-08-01T00:00:00Z', clientStatus: 'Active', membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null }, licenses: [] }; }
