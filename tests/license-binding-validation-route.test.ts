import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.TELEGRAM_CHANNEL_URL = 'https://t.me/example';
process.env.META_PIXEL_ID = '123';
process.env.META_ACCESS_TOKEN = 'test';
process.env.CONVERSION_INTERNAL_SECRET = '1234567890123456';
process.env.TRACKING_ALLOWED_ORIGINS = 'https://www.orionscalper.com';
process.env.IP_HASH_SALT = '1234567890123456';

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), rateLimit: vi.fn(), missing: vi.fn(), hashInstallationId: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/license-runtime-server', () => ({ isMissingLicenseRuntimeSchema: mocks.missing, hashInstallationId: mocks.hashInstallationId }));

import { POST } from '@/app/api/license/validate/route';
import { hashLicenseKey } from '@/lib/license-keys';

describe('EA license-binding validation API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 20 });
    mocks.hashInstallationId.mockReturnValue('a'.repeat(64));
  });

  it('sends only normalized hashes and the exact Demo identity to PostgreSQL', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { valid: true, code: 'VALID', accountType: 'Demo', plan: 'Basic', platform: 'MT5', bindingVersion: 4, expiresAt: null, validatedAt: '2026-08-01T00:00:00Z' }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(validationRequest({ licenseKey: ' orn-acde-fghj-klmn-pqrt ', accountNumber: '12345678', brokerServer: 'Broker-Demo', platform: 'MT5', accountType: 'Demo', installationId: 'orn-inst-abcd-efgh-jklm-npqr-stuv-wxyz' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ valid: true, accountType: 'Demo', plan: 'Basic', bindingVersion: 4, revalidateAfterSeconds: 300 });
    expect(rpc).toHaveBeenCalledWith('validate_orion_license_runtime', {
      p_key_hash: hashLicenseKey('ORN-ACDE-FGHJ-KLMN-PQRT'), p_account_number: '12345678', p_broker_server: 'Broker-Demo', p_platform: 'MT5',
      p_account_type: 'Demo', p_installation_hash: 'a'.repeat(64),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('ORN-ACDE-FGHJ-KLMN-PQRT');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ');
  });

  it('returns Demo mismatch without caching a successful decision', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { valid: false, code: 'DEMO_ACCOUNT_MISMATCH' }, error: null }) });
    const response = await POST(validationRequest({ licenseKey: 'ORN-ACDE-FGHJ-KLMN-PQRT', accountNumber: '87654321', brokerServer: 'Broker-Demo', platform: 'MT5', accountType: 'Demo', installationId: 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ' }));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ valid: false, code: 'DEMO_ACCOUNT_MISMATCH' });
  });

  it('rejects a confused success response for a different account type', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { valid: true, code: 'VALID', accountType: 'Real', plan: 'Basic', platform: 'MT5', bindingVersion: 1, expiresAt: null, validatedAt: '2026-08-01T00:00:00Z' }, error: null }) });
    const response = await POST(validationRequest({ licenseKey: 'ORN-ACDE-FGHJ-KLMN-PQRT', accountNumber: '87654321', brokerServer: 'Broker-Demo', platform: 'MT5', accountType: 'Demo', installationId: 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ' }));
    expect(response.status).toBe(503);
  });

  it('rejects malformed or extra fields without accessing the database', async () => {
    const response = await POST(validationRequest({ licenseKey: 'bad', accountNumber: '12', brokerServer: 'x', platform: 'MT5', accountType: 'Real', installationId: 'bad', clientId: 'secret' }));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

function validationRequest(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/license/validate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40' }, body: JSON.stringify(body) });
}
