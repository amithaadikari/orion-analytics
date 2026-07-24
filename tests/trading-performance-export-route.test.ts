import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradingPerformanceSnapshot } from '@/lib/trading-performance';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadClientTradingPerformance: vi.fn(),
  publicTradingPerformanceError: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock('@/lib/trading-performance-server', () => ({
  loadClientTradingPerformance: mocks.loadClientTradingPerformance,
  publicTradingPerformanceError: mocks.publicTradingPerformanceError,
}));

import { GET } from '@/app/api/trading-performance/export/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';

describe('server-generated performance CSV export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'auth-user-1' },
      client: { id: clientId },
      admin: null,
      mfaRequired: false,
      supabase: {},
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ service: true });
    mocks.loadClientTradingPerformance.mockResolvedValue(performanceSnapshot());
    mocks.publicTradingPerformanceError.mockImplementation((error: { code?: string }) => (
      error?.code === 'PERFORMANCE_MIGRATION_REQUIRED'
        ? {
            status: 503,
            message: 'Performance Intelligence is waiting for the latest database migration.',
          }
        : { status: 500, message: 'Performance Intelligence is temporarily unavailable.' }
    ));
  });

  it.each([
    ['unauthenticated', { user: null, client: null, mfaRequired: false }, 401],
    ['awaiting MFA', { user: { id: 'auth-user-1' }, client: null, mfaRequired: true }, 403],
    ['without a linked client', { user: { id: 'auth-user-1' }, client: null, mfaRequired: false }, 403],
  ])('rejects %s access before loading export data', async (_label, session, status) => {
    mocks.getPortalSession.mockResolvedValue({ ...session, admin: null, supabase: {} });

    const response = await GET(exportRequest());

    expect(response.status).toBe(status);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadClientTradingPerformance).not.toHaveBeenCalled();
  });

  it('returns a private attachment built from the authenticated Premium report', async () => {
    const response = await GET(exportRequest());
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition'))
      .toBe('attachment; filename="orion-performance-90d-2026-07-24.csv"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.loadClientTradingPerformance).toHaveBeenCalledWith(
      { service: true },
      clientId,
      { connectionId, range: '90d' },
    );
    expect(csv).toContain('"record_type","category","label"');
    expect(csv).toContain('"summary","period","Last 90 days"');
    expect(csv).toContain('"breakdown","session_utc","Asia entry"');
  });

  it('denies Basic even if a malformed server snapshot sets csvExport true', async () => {
    const snapshot = performanceSnapshot();
    mocks.loadClientTradingPerformance.mockResolvedValue({
      ...snapshot,
      access: {
        ...snapshot.access,
        plan: 'Basic',
        allowedRanges: ['7d'],
        maxRange: '7d',
        advancedMetrics: false,
        breakdowns: false,
        csvExport: true,
        allHistory: false,
      },
      period: { ...snapshot.period, range: '7d', label: 'Last 7 days' },
    });

    const response = await GET(exportRequest('7d'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Premium or Lifetime is required for performance CSV exports.',
    });
  });

  it.each([
    ['setup-required data', { availability: 'setup_required', performance: null }],
    ['first-sync waiting data', { availability: 'waiting_first_sync', performance: null }],
    ['a ready response without a report', { availability: 'ready', performance: null }],
  ])('denies %s without emitting an empty spreadsheet', async (_label, overrides) => {
    mocks.loadClientTradingPerformance.mockResolvedValue({
      ...performanceSnapshot(),
      ...overrides,
    });

    const response = await GET(exportRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it.each([
    ['a missing connection', '?range=90d'],
    ['a missing range', `?connectionId=${connectionId}`],
    ['an invalid connection', '?connectionId=not-a-uuid&range=90d'],
    ['an invalid range', `?connectionId=${connectionId}&range=500d`],
    ['browser authority fields', `?connectionId=${connectionId}&range=90d&clientId=${clientId}&plan=Lifetime`],
  ])('strictly rejects %s before loading performance', async (_label, search) => {
    const response = await GET(new Request(
      `https://app.orionscalper.com/api/trading-performance/export${search}`,
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid performance export request',
    });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.loadClientTradingPerformance).not.toHaveBeenCalled();
  });

  it('maps an unapplied performance migration without exposing its function signature', async () => {
    const error = Object.assign(new Error(
      'function public.read_orion_performance_intelligence(uuid,uuid,timestamptz,timestamptz) does not exist',
    ), {
      code: 'PERFORMANCE_MIGRATION_REQUIRED',
      status: 503,
    });
    mocks.loadClientTradingPerformance.mockRejectedValue(error);

    const response = await GET(exportRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Performance Intelligence is waiting for the latest database migration.',
    });
    expect(mocks.publicTradingPerformanceError).toHaveBeenCalledWith(error);
  });
});

function exportRequest(range = '90d') {
  return new Request(
    `https://app.orionscalper.com/api/trading-performance/export?connectionId=${connectionId}&range=${range}`,
  );
}

function performanceSnapshot(): TradingPerformanceSnapshot {
  const aggregate = {
    key: 'XAUUSD',
    label: 'XAUUSD',
    netProfit: 80,
    closedTrades: 3,
    wins: 2,
    losses: 1,
    breakeven: 0,
    winRate: 100 / 3 * 2,
    averageNet: 80 / 3,
  };
  return {
    generatedAt: '2026-07-24T12:00:00.000Z',
    dataAsOf: '2026-07-24T11:59:30.000Z',
    access: {
      plan: 'Premium',
      allowedRanges: ['7d', '30d', '90d'],
      maxRange: '90d',
      calendar: true,
      advancedMetrics: true,
      breakdowns: true,
      csvExport: true,
      allHistory: false,
    },
    connections: [{
      id: connectionId,
      plan: 'Premium',
      platform: 'MT5',
      accountType: 'Real',
      maskedAccountNumber: '••••5678',
      brokerServer: 'OrionBroker-Live01',
      installationHint: '••••-ABCD',
    }],
    selectedConnectionId: connectionId,
    availability: 'ready',
    connection: {
      state: 'online',
      lastSeenAt: '2026-07-24T11:59:30.000Z',
      label: 'EA connected',
    },
    account: { currency: 'USD' },
    period: { range: '90d', label: 'Last 90 days', timeZone: 'UTC' },
    dataQuality: {
      partialClosesRolledIntoFinalClose: true,
      incompleteHistoryExcluded: false,
      volumeMismatchExcluded: false,
      nettingReversalsExcluded: false,
      mixedHistoricalCurrenciesDetected: false,
      currencyEvidenceComplete: true,
      coverageStart: '2026-07-23T08:00:00.000Z',
      equityCoverageStart: '2026-07-23T08:00:00.000Z',
      equityCoverageComplete: true,
      calendarBasis: 'FINAL_CLOSE_UTC',
      weekdayBasis: 'FINAL_CLOSE_UTC',
      sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS',
    },
    performance: {
      window: {
        startAt: '2026-04-25T12:00:00.000Z',
        endAt: '2026-07-24T12:00:00.000Z',
      },
      overview: {
        realizedNet: 80,
        winRate: 100 / 3 * 2,
        profitFactor: 3,
        maxDrawdownMoney: 40,
        maxDrawdownPercent: 4,
        closedTrades: 3,
      },
      metrics: {
        averageWin: 60,
        averageLoss: -40,
        expectancy: 80 / 3,
        bestTrade: 100,
        worstTrade: -40,
        maxWinStreak: 2,
        maxLossStreak: 1,
      },
      calendar: [{
        date: '2026-07-23',
        netProfit: 80,
        closedTrades: 3,
        wins: 2,
        losses: 1,
        breakeven: 0,
      }],
      breakdowns: {
        symbols: [{ ...aggregate }],
        directions: [{ ...aggregate, key: 'buy', label: 'Buy' }],
        weekdays: [{ ...aggregate, key: '4', label: 'Thursday' }],
        sessions: [{ ...aggregate, key: 'asia', label: 'Asia entry' }],
      },
    },
  };
}
