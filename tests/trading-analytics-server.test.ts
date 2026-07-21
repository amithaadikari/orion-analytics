import { describe, expect, it } from 'vitest';
import {
  aggregateClosedDeals,
  parseEquityPayload,
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
  });
});

function deal(overrides: Record<string, unknown> = {}) {
  return {
    deal_ticket: '1', order_ticket: '2', position_id: '3', deal_time_msc: '1784620000000', deal_time: '2026-07-21T10:00:00Z',
    symbol: 'XAUUSD', side: 'Buy', entry: 'In', volume: 0.1, price: 3300, commission: 0, swap: 0, fee: 0, profit: 0, net_profit: 0,
    ...overrides,
  };
}
