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
  requireAdminApi: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

import { GET, PATCH, POST } from '@/app/api/admin-account-security/route';

const adminId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

describe('administrator account security API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({
      user: {
        id: 'admin-user-1',
        email: 'owner@orionscalper.com',
        email_confirmed_at: '2026-07-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        last_sign_in_at: '2026-07-20T12:00:00.000Z',
        updated_at: new Date().toISOString(),
        factors: [{ factor_type: 'totp', status: 'verified' }],
      },
      admin: { id: adminId, email: 'owner@orionscalper.com', role: 'admin' },
      mfaRequired: false,
      supabase: { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { session_id: sessionId } }, error: null }) } },
    });
  });

  it('returns only the current administrator profile and a sanitized activity feed', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(readDatabase());
    const response = await GET(adminRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(payload.profile).toEqual({ displayName: 'Orion Owner', avatarKey: 'robot-radar' });
    expect(payload.preferences).toMatchObject({ theme: 'black', supportAlerts: false });
    expect(payload.activities[0]).toMatchObject({ current: true, device: 'Desktop · Chrome · macOS · LK' });
    expect(JSON.stringify(payload)).not.toContain(sessionId);
    expect(JSON.stringify(payload)).not.toContain('ip_hash');
  });

  it('rejects cross-site mutations before reading administrator authentication', async () => {
    const response = await PATCH(new Request('https://admin.orionscalper.com/api/admin-account-security', {
      method: 'PATCH',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'theme', theme: 'black' }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.requireAdminApi).not.toHaveBeenCalled();
  });

  it('rejects unknown settings and security events without touching the database', async () => {
    const settingResponse = await PATCH(jsonRequest('PATCH', { action: 'theme', theme: 'black', isAdmin: true }));
    const eventResponse = await POST(jsonRequest('POST', { event: 'role_changed' }));
    expect(settingResponse.status).toBe(400);
    expect(eventResponse.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('persists only allow-listed preferences for the authenticated administrator', async () => {
    const upsert = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue(preferenceDatabase(upsert));
    const response = await PATCH(jsonRequest('PATCH', {
      action: 'preferences',
      registrationAlerts: false,
      paymentAlerts: true,
      licenseAlerts: false,
      supportAlerts: true,
    }));
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      admin_id: adminId,
      registration_alerts: false,
      payment_alerts: true,
      license_alerts: false,
      support_alerts: true,
    }), { onConflict: 'admin_id' });
  });

  it('records a verified sign-in with server-derived normalized device data', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: '33333333-3333-4333-8333-333333333333', created: true }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue(eventDatabase(rpc));
    const response = await POST(adminRequest('POST', { event: 'session_started' }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('record_admin_account_event_atomic', expect.objectContaining({
      p_admin_id: adminId,
      p_auth_user_id: 'admin-user-1',
      p_session_id: sessionId,
      p_event_type: 'session_started',
      p_browser: 'Chrome',
      p_os: 'macOS',
      p_country: 'LK',
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.44');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('Mozilla/5.0');
  });

  it('does not accept an unverified password-change claim from an old session state', async () => {
    const current = await mocks.requireAdminApi();
    mocks.requireAdminApi.mockResolvedValue({ ...current, user: { ...current.user, updated_at: '2026-01-01T00:00:00.000Z' } });
    const response = await POST(adminRequest('POST', { event: 'password_changed' }));
    expect(response.status).toBe(409);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

function jsonRequest(method: string, body: Record<string, unknown>) {
  return adminRequest(method, body);
}

function adminRequest(method = 'GET', body?: Record<string, unknown>) {
  return new Request('https://admin.orionscalper.com/api/admin-account-security', {
    method,
    headers: {
      origin: 'https://admin.orionscalper.com',
      ...(body ? { 'content-type': 'application/json' } : {}),
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/126.0.0.0 Safari/537.36',
      'x-forwarded-for': '203.0.113.44',
      'x-vercel-ip-country': 'LK',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function builder(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) chain[method] = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.limit = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  return chain;
}

function readDatabase() {
  return {
    from(table: string) {
      if (table === 'admin_account_preferences') return builder({ data: {
        display_name: 'Orion Owner', avatar_key: 'robot-radar', dashboard_theme: 'black',
        registration_alerts: true, payment_alerts: true, license_alerts: true, support_alerts: false,
      }, error: null });
      return builder({ data: [{
        id: 'event-1', session_id: sessionId, event_type: 'session_started', title: 'New administrator sign-in',
        detail: 'A successful Orion administrator session was opened.', browser: 'Chrome', os: 'macOS',
        device: 'Desktop', country: 'LK', created_at: '2026-07-20T12:00:00.000Z',
      }], error: null });
    },
  };
}

function preferenceDatabase(upsert: ReturnType<typeof vi.fn>) {
  const saved = { data: {
    display_name: null, avatar_key: 'robot-core', dashboard_theme: 'royal',
    registration_alerts: false, payment_alerts: true, license_alerts: false, support_alerts: true,
  }, error: null };
  return {
    from() {
      const chain = builder(saved);
      chain.upsert = (values: unknown, options: unknown) => { upsert(values, options); return chain; };
      return chain;
    },
    rpc: vi.fn().mockResolvedValue({ data: { id: 'event-preference', created: true }, error: null }),
  };
}

function eventDatabase(rpc: ReturnType<typeof vi.fn>) {
  return {
    rpc,
    from() {
      return builder({ data: {
        id: '33333333-3333-4333-8333-333333333333', session_id: sessionId, event_type: 'session_started',
        title: 'New administrator sign-in', detail: 'A successful Orion administrator session was opened.',
        browser: 'Chrome', os: 'macOS', device: 'Desktop', country: 'LK', created_at: '2026-07-20T12:00:00.000Z',
      }, error: null });
    },
  };
}
