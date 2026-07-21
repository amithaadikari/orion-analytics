import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadAdminTradingMonitor: vi.fn(),
  publicAdminTradingMonitorError: vi.fn(),
  isExactSameOrigin: vi.fn(),
  accountSecurityRateLimit: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/admin-trading-monitor-server', () => ({
  loadAdminTradingMonitor: mocks.loadAdminTradingMonitor,
  publicAdminTradingMonitorError: mocks.publicAdminTradingMonitorError,
}));
vi.mock('@/lib/client-security', () => ({
  isExactSameOrigin: mocks.isExactSameOrigin,
  accountSecurityRateLimit: mocks.accountSecurityRateLimit,
}));

import { GET, POST } from '@/app/api/admin/trading-monitor/route';

function queryResult(result: { data?: unknown[]; error?: unknown; count?: number | null }) {
  type QueryStub = {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise<unknown>;
  };
  const query = {} as QueryStub;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: null, ...result }).then(resolve, reject);
  return query;
}

describe('admin EA fleet API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-user' }, admin: { id: 'admin-1', role: 'admin' }, mfaRequired: false });
    mocks.createSupabaseAdminClient.mockReturnValue({ service: true });
    mocks.loadAdminTradingMonitor.mockResolvedValue({ generatedAt: '2026-07-21T12:00:00Z', counts: {}, items: [] });
    mocks.publicAdminTradingMonitorError.mockReturnValue({ status: 503, message: 'EA fleet unavailable.' });
    mocks.isExactSameOrigin.mockReturnValue(true);
    mocks.accountSecurityRateLimit.mockReturnValue(true);
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

  it('returns every visible open incident up to the safe bound with overflow and safe run evidence', async () => {
    mocks.requireAdminApi.mockResolvedValue({
      user: { id: 'analyst-user' },
      admin: { id: 'analyst-1', role: 'analyst' },
      mfaRequired: false,
    });
    mocks.loadAdminTradingMonitor.mockResolvedValue({
      generatedAt: '2026-07-21T12:00:00Z',
      counts: {},
      items: [{
        connectionId: 'scope-exact', clientId: 'client-1', clientName: 'Client One',
        maskedLicenseKey: 'ORN-••••-TU', maskedAccountNumber: '••••1234', eaVersion: '5.2.0',
      }],
    });
    const openQuery = queryResult({
      count: 101,
      data: [{
        id: 'open-1', incident_type: 'offline_with_open_positions', severity: 'critical',
        status: 'Open', account_scope_id: 'scope-exact', client_id: 'client-1', summary: 'Offline',
        first_detected_at: '2026-07-21T11:00:00Z', last_detected_at: '2026-07-21T12:00:00Z',
        resolved_at: null, acknowledged_at: null,
      }],
    });
    const resolvedQuery = queryResult({
      data: [{
        id: 'resolved-1', incident_type: 'offline_stream', severity: 'warning',
        status: 'Resolved', account_scope_id: 'old-scope', client_id: 'client-1', summary: 'Recovered',
        first_detected_at: '2026-07-20T11:00:00Z', last_detected_at: '2026-07-20T12:00:00Z',
        resolved_at: '2026-07-20T12:05:00Z', acknowledged_at: '2026-07-20T11:10:00Z',
      }],
    });
    const runQuery = queryResult({
      data: [{
        id: 'run-1', job_name: 'reliability-evaluator', status: 'Succeeded',
        started_at: '2026-07-21T12:00:00Z', completed_at: '2026-07-21T12:00:01Z',
        details: { skipped: true, reason: 'concurrent_evaluation' },
      }],
    });
    let incidentReads = 0;
    const from = vi.fn((table: string) => {
      if (table === 'trading_reliability_incidents') return incidentReads++ === 0 ? openQuery : resolvedQuery;
      return runQuery;
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reliability).toMatchObject({
      available: true,
      unavailableReason: null,
      canAcknowledge: false,
      openIncidentCount: 101,
      openIncidentOverflow: true,
    });
    expect(payload.reliability.incidents[0]).toMatchObject({
      maskedAccountNumber: '••••1234', maskedLicenseKey: 'ORN-••••-TU', clientName: 'Client One',
    });
    expect(payload.reliability.incidents[1]).toMatchObject({
      clientName: 'Client One', maskedAccountNumber: null, maskedLicenseKey: null,
    });
    expect(payload.reliability.incidents[0]).not.toHaveProperty('acknowledgedByEmail');
    expect(payload.reliability.runs[0]).toMatchObject({
      skipped: true, skipReason: 'concurrent_evaluation',
    });
    expect(openQuery.limit).toHaveBeenCalledWith(100);
    expect(resolvedQuery.limit).toHaveBeenCalledWith(8);
    expect(String((openQuery.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).not.toContain('acknowledged_by_email');
  });

  it.each([
    [{ code: 'PGRST205', message: 'trading_reliability_incidents relation missing' }, 'migration_pending'],
    [{ code: '42501', message: 'permission denied' }, 'temporarily_unavailable'],
  ])('distinguishes missing reliability schema from operational failures', async (databaseError, reason) => {
    const failed = queryResult({ error: databaseError });
    const ok = queryResult({ data: [] });
    let incidentReads = 0;
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => table === 'trading_reliability_incidents'
        ? (incidentReads++ === 0 ? failed : ok)
        : ok),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reliability: { available: false, unavailableReason: reason },
    });
  });

  it('lets only a full administrator acknowledge an open incident', async () => {
    mocks.requireAdminApi.mockResolvedValue({
      user: { id: 'admin-user', email: 'admin@orionscalper.com' },
      admin: { id: '4fc9c54f-ad86-4ea4-a463-c7363d130399', role: 'admin', email: 'admin@orionscalper.com' },
      mfaRequired: false,
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: {
      id: '6f8630ce-e467-4e30-9403-71c0de77ae5b',
      acknowledged_at: '2026-07-21T12:10:00Z',
      acknowledged_by_email: 'admin@orionscalper.com',
    }, error: null });
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['update', 'eq', 'is', 'select']) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = maybeSingle;
    const from = vi.fn().mockReturnValue(chain);
    mocks.createSupabaseAdminClient.mockReturnValue({ from });
    const response = await POST(new Request('https://admin.orionscalper.com/api/admin/trading-monitor', {
      method: 'POST',
      headers: { origin: 'https://admin.orionscalper.com', 'content-type': 'application/json' },
      body: JSON.stringify({ incidentId: '6f8630ce-e467-4e30-9403-71c0de77ae5b', action: 'acknowledge' }),
    }));
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith('trading_reliability_incidents');
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      acknowledged_by: '4fc9c54f-ad86-4ea4-a463-c7363d130399',
      acknowledged_by_email: 'admin@orionscalper.com',
    }));
    expect(chain.eq).toHaveBeenCalledWith('status', 'Open');
    expect(chain.is).toHaveBeenCalledWith('acknowledged_at', null);

    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'analyst' }, admin: { id: 'analyst-1', role: 'analyst' }, mfaRequired: false });
    mocks.createSupabaseAdminClient.mockClear();
    expect((await POST(new Request('https://admin.orionscalper.com/api/admin/trading-monitor', {
      method: 'POST', headers: { origin: 'https://admin.orionscalper.com', 'content-type': 'application/json' }, body: '{}',
    }))).status).toBe(403);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
