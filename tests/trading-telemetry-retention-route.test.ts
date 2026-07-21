import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), getEnv: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/env', () => ({ getEnv: mocks.getEnv }));

import { GET } from '@/app/api/cron/telemetry-retention/route';

describe('trading telemetry retention cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnv.mockReturnValue({ CRON_SECRET: 'cron-secret' });
  });

  it('requires the configured cron bearer secret', async () => {
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/telemetry-retention'));
    expect(response.status).toBe(401);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('runs only the bounded database cleanup RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ok: true,
      rejectionsDeleted: 4,
      rateLimitsDeleted: 3,
      batchesDeleted: 2,
      snapshotsDeleted: 1,
      dealsDeleted: 0,
      positionsDeleted: 0,
    }, error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc, from });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/telemetry-retention', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('cleanup_orion_trading_telemetry');
    await expect(response.json()).resolves.toMatchObject({ ok: true, rejectionsDeleted: 4, batchesDeleted: 2, auditRecorded: true });
    expect(from).toHaveBeenCalledWith('trading_reliability_runs');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'telemetry-retention',
      status: 'Succeeded',
      details: expect.objectContaining({ rejectionsDeleted: 4, batchesDeleted: 2 }),
    }));
  });

  it('keeps cleanup active during the migration rollout but marks the missing audit', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ok: true,
      rejectionsDeleted: 0,
      rateLimitsDeleted: 0,
      batchesDeleted: 0,
      snapshotsDeleted: 0,
      dealsDeleted: 0,
      positionsDeleted: 0,
    }, error: null });
    const insert = vi.fn().mockResolvedValue({ error: {
      code: '42P01', message: 'relation trading_reliability_runs does not exist',
    } });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc, from: vi.fn().mockReturnValue({ insert }) });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/telemetry-retention', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, auditRecorded: false });
  });

  it.each([
    ['missing', { positionsDeleted: undefined }],
    ['negative', { dealsDeleted: -1 }],
    ['fractional', { snapshotsDeleted: 1.5 }],
    ['non-numeric', { rateLimitsDeleted: '3' }],
  ])('rejects a %s cleanup counter and records a failed run', async (_label, override) => {
    const result: Record<string, unknown> = {
      ok: true,
      rejectionsDeleted: 4,
      rateLimitsDeleted: 3,
      batchesDeleted: 2,
      snapshotsDeleted: 1,
      dealsDeleted: 0,
      positionsDeleted: 0,
      ...override,
    };
    if ('positionsDeleted' in override && override.positionsDeleted === undefined) {
      delete result.positionsDeleted;
    }

    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc, from });

    const response = await GET(new Request('https://app.orionscalper.com/api/cron/telemetry-retention', {
      headers: { authorization: 'Bearer cron-secret' },
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'Trading telemetry retention is temporarily unavailable.' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'telemetry-retention',
      status: 'Failed',
      error_code: 'RETENTION_RESULT_INVALID',
      details: {},
    }));
    expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'Succeeded' }));
  });
});
