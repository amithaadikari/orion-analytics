import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), getEnv: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/env', () => ({ getEnv: mocks.getEnv }));

import { GET } from '@/app/api/cron/trading-alerts/route';

const success = {
  ok: true,
  runId: '2b67576b-e87f-4ab6-b216-cbed291e0c15',
  evaluatedAt: '2026-07-21T15:10:00Z',
  scopesEvaluated: 3,
  dealsEvaluated: 4,
  alertsCreated: 2,
  notificationsCreated: 2,
  statesOpened: 1,
  statesResolved: 0,
  eventsDeduplicated: 1,
};

describe('trading alerts cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnv.mockReturnValue({ CRON_SECRET: 'cron-secret' });
  });

  it('requires the exact configured bearer secret before database access', async () => {
    expect((await GET(new Request('https://app.orionscalper.com/api/cron/trading-alerts'))).status).toBe(401);
    expect((await GET(new Request('https://app.orionscalper.com/api/cron/trading-alerts', {
      headers: { authorization: 'Bearer wrong-secret' },
    }))).status).toBe(401);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('calls only the bounded alert evaluator and validates its counters', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: success, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/trading-alerts', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('evaluate_orion_trading_alerts');
    await expect(response.json()).resolves.toEqual(success);
  });

  it('returns a sanitized unavailable response for malformed evaluator output', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/trading-alerts', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Trading alert evaluation is temporarily unavailable.' });
  });

  it('distinguishes a pending alert migration from operational failures', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'evaluate_orion_trading_alerts not found' } }),
    });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/trading-alerts', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Trading alerts are waiting for the latest database migration.' });
  });
});
