import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadClientTradingPerformance,
  parsePerformanceIntelligencePayload,
  publicTradingPerformanceError,
} from '@/lib/trading-performance-server';

const now = new Date('2026-07-24T12:00:00.000Z');
const clientId = '11111111-1111-4111-8111-111111111111';
const scopeId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('protected performance intelligence loading', () => {
  it('derives Basic authority from the selected active license, clamps the range, and strips advanced data', async () => {
    const { db, rpc } = performanceDatabase({ licensePlan: 'Basic' });

    const snapshot = await loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: '90d',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('read_orion_performance_intelligence', {
      p_client_id: clientId,
      p_account_scope_id: scopeId,
      p_since: '2026-07-18T00:00:00.000Z',
      p_until: now.toISOString(),
    });
    expect(snapshot.period).toEqual({ range: '7d', label: 'Last 7 days', timeZone: 'UTC' });
    expect(snapshot.access).toMatchObject({
      plan: 'Basic',
      allowedRanges: ['7d'],
      calendar: true,
      advancedMetrics: false,
      breakdowns: false,
      csvExport: false,
    });
    expect(snapshot.performance).toMatchObject({
      overview: {
        realizedNet: 80,
        winRate: 100 / 3 * 2,
        profitFactor: null,
        maxDrawdownMoney: null,
        maxDrawdownPercent: null,
        closedTrades: 3,
      },
      metrics: {
        averageWin: null,
        averageLoss: null,
        expectancy: null,
        bestTrade: null,
        worstTrade: null,
        maxWinStreak: null,
        maxLossStreak: null,
      },
      calendar: [{ date: '2026-07-23', closedTrades: 3 }],
      breakdowns: { symbols: [], directions: [], weekdays: [], sessions: [] },
    });
  });

  it('allows Premium through 90 days and returns the validated advanced report', async () => {
    const { db, rpc } = performanceDatabase({ licensePlan: 'Premium' });

    const snapshot = await loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: '90d',
    });

    expect(rpc).toHaveBeenCalledWith('read_orion_performance_intelligence', {
      p_client_id: clientId,
      p_account_scope_id: scopeId,
      p_since: '2026-04-26T00:00:00.000Z',
      p_until: now.toISOString(),
    });
    expect(snapshot.access).toMatchObject({
      plan: 'Premium',
      maxRange: '90d',
      advancedMetrics: true,
      breakdowns: true,
      csvExport: true,
      allHistory: false,
    });
    expect(snapshot.performance).toMatchObject({
      metrics: {
        averageWin: 60,
        averageLoss: -40,
        expectancy: 80 / 3,
        bestTrade: 100,
        worstTrade: -40,
        maxWinStreak: 2,
        maxLossStreak: 1,
      },
      breakdowns: {
        symbols: [{ key: 'XAUUSD', closedTrades: 3 }],
        directions: [{ key: 'buy', closedTrades: 3 }],
        weekdays: [{ key: '4', closedTrades: 3 }],
        sessions: [{ key: 'asia', closedTrades: 3 }],
      },
    });
  });

  it('uses a null lower bound for Lifetime all-history reporting', async () => {
    const { db, rpc } = performanceDatabase({ licensePlan: 'Lifetime' });

    const snapshot = await loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: 'all',
    });

    expect(rpc).toHaveBeenCalledWith('read_orion_performance_intelligence', {
      p_client_id: clientId,
      p_account_scope_id: scopeId,
      p_since: null,
      p_until: now.toISOString(),
    });
    expect(snapshot.period.range).toBe('all');
    expect(snapshot.performance?.window.startAt).toBeNull();
    expect(snapshot.access).toMatchObject({
      plan: 'Lifetime',
      maxRange: 'all',
      allHistory: true,
      csvExport: true,
    });
  });

  it('rejects a connection outside the authenticated client scope before the RPC', async () => {
    const { db, rpc } = performanceDatabase();

    await expect(loadClientTradingPerformance(db as never, clientId, {
      connectionId: '33333333-3333-4333-8333-333333333333',
      range: '7d',
    })).rejects.toMatchObject({ code: 'CONNECTION_NOT_FOUND', status: 404 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['waiting_first_sync', { ready: false, runtimeReady: true }],
    ['setup_required', { ready: false, runtimeReady: false }],
  ] as const)('returns %s without querying performance', async (availability, options) => {
    const { db, rpc } = performanceDatabase(options);

    const snapshot = await loadClientTradingPerformance(db as never, clientId, { range: '7d' });

    expect(snapshot.availability).toBe(availability);
    expect(snapshot.performance).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails only the performance loader with a migration-specific error when the new RPC is absent', async () => {
    const { db, rpc } = performanceDatabase({
      rpcError: {
        code: '42883',
        message: 'function public.read_orion_performance_intelligence(uuid, uuid, timestamptz, timestamptz) does not exist',
      },
    });

    await expect(loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: '7d',
    })).rejects.toMatchObject({ code: 'PERFORMANCE_MIGRATION_REQUIRED', status: 503 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('read_orion_performance_intelligence', expect.any(Object));
  });

  it('rejects mixed historical currencies instead of combining money values', async () => {
    const payload = performancePayload();
    payload.dataQuality.mixedHistoricalCurrenciesDetected = true;
    const { db } = performanceDatabase({ rpcData: payload });

    await expect(loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: '7d',
    })).rejects.toMatchObject({ code: 'MIXED_CURRENCY', status: 409 });
  });

  it('rejects a report currency that disagrees with the selected telemetry stream', async () => {
    const payload = performancePayload();
    payload.dataQuality.reportCurrency = 'EUR';
    const { db } = performanceDatabase({ rpcData: payload });

    await expect(loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: '7d',
    })).rejects.toMatchObject({ code: 'MIXED_CURRENCY', status: 409 });
  });

  it('rejects a report whose included trades lack complete currency evidence', async () => {
    const payload = performancePayload();
    payload.dataQuality.currencyEvidenceComplete = false;
    const { db } = performanceDatabase({ rpcData: payload });

    await expect(loadClientTradingPerformance(db as never, clientId, {
      connectionId: scopeId,
      range: '7d',
    })).rejects.toMatchObject({ code: 'MIXED_CURRENCY', status: 409 });
  });
});

describe('performance intelligence payload parsing', () => {
  it('normalizes the complete aggregate contract', () => {
    expect(parsePerformanceIntelligencePayload(performancePayload())).toMatchObject({
      report: {
        overview: { realizedNet: 80, closedTrades: 3 },
        metrics: { averageWin: 60, averageLoss: -40, maxWinStreak: 2 },
        calendar: [{ date: '2026-07-23', wins: 2, losses: 1 }],
        breakdowns: {
          symbols: [{ key: 'XAUUSD', closedTrades: 3 }],
          sessions: [{ key: 'asia', closedTrades: 3 }],
        },
      },
      dataQuality: {
        partialClosesRolledIntoFinalClose: true,
        volumeMismatchExcluded: false,
        currencyEvidenceComplete: true,
        equityCoverageStart: '2026-07-23T08:00:00.000Z',
        equityCoverageComplete: true,
        calendarBasis: 'FINAL_CLOSE_UTC',
        weekdayBasis: 'FINAL_CLOSE_UTC',
        sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS',
      },
      reportCurrency: 'USD',
    });
  });

  it.each([
    ['an impossible calendar date', (payload: PerformancePayload) => {
      payload.calendar[0].date = '2026-02-30';
    }],
    ['calendar outcome totals that do not equal closed trades', (payload: PerformancePayload) => {
      payload.calendar[0].wins = 3;
    }],
    ['calendar coverage that does not equal the overview', (payload: PerformancePayload) => {
      payload.overview.closedTrades = 4;
    }],
    ['a breakdown that does not cover every completed trade', (payload: PerformancePayload) => {
      payload.breakdowns.symbols[0].closedTrades = 2;
      payload.breakdowns.symbols[0].wins = 1;
    }],
    ['an out-of-order calendar', (payload: PerformancePayload) => {
      payload.calendar.unshift({
        ...payload.calendar[0],
        date: '2026-07-24',
      });
    }],
    ['a positive average loss', (payload: PerformancePayload) => {
      payload.metrics.averageLoss = 40;
    }],
    ['a non-finite metric', (payload: PerformancePayload) => {
      payload.metrics.expectancy = 'Infinity' as never;
    }],
    ['an invalid UTC basis', (payload: PerformancePayload) => {
      payload.dataQuality.sessionBasis = 'BROKER_LOCAL_TIME';
    }],
    ['an invalid report currency', (payload: PerformancePayload) => {
      payload.dataQuality.reportCurrency = 'US$';
    }],
    ['an invalid equity coverage timestamp', (payload: PerformancePayload) => {
      payload.dataQuality.equityCoverageStart = 'not-a-timestamp';
    }],
    ['an oversized symbol breakdown', (payload: PerformancePayload) => {
      payload.overview.closedTrades = 201;
      payload.calendar[0] = {
        ...payload.calendar[0],
        closedTrades: 201,
        wins: 201,
        losses: 0,
      };
      payload.breakdowns.symbols = Array.from({ length: 201 }, (_, index) => ({
        ...payload.breakdowns.symbols[0],
        key: `SYMBOL-${index}`,
        label: `SYMBOL-${index}`,
        closedTrades: 1,
        wins: 1,
        losses: 0,
      }));
    }],
  ])('fails closed for %s', (_label, mutate) => {
    const payload = performancePayload();
    mutate(payload);
    expect(parsePerformanceIntelligencePayload(payload)).toBeNull();
  });

  it('maps internal failures to stable public messages', () => {
    expect(publicTradingPerformanceError({ code: 'PERFORMANCE_MIGRATION_REQUIRED', status: 503 }))
      .toEqual({ status: 503, message: 'Performance Intelligence is waiting for the latest database migration.' });
    expect(publicTradingPerformanceError(new Error('raw database details')))
      .toEqual({ status: 500, message: 'Performance Intelligence is temporarily unavailable.' });
  });
});

type PerformancePayload = ReturnType<typeof performancePayload>;

function performancePayload() {
  const breakdown = {
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
      symbols: [{ ...breakdown }],
      directions: [{ ...breakdown, key: 'buy', label: 'Buy' }],
      weekdays: [{ ...breakdown, key: '4', label: 'Thursday' }],
      sessions: [{ ...breakdown, key: 'asia', label: 'Asia entry' }],
    },
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
      reportCurrency: 'USD',
      calendarBasis: 'FINAL_CLOSE_UTC',
      weekdayBasis: 'FINAL_CLOSE_UTC',
      sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS',
    },
  };
}

function performanceDatabase(options: {
  licensePlan?: 'Basic' | 'Premium' | 'Lifetime';
  ready?: boolean;
  runtimeReady?: boolean;
  rpcData?: unknown;
  rpcError?: { code: string; message: string } | null;
} = {}) {
  const licensePlan = options.licensePlan || 'Premium';
  const ready = options.ready ?? true;
  const runtimeReady = options.runtimeReady ?? true;
  const responses: Record<string, { data: unknown; error: null }> = {
    clients: { data: { id: clientId, status: 'Active' }, error: null },
    licenses: {
      data: [{
        id: 'license-1',
        plan: licensePlan,
        platform: 'MT5',
        status: 'Active',
        expires_at: null,
        revoked_at: null,
        binding_version: 2,
        trading_account_id: 'account-1',
        created_at: '2026-07-23T08:00:00.000Z',
      }],
      error: null,
    },
    orion_telemetry_account_scopes: {
      data: ready ? [{
        id: scopeId,
        client_id: clientId,
        license_id: 'license-1',
        platform: 'MT5',
        account_type: 'Real',
        account_number: '12345678',
        broker_server: 'OrionBroker-Live01',
      }] : [],
      error: null,
    },
    orion_telemetry_streams: {
      data: ready ? [{
        account_scope_id: scopeId,
        license_id: 'license-1',
        binding_version: 2,
        status: 'Active',
        last_seen_at: '2026-07-24T11:59:30.000Z',
        last_captured_at: '2026-07-24T11:59:00.000Z',
        currency: 'USD',
      }] : [],
      error: null,
    },
    license_installations: {
      data: runtimeReady ? [{
        id: 'installation-1',
        license_id: 'license-1',
        installation_hint: '••••-ABCD',
        status: 'Active',
      }] : [],
      error: null,
    },
    license_demo_accounts: { data: [], error: null },
    client_trading_accounts: {
      data: runtimeReady ? [{
        id: 'account-1',
        account_number: '12345678',
        broker_server: 'OrionBroker-Live01',
        platform: 'MT5',
        status: 'Active',
        verified_at: '2026-07-23T08:00:00.000Z',
        account_type: 'Real',
      }] : [],
      error: null,
    },
  };
  const rpc = vi.fn((name: string) => {
    if (name !== 'read_orion_performance_intelligence') {
      throw new Error(`Unexpected RPC: ${name}`);
    }
    return Promise.resolve({
      data: options.rpcData ?? performancePayload(),
      error: options.rpcError ?? null,
    });
  });

  return {
    db: {
      from: vi.fn((table: string) => databaseQuery(responses[table])),
      rpc,
    },
    rpc,
  };
}

function databaseQuery(response: { data: unknown; error: null } | undefined) {
  if (!response) throw new Error('Unexpected database table');
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(() => Promise.resolve(response));
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return query;
}
