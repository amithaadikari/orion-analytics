import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), getEnv: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/env', () => ({ getEnv: mocks.getEnv }));

import { GET } from '@/app/api/cron/license-reminders/route';

describe('license reminder preferences', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T06:00:00.000Z'));
    mocks.getEnv.mockReturnValue({ CRON_SECRET: 'cron-secret', RESEND_API_KEY: 'resend-key', RENEWAL_EMAIL_FROM: 'Orion <noreply@example.com>', CLIENT_PORTAL_URL: 'https://app.orionscalper.com' });
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('does not send an optional email after the client opts out', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(reminderDatabase({ preferenceData: [{ client_id: 'client-1', email_license_reminders: false }], preferenceError: null }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/license-reminders', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ preferenceOptOutsSkipped: 1, remindersSent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed for email delivery when preference storage has a transient error', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(reminderDatabase({ preferenceData: null, preferenceError: { code: '57014', message: 'query timed out' } }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/license-reminders', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the preference table exists but cannot be read', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(reminderDatabase({
      preferenceData: null,
      preferenceError: { code: '42501', message: 'permission denied for table client_account_preferences' },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/license-reminders', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function reminderDatabase({ preferenceData, preferenceError }: { preferenceData: unknown; preferenceError: unknown }) {
  return {
    from(table: string) {
      if (table === 'licenses') return query({ data: [{ id: 'license-1', client_id: 'client-1', license_key: 'ORI-1', platform: 'MT5', plan: 'Basic', status: 'Active', expires_at: '2026-07-27T23:59:59.999Z' }], error: null });
      if (table === 'clients') return query({ data: [{ id: 'client-1', full_name: 'Orion Trader', email: 'trader@example.com', plan: 'Basic', status: 'Active' }], error: null });
      if (table === 'client_account_preferences') return query({ data: preferenceData, error: preferenceError });
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'not', 'in']) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}
