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
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const response = await GET(new Request('https://app.orionscalper.com/api/cron/telemetry-retention', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('cleanup_orion_trading_telemetry');
    await expect(response.json()).resolves.toMatchObject({ ok: true, rejectionsDeleted: 4, batchesDeleted: 2 });
  });
});
