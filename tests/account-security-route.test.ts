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

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

import { GET, PATCH, POST } from '@/app/api/account-security/route';

const clientId = '11111111-1111-4111-8111-111111111111';

describe('account security API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'user-1', email: 'client@example.com' },
      client: { id: clientId },
      admin: null,
      mfaRequired: false,
      supabase: { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { session_id: '22222222-2222-4222-8222-222222222222' } }, error: null }) } },
    });
  });

  it('returns client-scoped preferences and hides internal session ids', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(readDatabase());
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(payload.preferences).toEqual({ licenseReminders: false, securityAlerts: true });
    expect(payload.activities[0]).toMatchObject({
      id: 'event-1',
      current: true,
      device: 'Desktop · Chrome · macOS · LK',
    });
    expect(JSON.stringify(payload)).not.toContain('22222222-2222-4222-8222-222222222222');
  });

  it('rejects cross-site or missing-origin mutations before reading the session', async () => {
    const response = await PATCH(new Request('https://app.orionscalper.com/api/account-security', {
      method: 'PATCH',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ licenseReminders: false }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.getPortalSession).not.toHaveBeenCalled();
  });

  it('rejects unknown preference keys and unrecognized security events', async () => {
    const preferenceResponse = await PATCH(jsonRequest('PATCH', { licenseReminders: true, securityAlerts: false }));
    const eventResponse = await POST(jsonRequest('POST', { event: 'admin_override' }));
    expect(preferenceResponse.status).toBe(400);
    expect(eventResponse.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('returns an explicit MFA requirement before accessing security records', async () => {
    mocks.getPortalSession.mockResolvedValue({ user: { id: 'user-1' }, client: null, admin: null, mfaRequired: true, supabase: {} });
    const response = await GET();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Authenticator verification required' });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('records a verified session through the atomic database function with server-derived copy', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: '33333333-3333-4333-8333-333333333333', created: true }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue(writeDatabase(rpc));
    const response = await POST(new Request('https://app.orionscalper.com/api/account-security', {
      method: 'POST',
      headers: {
        origin: 'https://app.orionscalper.com',
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/126.0.0.0 Safari/537.36',
        'x-forwarded-for': '203.0.113.44',
        'x-vercel-ip-country': 'LK',
      },
      body: JSON.stringify({ event: 'session_started' }),
    }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('record_client_security_event_atomic', expect.objectContaining({
      p_client_id: clientId,
      p_auth_user_id: 'user-1',
      p_session_id: '22222222-2222-4222-8222-222222222222',
      p_event_type: 'session_started',
      p_browser: 'Chrome',
      p_os: 'macOS',
      p_country: 'LK',
      p_notification: expect.stringContaining('Desktop · Chrome · macOS · LK'),
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.44');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('Mozilla/5.0');
  });
});

function jsonRequest(method: string, body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/account-security', {
    method,
    headers: { origin: 'https://app.orionscalper.com', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function readDatabase() {
  return {
    from(table: string) {
      const result = table === 'client_account_preferences'
        ? { data: { email_license_reminders: false }, error: null }
        : { data: [{
          id: 'event-1',
          session_id: '22222222-2222-4222-8222-222222222222',
          event_type: 'session_started',
          title: 'New sign-in recorded',
          detail: 'A successful Orion account session was opened.',
          browser: 'Chrome',
          os: 'macOS',
          device: 'Desktop',
          country: 'LK',
          created_at: '2026-07-20T12:00:00.000Z',
        }], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order']) builder[method] = () => builder;
      builder.maybeSingle = () => Promise.resolve(result);
      builder.limit = () => Promise.resolve(result);
      return builder;
    },
  };
}

function writeDatabase(rpc: ReturnType<typeof vi.fn>) {
  return {
    rpc,
    from() {
      const result = { data: {
        id: '33333333-3333-4333-8333-333333333333',
        session_id: '22222222-2222-4222-8222-222222222222',
        event_type: 'session_started',
        title: 'New sign-in recorded',
        detail: 'A successful Orion account session was opened.',
        browser: 'Chrome', os: 'macOS', device: 'Desktop', country: 'LK', created_at: '2026-07-20T12:00:00.000Z',
      }, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) builder[method] = () => builder;
      builder.single = () => Promise.resolve(result);
      return builder;
    },
  };
}
