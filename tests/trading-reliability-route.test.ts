import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), getEnv: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/env', () => ({ getEnv: mocks.getEnv }));

import { GET } from '@/app/api/cron/trading-reliability/route';

const success = {
  ok: true,
  runId: '2b67576b-e87f-4ab6-b216-cbed291e0c15',
  evaluatedAt: '2026-07-21T12:10:00Z',
  streamsEvaluated: 3,
  offlineWithOpenPositions: 1,
  offlineStreams: 0,
  rejectionsWindow: 2,
  rejectionSpikes: 0,
  incidentsDetected: 1,
  incidentsOpened: 1,
  incidentsRefreshed: 0,
  incidentsResolved: 0,
};

describe('trading reliability cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnv.mockReturnValue({ CRON_SECRET: 'cron-secret' });
  });

  it('requires the exact configured bearer secret before creating a database client', async () => {
    expect((await GET(new Request('https://app.orionscalper.com/api/cron/trading-reliability'))).status).toBe(401);
    expect((await GET(new Request('https://app.orionscalper.com/api/cron/trading-reliability', {
      headers: { authorization: 'Bearer wrong-secret' },
    }))).status).toBe(401);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('calls only the bounded reliability evaluator RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: success, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/trading-reliability', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('evaluate_orion_trading_reliability');
    await expect(response.json()).resolves.toEqual(success);
  });

  it('returns a generic unavailable response for a persisted evaluator failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ok: false,
      runId: '2b67576b-e87f-4ab6-b216-cbed291e0c15',
      evaluatedAt: '2026-07-21T12:10:00Z',
      code: 'EVALUATOR_FAILED',
    }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/trading-reliability', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Trading reliability evaluation is temporarily unavailable.' });
  });
});
