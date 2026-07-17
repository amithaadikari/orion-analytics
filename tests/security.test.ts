import { describe, expect, it } from 'vitest';
import { isAllowedTrackingOrigin, requireTrackingOrigin, sanitizeTrackingUrl, sanitizeUrl, sanitizeString } from '@/lib/security';

process.env.TRACKING_ALLOWED_ORIGINS = 'https://www.orionscalper.com,http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.TELEGRAM_CHANNEL_URL = 'https://t.me/example';
process.env.META_PIXEL_ID = '123';
process.env.META_ACCESS_TOKEN = 'test';
process.env.CONVERSION_INTERNAL_SECRET = '1234567890123456';
process.env.IP_HASH_SALT = '1234567890123456';

describe('input safety', () => {
  it('rejects non-http URLs and strips control characters', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeString('<script>\u0000safe</script>')).toBe('scriptsafe/script');
  });

  it('removes pseudonymous handoff values from recorded page URLs', () => {
    expect(sanitizeTrackingUrl('https://app.orionscalper.com/client-register?plan=basic&visitor_id=v_12345678&fbp=abc#session_id=s_12345678')).toBe('https://app.orionscalper.com/client-register?plan=basic');
  });

  it('allows configured origins and rejects missing or unknown origins', () => {
    const allowed = new Request('https://admin.orionscalper.com/api/track/event', { headers: { origin: 'https://www.orionscalper.com' } });
    const denied = new Request('https://admin.orionscalper.com/api/track/event', { headers: { origin: 'https://attacker.example' } });
    const missing = new Request('https://admin.orionscalper.com/api/track/event');
    expect(isAllowedTrackingOrigin(allowed)).toBe(true);
    expect(requireTrackingOrigin(allowed)).toBeNull();
    expect(requireTrackingOrigin(denied)?.status).toBe(403);
    expect(requireTrackingOrigin(missing)?.status).toBe(403);
  });

  it('allows the exact request origin for portal-side funnel events', () => {
    const sameOrigin = new Request('https://app.orionscalper.com/api/track/funnel', { headers: { origin: 'https://app.orionscalper.com' } });
    expect(isAllowedTrackingOrigin(sameOrigin)).toBe(true);
    expect(requireTrackingOrigin(sameOrigin)).toBeNull();
  });
});
