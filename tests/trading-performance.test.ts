import { describe, expect, it } from 'vitest';
import {
  buildTradingPerformanceCsv,
  canExportTradingPerformance,
  isTradingPerformanceSnapshot,
  tradingPerformanceAccess,
  tradingPerformanceCsvFilename,
  type TradingPerformanceSnapshot,
} from '@/lib/trading-performance';

describe('trading performance plan access', () => {
  it.each([
    ['Free', {
      plan: 'Free',
      allowedRanges: [],
      maxRange: null,
      calendar: false,
      advancedMetrics: false,
      breakdowns: false,
      csvExport: false,
      allHistory: false,
    }],
    ['Basic', {
      plan: 'Basic',
      allowedRanges: ['7d'],
      maxRange: '7d',
      calendar: true,
      advancedMetrics: false,
      breakdowns: false,
      csvExport: false,
      allHistory: false,
    }],
    ['Premium', {
      plan: 'Premium',
      allowedRanges: ['7d', '30d', '90d'],
      maxRange: '90d',
      calendar: true,
      advancedMetrics: true,
      breakdowns: true,
      csvExport: true,
      allHistory: false,
    }],
    ['Lifetime', {
      plan: 'Lifetime',
      allowedRanges: ['7d', '30d', '90d', '365d', 'all'],
      maxRange: 'all',
      calendar: true,
      advancedMetrics: true,
      breakdowns: true,
      csvExport: true,
      allHistory: true,
    }],
  ] as const)('derives the exact %s entitlement', (plan, expected) => {
    expect(tradingPerformanceAccess(plan)).toEqual(expected);
  });

  it.each(['Pro', 'Standard', 'Enterprise', '', null, undefined])(
    'fails closed for unknown or membership-like plan %s',
    (plan) => {
      expect(tradingPerformanceAccess(plan)).toEqual(tradingPerformanceAccess('Free'));
    },
  );

  it('requires both an eligible canonical plan and the server export flag', () => {
    expect(canExportTradingPerformance({ plan: 'Premium', csvExport: true })).toBe(true);
    expect(canExportTradingPerformance({ plan: 'Lifetime', csvExport: true })).toBe(true);
    expect(canExportTradingPerformance({ plan: 'Premium', csvExport: false })).toBe(false);
    expect(canExportTradingPerformance({ plan: 'Basic', csvExport: true })).toBe(false);
    expect(canExportTradingPerformance({ plan: 'Free', csvExport: true })).toBe(false);
  });
});

describe('trading performance CSV', () => {
  it('exports the authorized aggregate report with deterministic spreadsheet-safe rows', () => {
    const snapshot = performanceSnapshot({
      performance: {
        ...performanceSnapshot().performance!,
        breakdowns: {
          ...performanceSnapshot().performance!.breakdowns,
          symbols: [{
            key: '=XAUUSD',
            label: ' =HYPERLINK("https://evil.example")',
            netProfit: 80,
            closedTrades: 3,
            wins: 2,
            losses: 1,
            breakeven: 0,
            winRate: 100 / 3 * 2,
            averageNet: 80 / 3,
          }],
        },
      },
    });

    const csv = buildTradingPerformanceCsv(snapshot);

    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('"record_type","category","label","date"');
    expect(csv).toContain('"summary","period","Last 90 days"');
    expect(csv).toContain('"daily","calendar","2026-07-23","2026-07-23"');
    expect(csv).toContain('"breakdown","symbol","\' =HYPERLINK(""https://evil.example"")"');
    expect(csv).toContain('"breakdown","session_utc","Asia entry"');
    expect(csv).not.toContain('undefined');
  });

  it('denies Basic export even when a caller fabricates the boolean flag', () => {
    const snapshot = performanceSnapshot({
      access: {
        ...performanceSnapshot().access,
        plan: 'Basic',
        allowedRanges: ['7d'],
        maxRange: '7d',
        advancedMetrics: false,
        breakdowns: false,
        csvExport: true,
        allHistory: false,
      },
    });

    expect(canExportTradingPerformance(snapshot.access)).toBe(false);
    expect(() => buildTradingPerformanceCsv(snapshot)).toThrow(
      'Performance CSV export is not available for this Orion plan.',
    );
  });

  it('uses a bounded deterministic download filename', () => {
    const snapshot = performanceSnapshot();
    expect(tradingPerformanceCsvFilename(snapshot)).toBe('orion-performance-90d-2026-07-24.csv');
    expect(tradingPerformanceCsvFilename({
      ...snapshot,
      generatedAt: 'not-a-date',
    })).toBe('orion-performance-90d-report.csv');
  });
});

describe('trading performance browser payload guard', () => {
  it('accepts a complete server snapshot', () => {
    expect(isTradingPerformanceSnapshot(performanceSnapshot())).toBe(true);
  });

  it.each([
    ['an unknown plan', (snapshot: TradingPerformanceSnapshot) => ({
      ...snapshot,
      access: { ...snapshot.access, plan: 'Enterprise' },
    })],
    ['an unknown range', (snapshot: TradingPerformanceSnapshot) => ({
      ...snapshot,
      period: { ...snapshot.period, range: '500d' },
    })],
    ['missing access flags', (snapshot: TradingPerformanceSnapshot) => ({
      ...snapshot,
      access: { plan: 'Premium', allowedRanges: ['7d'] },
    })],
    ['an empty performance object', (snapshot: TradingPerformanceSnapshot) => ({
      ...snapshot,
      performance: {},
    })],
    ['an invalid data-quality basis', (snapshot: TradingPerformanceSnapshot) => ({
      ...snapshot,
      dataQuality: { ...snapshot.dataQuality, calendarBasis: 'LOCAL_TIME' },
    })],
    ['a malformed calendar', (snapshot: TradingPerformanceSnapshot) => ({
      ...snapshot,
      performance: {
        ...snapshot.performance,
        calendar: [{ date: 'not-a-date', netProfit: '80' }],
      },
    })],
  ])('fails closed for %s', (_label, mutate) => {
    expect(isTradingPerformanceSnapshot(mutate(performanceSnapshot()))).toBe(false);
  });
});

function performanceSnapshot(
  overrides: Partial<TradingPerformanceSnapshot> = {},
): TradingPerformanceSnapshot {
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
      id: '11111111-1111-4111-8111-111111111111',
      plan: 'Premium',
      platform: 'MT5',
      accountType: 'Real',
      maskedAccountNumber: '••••5678',
      brokerServer: 'OrionBroker-Live01',
      installationHint: '••••-ABCD',
    }],
    selectedConnectionId: '11111111-1111-4111-8111-111111111111',
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
        symbols: [{
          key: 'XAUUSD',
          label: 'XAUUSD',
          netProfit: 80,
          closedTrades: 3,
          wins: 2,
          losses: 1,
          breakeven: 0,
          winRate: 100 / 3 * 2,
          averageNet: 80 / 3,
        }],
        directions: [{
          key: 'buy',
          label: 'Buy',
          netProfit: 80,
          closedTrades: 3,
          wins: 2,
          losses: 1,
          breakeven: 0,
          winRate: 100 / 3 * 2,
          averageNet: 80 / 3,
        }],
        weekdays: [{
          key: '4',
          label: 'Thursday',
          netProfit: 80,
          closedTrades: 3,
          wins: 2,
          losses: 1,
          breakeven: 0,
          winRate: 100 / 3 * 2,
          averageNet: 80 / 3,
        }],
        sessions: [{
          key: 'asia',
          label: 'Asia entry',
          netProfit: 80,
          closedTrades: 3,
          wins: 2,
          losses: 1,
          breakeven: 0,
          winRate: 100 / 3 * 2,
          averageNet: 80 / 3,
        }],
      },
    },
    ...overrides,
  };
}
