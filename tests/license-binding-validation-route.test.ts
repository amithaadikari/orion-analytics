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

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), rateLimit: vi.fn(), missing: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/trading-accounts-server', () => ({ isMissingTradingAccountSchema: mocks.missing }));

import { POST } from '@/app/api/license/validate/route';
import { hashLicenseKey } from '@/lib/license-keys';

describe('EA license-binding validation API', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 20 }); });

  it('sends only a normalized key hash and the exact registered identity to PostgreSQL', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { valid: true, code: 'VALID', bindingVersion: 4 }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await POST(validationRequest({ licenseKey: ' orn-acde-fghj-klmn-pqrt ', accountNumber: '12345678', brokerServer: 'Broker-Live', platform: 'MT5' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ valid: true, bindingVersion: 4, revalidateAfterSeconds: 300 });
    expect(rpc).toHaveBeenCalledWith('validate_orion_license_binding', {
      p_key_hash: hashLicenseKey('ORN-ACDE-FGHJ-KLMN-PQRT'), p_account_number: '12345678', p_broker_server: 'Broker-Live', p_platform: 'MT5',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('ORN-ACDE-FGHJ-KLMN-PQRT');
  });

  it('returns account mismatch without caching a successful decision', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { valid: false, code: 'ACCOUNT_MISMATCH' }, error: null }) });
    const response = await POST(validationRequest({ licenseKey: 'ORN-ACDE-FGHJ-KLMN-PQRT', accountNumber: '87654321', brokerServer: 'Broker-Live', platform: 'MT5' }));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ valid: false, code: 'ACCOUNT_MISMATCH' });
  });

  it('rejects malformed or extra fields without accessing the database', async () => {
    const response = await POST(validationRequest({ licenseKey: 'bad', accountNumber: '12', brokerServer: 'x', platform: 'MT5', clientId: 'secret' }));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

function validationRequest(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/license/validate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40' }, body: JSON.stringify(body) });
}
