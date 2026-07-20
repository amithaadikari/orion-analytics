import { describe, expect, it } from 'vitest';
import { isExactSameOrigin, isMissingAccountSecurityRelation, securityDeviceFromRequest, securityDeviceLabel } from '@/lib/client-security';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.TELEGRAM_CHANNEL_URL = 'https://t.me/example';
process.env.META_PIXEL_ID = '123';
process.env.META_ACCESS_TOKEN = 'test';
process.env.CONVERSION_INTERNAL_SECRET = '1234567890123456';
process.env.TRACKING_ALLOWED_ORIGINS = 'https://www.orionscalper.com';
process.env.IP_HASH_SALT = '1234567890123456';

describe('client security metadata', () => {
  it('stores normalized labels and a salted hash rather than a raw user agent or IP', () => {
    const request = new Request('https://app.orionscalper.com/api/account-security', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        'x-forwarded-for': '203.0.113.20',
        'x-vercel-ip-country': 'lk',
      },
    });
    const device = securityDeviceFromRequest(request);
    expect(device).toMatchObject({ browser: 'Chrome', os: 'macOS', device: 'Desktop', country: 'LK' });
    expect(device.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(device)).not.toContain('203.0.113.20');
    expect(JSON.stringify(device)).not.toContain('Mozilla/5.0');
    expect(securityDeviceLabel(device)).toBe('Desktop · Chrome · macOS · LK');
  });

  it('accepts only the exact mutation origin', () => {
    expect(isExactSameOrigin(new Request('https://app.orionscalper.com/api/account-security', { headers: { origin: 'https://app.orionscalper.com' } }))).toBe(true);
    expect(isExactSameOrigin(new Request('https://app.orionscalper.com/api/account-security', { headers: { origin: 'https://evil.example' } }))).toBe(false);
    expect(isExactSameOrigin(new Request('https://app.orionscalper.com/api/account-security'))).toBe(false);
  });

  it('uses the rolling-deployment fallback only for genuinely missing security objects', () => {
    expect(isMissingAccountSecurityRelation({ code: '42P01', message: 'relation does not exist' })).toBe(true);
    expect(isMissingAccountSecurityRelation({ code: 'PGRST205', message: 'table missing from schema cache' })).toBe(true);
    expect(isMissingAccountSecurityRelation({ code: 'PGRST202', message: 'function missing from schema cache' })).toBe(true);
    expect(isMissingAccountSecurityRelation({ message: 'relation client_security_events does not exist' })).toBe(true);
    expect(isMissingAccountSecurityRelation({ code: '42501', message: 'permission denied for table client_account_preferences' })).toBe(false);
    expect(isMissingAccountSecurityRelation({ code: '57014', message: 'query timed out while reading client_security_events' })).toBe(false);
  });
});
