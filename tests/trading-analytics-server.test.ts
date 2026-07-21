import { describe, expect, it, vi } from 'vitest';
import {
  aggregateClosedDeals,
  loadClientTradingAnalytics,
  parseEquityPayload,
  parseExecutionActivityPayload,
  parsePerformancePayload,
} from '@/lib/trading-analytics-server';

describe('trading analytics deal aggregation', () => {
  it('aggregates partial closes by stable account position and includes all net costs', () => {
    const trades = aggregateClosedDeals([
      deal({ deal_ticket: '100', position_id: '900', entry: 'In', side: 'Buy', volume: 0.2, price: 3300, profit: 0, commission: -0.4, net_profit: -0.4, deal_time: '2026-07-21T10:00:00Z', deal_time_msc: '1784620000000' }),
      deal({ deal_ticket: '101', position_id: '900', entry: 'Out', side: 'Sell', volume: 0.1, price: 3310, profit: 10, commission: -0.2, swap: -0.1, net_profit: 9.7, deal_time: '2026-07-21T11:00:00Z', deal_time_msc: '1784623600000' }),
      deal({ deal_ticket: '102', position_id: '900', entry: 'Out', side: 'Sell', volume: 0.1, price: 3320, profit: 20, commission: -0.2, fee: -0.1, net_profit: 19.7, deal_time: '2026-07-21T12:00:00Z', deal_time_msc: '1784627200000' }),
    ] as any);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ id: '900', side: 'Buy', volume: 0.2, entryPrice: 3300, exitPrice: 3315, profit: 30, swap: -0.1, commission: -0.9, netProfit: 29 });
  });

  it('does not treat an entry-only position as a closed trade', () => {
    expect(aggregateClosedDeals([deal({ entry: 'In' })] as any)).toEqual([]);
  });
});

describe('protected analytics RPC parsing', () => {
  it('accepts the shaped equity and closed-performance responses', () => {
    expect(parseEquityPayload({
      points: [{ at: '2026-07-21T10:00:00Z', balance: 1000, equity: 1012 }],
      sampleCount: 1,
      maxDrawdownMoney: null,
      maxDrawdownPercent: null,
    })).toEqual({
      points: [{ at: '2026-07-21T10:00:00Z', balance: 1000, equity: 1012 }],
      maxDrawdownMoney: null,
      maxDrawdownPercent: null,
    });
    expect(parsePerformancePayload({
      metrics: { realizedNet: 9.4, winRate: 100, profitFactor: null, closedTrades: 1 },
      limitations: { nettingReversalsExcluded: false },
      summaries: { todayNet: 9.4, sevenDayNet: 9.4, thirtyDayNet: 9.4 },
      items: [{
        id: '900', ticket: '102', symbol: 'XAUUSD', side: 'Buy', volume: 0.1,
        openedAt: '2026-07-21T10:00:00Z', closedAt: '2026-07-21T11:00:00Z',
        entryPrice: 3300, exitPrice: 3310, profit: 10, swap: -0.1,
        commission: -0.5, netProfit: 9.4,
      }],
      hasMore: false,
    })?.metrics).toEqual({ realizedNet: 9.4, winRate: 100, profitFactor: null, closedTrades: 1 });
  });

  it('accepts and normalizes bounded execution-activity responses', () => {
    expect(parseExecutionActivityPayload({
      items: [{
        id: '101', positionId: '900', ticket: '501', symbol: 'XAUUSD', side: 'Buy',
        volume: '0.10', executedAt: '2026-07-21T11:00:00Z', exitPrice: '3310.50',
        profit: '10', swap: '-0.1', commission: '-0.5', netProfit: '9.4',
        remainingVolume: '0.10', status: 'Partial',
      }, {
        id: '102', positionId: '900', symbol: 'XAUUSD', side: 'Buy', volume: 0.1,
        executedAt: '2026-07-21T12:00:00Z', exitPrice: 3320, profit: 20,
        swap: 0, commission: -0.2, netProfit: 19.8, remainingVolume: 0, status: 'Closed',
      }],
      hasMore: true,
      incompleteHistoryExcluded: true,
    })).toEqual({
      items: [{
        id: '101', positionId: '900', ticket: '501', symbol: 'XAUUSD', side: 'Buy',
        volume: 0.1, executedAt: '2026-07-21T11:00:00Z', exitPrice: 3310.5,
        profit: 10, swap: -0.1, commission: -0.5, netProfit: 9.4,
        remainingVolume: 0.1, status: 'Partial',
      }, {
        id: '102', positionId: '900', ticket: null, symbol: 'XAUUSD', side: 'Buy', volume: 0.1,
        executedAt: '2026-07-21T12:00:00Z', exitPrice: 3320, profit: 20,
        swap: 0, commission: -0.2, netProfit: 19.8, remainingVolume: 0, status: 'Closed',
      }],
      hasMore: true,
      incompleteHistoryExcluded: true,
    });
  });

  it('fails closed on malformed or oversized database responses', () => {
    expect(parseEquityPayload({ points: [{ at: 'not-a-date', balance: 1000, equity: 1000 }], maxDrawdownMoney: 0, maxDrawdownPercent: 0 })).toBeNull();
    expect(parsePerformancePayload({
      metrics: { realizedNet: 0, winRate: 101, profitFactor: null, closedTrades: 0 },
      limitations: { nettingReversalsExcluded: false },
      summaries: { todayNet: 0, sevenDayNet: 0, thirtyDayNet: 0 },
      items: [], hasMore: false,
    })).toBeNull();
    expect(parsePerformancePayload({
      metrics: { realizedNet: 0, winRate: null, profitFactor: null, closedTrades: 0 },
      limitations: { nettingReversalsExcluded: false },
      summaries: { todayNet: 0, sevenDayNet: 0, thirtyDayNet: 0 },
      items: Array.from({ length: 101 }, () => ({})), hasMore: true,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [executionActivity({ id: 'not-numeric' })], hasMore: false, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [executionActivity({ ticket: 'not-numeric' })], hasMore: false, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [executionActivity({ remainingVolume: -0.01 })], hasMore: false, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [executionActivity({ status: 'Partial', remainingVolume: 0 })], hasMore: false, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [executionActivity({ status: 'Closed', remainingVolume: 0.01 })], hasMore: false, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [executionActivity({ executedAt: 'not-a-date', status: 'Pending' })], hasMore: false, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: Array.from({ length: 101 }, () => executionActivity()), hasMore: true, incompleteHistoryExcluded: false,
    })).toBeNull();
    expect(parseExecutionActivityPayload({ items: [], hasMore: 'false', incompleteHistoryExcluded: false })).toBeNull();
    expect(parseExecutionActivityPayload({ items: [], hasMore: false })).toBeNull();
    expect(parseExecutionActivityPayload({
      items: [], hasMore: false, incompleteHistoryExcluded: 'false',
    })).toBeNull();
  });
});

describe('protected execution-activity loading', () => {
  it('loads execution activity in the bounded detail batch without changing closed history', async () => {
    const { db, rpc } = analyticsDatabase();
    const snapshot = await loadClientTradingAnalytics(db as any, 'client-1', { range: '7d' });

    expect(rpc).toHaveBeenCalledWith('read_orion_trade_execution_activity', {
      p_client_id: 'client-1',
      p_account_scope_id: 'scope-1',
      p_since: expect.any(String),
      p_page_size: 20,
    });
    expect(snapshot.activity).toEqual({
      items: [executionActivity()],
      hasMore: false,
      incompleteHistoryExcluded: true,
    });
    expect(snapshot.history).toEqual({ items: [], nextCursor: null });
  });

  it('fails closed when the activity RPC errors or returns an invalid payload', async () => {
    const failedRpc = analyticsDatabase({ activityError: { code: 'XX000', message: 'failed' } });
    await expect(loadClientTradingAnalytics(failedRpc.db as any, 'client-1', { range: '7d' }))
      .rejects.toMatchObject({ code: 'DATABASE_ERROR', status: 500 });

    const invalidPayload = analyticsDatabase({
      activityData: {
        items: [executionActivity({ id: 'invalid' })],
        hasMore: false,
        incompleteHistoryExcluded: false,
      },
    });
    await expect(loadClientTradingAnalytics(invalidPayload.db as any, 'client-1', { range: '7d' }))
      .rejects.toMatchObject({ code: 'DATABASE_ERROR', status: 500 });
  });

  it('includes an empty activity envelope before the first telemetry sync', async () => {
    const { db, rpc } = analyticsDatabase({ ready: false });
    const snapshot = await loadClientTradingAnalytics(db as any, 'client-1', { range: '7d' });

    expect(snapshot.activity).toEqual({ items: [], hasMore: false, incompleteHistoryExcluded: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

function executionActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: '101', positionId: '900', ticket: '501', symbol: 'XAUUSD', side: 'Buy', volume: 0.1,
    executedAt: '2026-07-21T11:00:00Z', exitPrice: 3310, profit: 10, swap: -0.1,
    commission: -0.5, netProfit: 9.4, remainingVolume: 0.1, status: 'Partial',
    ...overrides,
  };
}

function deal(overrides: Record<string, unknown> = {}) {
  return {
    deal_ticket: '1', order_ticket: '2', position_id: '3', deal_time_msc: '1784620000000', deal_time: '2026-07-21T10:00:00Z',
    symbol: 'XAUUSD', side: 'Buy', entry: 'In', volume: 0.1, price: 3300, commission: 0, swap: 0, fee: 0, profit: 0, net_profit: 0,
    ...overrides,
  };
}

function analyticsDatabase(options: {
  ready?: boolean;
  activityData?: unknown;
  activityError?: { code: string; message: string } | null;
} = {}) {
  const ready = options.ready ?? true;
  const responses: Record<string, { data: unknown; error: null }> = {
    clients: { data: { id: 'client-1', status: 'Active', plan: 'Basic' }, error: null },
    licenses: { data: [{
      id: 'license-1', license_key: 'ORN-TEST', plan: 'Basic', platform: 'MT5', status: 'Active',
      expires_at: null, revoked_at: null, binding_version: 1, trading_account_id: 'account-1',
      created_at: '2026-07-21T09:00:00Z',
    }], error: null },
    orion_telemetry_account_scopes: { data: ready ? [{
      id: 'scope-1', client_id: 'client-1', license_id: 'license-1', platform: 'MT5',
      account_type: 'Real', account_number: '12345678', broker_server: 'Broker-Live',
      last_seen_at: '2026-07-21T12:00:00Z',
    }] : [], error: null },
    orion_telemetry_streams: { data: ready ? [{
      id: 'stream-1', account_scope_id: 'scope-1', client_id: 'client-1', license_id: 'license-1',
      installation_id: 'installation-1', binding_version: 1, status: 'Active',
      last_seen_at: '2026-07-21T12:00:00Z', last_captured_at: '2026-07-21T12:00:00Z',
      currency: 'USD', balance: 1000, equity: 1000, margin: 0, margin_level: 0,
      floating_profit: 0, open_position_count: 0,
    }] : [], error: null },
    license_installations: { data: [{
      id: 'installation-1', license_id: 'license-1', installation_hint: 'Desktop', status: 'Active',
    }], error: null },
    license_demo_accounts: { data: [], error: null },
    client_trading_accounts: { data: [{
      id: 'account-1', account_number: '12345678', broker_server: 'Broker-Live', platform: 'MT5',
      status: 'Active', verified_at: '2026-07-21T09:00:00Z', account_type: 'Real',
    }], error: null },
    orion_open_positions: { data: [], error: null },
  };
  const rpc = vi.fn((name: string) => {
    if (name === 'read_orion_trading_equity') return Promise.resolve({
      data: { points: [], maxDrawdownMoney: null, maxDrawdownPercent: null }, error: null,
    });
    if (name === 'read_orion_trading_performance') return Promise.resolve({
      data: {
        metrics: { realizedNet: 0, winRate: null, profitFactor: null, closedTrades: 0 },
        limitations: { nettingReversalsExcluded: false },
        summaries: { todayNet: 0, sevenDayNet: 0, thirtyDayNet: 0 },
        items: [], hasMore: false,
      },
      error: null,
    });
    if (name === 'read_orion_trade_execution_activity') return Promise.resolve({
      data: options.activityData ?? {
        items: [executionActivity()],
        hasMore: false,
        incompleteHistoryExcluded: true,
      },
      error: options.activityError ?? null,
    });
    throw new Error(`Unexpected RPC: ${name}`);
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
  for (const method of ['select', 'eq', 'order', 'limit']) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve(response));
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(response).then(resolve, reject)
  );
  return query;
}
