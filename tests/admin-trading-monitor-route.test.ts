import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadAdminTradingMonitor: vi.fn(),
  publicAdminTradingMonitorError: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/admin-trading-monitor-server', () => ({
  loadAdminTradingMonitor: mocks.loadAdminTradingMonitor,
  publicAdminTradingMonitorError: mocks.publicAdminTradingMonitorError,
}));

import { GET } from '@/app/api/admin/trading-monitor/route';

describe('admin EA fleet API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-user' }, admin: { id: 'admin-1', role: 'admin' }, mfaRequired: false });
    mocks.createSupabaseAdminClient.mockReturnValue({ service: true });
    mocks.loadAdminTradingMonitor.mockResolvedValue({ generatedAt: '2026-07-21T12:00:00Z', counts: {}, items: [] });
    mocks.publicAdminTradingMonitorError.mockReturnValue({ status: 503, message: 'EA fleet unavailable.' });
  });

  it('allows both approved administrator roles to inspect masked fleet health', async () => {
    let response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.loadAdminTradingMonitor).toHaveBeenCalledWith({ service: true });
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'analyst-user' }, admin: { id: 'analyst-1', role: 'analyst' }, mfaRequired: false });
    response = await GET();
    expect(response.status).toBe(200);
  });

  it('requires authenticated MFA-approved admin access before service-role reads', async () => {
    mocks.requireAdminApi.mockResolvedValue({ user: null, admin: null, mfaRequired: false });
    expect((await GET()).status).toBe(401);
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'user' }, admin: null, mfaRequired: true });
    expect((await GET()).status).toBe(403);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('maps database failures to a safe public response', async () => {
    mocks.loadAdminTradingMonitor.mockRejectedValue(new Error('sensitive database detail'));
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'EA fleet unavailable.' });
  });
});
