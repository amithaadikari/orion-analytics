import { describe, expect, it } from 'vitest';
import {
  calculateMaximumDrawdown,
  calculateTradingMetrics,
  normalizeTradingAnalyticsRange,
  tradeNetProfit,
  tradingAnalyticsEntitlement,
} from '@/lib/trading-analytics';

describe('trading analytics plan access', () => {
  it('keeps Basic to seven days and a fixed recent-history window', () => {
    expect(tradingAnalyticsEntitlement('basic')).toMatchObject({
      plan: 'Basic',
      allowedRanges: ['7d'],
      advancedMetrics: false,
      historyPagination: false,
      historyPageSize: 20,
    });
    expect(normalizeTradingAnalyticsRange('90d', 'Basic')).toBe('7d');
  });

  it('unlocks advanced metrics and extended ranges for Premium', () => {
    expect(tradingAnalyticsEntitlement('Premium')).toMatchObject({
      allowedRanges: ['7d', '30d', '90d'],
      advancedMetrics: true,
      historyPagination: true,
      allHistory: false,
    });
    expect(normalizeTradingAnalyticsRange('90d', 'Premium')).toBe('90d');
    expect(normalizeTradingAnalyticsRange('365d', 'Premium')).toBe('7d');
  });

  it('reserves one-year and all-history views for Lifetime', () => {
    expect(tradingAnalyticsEntitlement('lifetime')).toMatchObject({
      maxRange: 'all',
      allHistory: true,
      allowedRanges: ['7d', '30d', '90d', '365d', 'all'],
    });
  });

  it('does not infer paid analytics access from an unknown or membership-like value', () => {
    expect(tradingAnalyticsEntitlement('Pro')).toMatchObject({ plan: 'Free', allowedRanges: [], advancedMetrics: false });
    expect(tradingAnalyticsEntitlement('Standard')).toMatchObject({ plan: 'Free', allowedRanges: [], advancedMetrics: false });
  });
});

describe('trading metric helpers', () => {
  it('uses reported net profit when available and otherwise includes swap and commission', () => {
    expect(tradeNetProfit({ profit: 12, swap: -1, commission: -2 })).toBe(9);
    expect(tradeNetProfit({ profit: 12, swap: -1, commission: -2, netProfit: 7.5 })).toBe(7.5);
  });

  it('calculates win rate, profit factor and realized net from closed market trades', () => {
    const metrics = calculateTradingMetrics([
      { netProfit: 20 },
      { netProfit: -10 },
      { netProfit: 0 },
    ]);
    expect(metrics).toMatchObject({
      realizedNet: 10,
      profitFactor: 2,
      closedTrades: 3,
    });
    expect(metrics.winRate).toBeCloseTo(100 / 3);
  });

  it('keeps profit factor and drawdown unavailable when the samples cannot support them', () => {
    expect(calculateTradingMetrics([{ netProfit: 10 }], [{ at: '2026-07-21T00:00:00Z', equity: 100 }])).toMatchObject({
      profitFactor: null,
      maxDrawdownMoney: null,
      maxDrawdownPercent: null,
    });
  });

  it('calculates peak-to-trough drawdown in time order', () => {
    expect(calculateMaximumDrawdown([
      { at: '2026-07-21T02:00:00Z', equity: 90 },
      { at: '2026-07-21T00:00:00Z', equity: 100 },
      { at: '2026-07-21T01:00:00Z', equity: 120 },
      { at: '2026-07-21T03:00:00Z', equity: 108 },
    ])).toEqual({ money: 30, percent: 25 });
  });
});
