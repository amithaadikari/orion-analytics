// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClientPerformanceCenter from '@/components/client-performance-center';
import {
  tradingPerformanceAccess,
  type TradingPerformanceReport,
  type TradingPerformanceSnapshot,
} from '@/lib/trading-performance';
import type { TradingAnalyticsPlan } from '@/lib/trading-analytics';

const firstConnectionId = '11111111-1111-4111-8111-111111111111';
const secondConnectionId = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('client Performance Center entitlements and accessibility', () => {
  it('boots once for Basic and exposes only the grouped overview, calendar, and upgrade lock', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(performanceSnapshot('Basic')));
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    expect(await screen.findByRole('heading', { name: 'Performance overview' })).toBeTruthy();
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/trading-performance?range=7d', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
    }));
    expect(screen.getByRole('button', { name: '7D' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: '30D' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Unlock advanced performance intelligence' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Advanced performance metrics' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Performance breakdown view' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Export .* performance as CSV/i })).toBeNull();

    const calendarLabels = screen.getAllByRole('listitem')
      .map((item) => item.getAttribute('aria-label'))
      .filter((label): label is string => Boolean(label));
    expect(calendarLabels.some((label) => /: profit .+40\.00, 1 closed trade$/i.test(label))).toBe(true);
    expect(calendarLabels.some((label) => /: loss .+20\.00, 1 closed trade$/i.test(label))).toBe(true);
    expect(calendarLabels.some((label) => /: flat result .+0\.00, 1 closed trade$/i.test(label))).toBe(true);
    expect(calendarLabels.some((label) => /: no closed trades$/i.test(label))).toBe(true);

    const profitDay = screen.getByRole('listitem', {
      name: /: profit .+40\.00, 1 closed trade$/i,
    });
    expect(profitDay.getAttribute('data-tone')).toBe('positive');
    expect(profitDay.querySelector('strong')?.textContent).toMatch(/^\+.+40\.00$/);
    expect(profitDay.querySelector('small')?.textContent).toBe('1 trade');
  });

  it('shows Premium metrics, secure CSV access, and a complete roving-tab keyboard model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(performanceSnapshot('Premium')));
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    expect(await screen.findByRole('heading', { name: 'Advanced performance metrics' })).toBeTruthy();
    expect(screen.getByText('1.50×')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Export last 7 days performance as CSV' }).getAttribute('href'))
      .toBe(`/api/trading-performance/export?connectionId=${firstConnectionId}&range=7d`);
    expect(screen.getByRole('button', { name: '30D' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '90D' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1Y' })).toBeNull();

    const tablist = screen.getByRole('tablist', { name: 'Performance breakdown view' });
    const symbol = within(tablist).getByRole('tab', { name: 'Symbol, 1 categories' });
    const direction = within(tablist).getByRole('tab', { name: 'Direction, 1 categories' });
    const session = within(tablist).getByRole('tab', { name: 'Session, 1 categories' });
    expect(symbol.getAttribute('aria-selected')).toBe('true');
    expect(symbol.getAttribute('tabindex')).toBe('0');
    expect(direction.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(symbol, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(direction);
    expect(direction.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Direction, 1 categories' }).id)
      .toBe(direction.getAttribute('aria-controls'));

    fireEvent.keyDown(direction, { key: 'End' });
    expect(document.activeElement).toBe(session);
    expect(session.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(session, { key: 'Home' });
    expect(document.activeElement).toBe(symbol);
    fireEvent.keyDown(symbol, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(session);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes Lifetime all-history controls and an all-history CSV URL', async () => {
    const lifetime = performanceSnapshot('Lifetime', {
      period: { range: 'all', label: 'All recorded history', timeZone: 'UTC' },
      performance: {
        ...performanceReport(),
        window: {
          startAt: '2025-11-01T00:00:00.000Z',
          endAt: '2026-07-24T12:00:00.000Z',
        },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lifetime));
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    expect(await screen.findByText('Lifetime Performance')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1Y' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Export all recorded history performance as CSV' }).getAttribute('href'))
      .toBe(`/api/trading-performance/export?connectionId=${firstConnectionId}&range=all`);
    expect(screen.getByText('All recorded history and advanced intelligence')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('client Performance Center request lifecycle', () => {
  it('requests authoritative connection and range changes with the selected scope', async () => {
    const connections = [
      connection(firstConnectionId, 'Premium', '5678', 'Live01', 'ABCD'),
      connection(secondConnectionId, 'Premium', '4321', 'Live02', 'EFGH'),
    ];
    const first = performanceSnapshot('Premium', { connections });
    const second = performanceSnapshot('Premium', {
      connections,
      selectedConnectionId: secondConnectionId,
      performance: performanceReport({ realizedNet: 120 }),
    });
    const secondThirtyDays = {
      ...second,
      period: { range: '30d', label: 'Last 30 days', timeZone: 'UTC' as const },
      performance: {
        ...second.performance!,
        window: {
          startAt: '2026-06-25T00:00:00.000Z',
          endAt: '2026-07-24T12:00:00.000Z',
        },
      },
    };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`connectionId=${secondConnectionId}`) && url.includes('range=30d')) {
        return Promise.resolve(jsonResponse(secondThirtyDays));
      }
      if (url.includes(`connectionId=${secondConnectionId}`)) {
        return Promise.resolve(jsonResponse(second));
      }
      return Promise.resolve(jsonResponse(first));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    const picker = await screen.findByRole('combobox', { name: /Trading connection/i });
    fireEvent.change(picker, { target: { value: secondConnectionId } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `/api/trading-performance?range=7d&connectionId=${secondConnectionId}`,
    );
    expect(await screen.findByText('OrionBroker-Live02 · Device ••••-EFGH')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      `/api/trading-performance?range=30d&connectionId=${secondConnectionId}`,
    );
    expect(await screen.findByText('UTC · Last 30 days')).toBeTruthy();
  });

  it('keeps the last successful report visible while a refresh is pending and after it fails', async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(performanceSnapshot('Premium')))
      .mockImplementationOnce(() => refresh.promise);
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    const overview = await screen.findByLabelText('Performance overview metrics');
    expect(within(overview).getByText('+$20.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Performance Center' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(overview).getByText('+$20.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh Performance Center' }).textContent)
      .toContain('Refreshing');

    await act(async () => {
      refresh.resolve(jsonResponse({ error: 'Secure reporting database is unavailable.' }, 503));
    });

    expect((await screen.findByRole('alert')).textContent)
      .toContain('Couldn’t refresh performance intelligence');
    expect(screen.getByRole('alert').textContent).toContain('Showing the last successful report');
    expect(within(overview).getByText('+$20.00')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Performance overview' })).toBeTruthy();
  });

  it('aborts an in-flight refresh on selection and ignores its stale response', async () => {
    const connections = [
      connection(firstConnectionId, 'Premium', '5678', 'Live01', 'ABCD'),
      connection(secondConnectionId, 'Premium', '4321', 'Live02', 'EFGH'),
    ];
    const first = performanceSnapshot('Premium', { connections });
    const selected = performanceSnapshot('Premium', {
      connections,
      selectedConnectionId: secondConnectionId,
      performance: performanceReport({ realizedNet: 120 }),
    });
    const staleRefresh = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(first))
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce(jsonResponse(selected));
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    const picker = await screen.findByRole('combobox', { name: /Trading connection/i });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Performance Center' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const refreshSignal = fetchMock.mock.calls[1]?.[1]?.signal as AbortSignal;
    expect(refreshSignal.aborted).toBe(false);

    fireEvent.change(picker, { target: { value: secondConnectionId } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(refreshSignal.aborted).toBe(true);
    expect(await screen.findByText('+$120.00')).toBeTruthy();

    await act(async () => {
      staleRefresh.resolve(jsonResponse(first));
    });
    expect(screen.getByText('+$120.00')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: /Trading connection/i }) as HTMLSelectElement).value)
      .toBe(secondConnectionId);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('client Performance Center truthful states', () => {
  it('guides an unconfigured Free client through setup', async () => {
    const setup = performanceSnapshot('Free', {
      availability: 'setup_required',
      connections: [],
      selectedConnectionId: null,
      connection: { state: 'never', lastSeenAt: null, label: 'No successful synchronization received' },
      account: null,
      dataAsOf: null,
      performance: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(setup)));

    render(<ClientPerformanceCenter />);

    expect(await screen.findByRole('heading', { name: 'Complete your Orion trading setup' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open account setup' }).getAttribute('href'))
      .toBe('/portal#trading-accounts');
    expect(screen.queryByText('Performance overview')).toBeNull();
  });

  it('distinguishes first-sync waiting from a completed zero-trade period', async () => {
    const waiting = performanceSnapshot('Basic', {
      availability: 'waiting_first_sync',
      selectedConnectionId: null,
      connection: { state: 'never', lastSeenAt: null, label: 'Waiting for first synchronization' },
      account: null,
      dataAsOf: null,
      performance: null,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(waiting))
      .mockResolvedValueOnce(jsonResponse(emptyPerformanceSnapshot()));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(<ClientPerformanceCenter />);
    expect(await screen.findByRole('heading', { name: 'Orion is waiting for your first sync' })).toBeTruthy();
    expect(screen.getByText('Real ••••5678')).toBeTruthy();
    expect(screen.queryByText('No closed trades in this period')).toBeNull();

    view.unmount();
    render(<ClientPerformanceCenter />);
    expect(await screen.findByText('No closed trades in this period')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel', { name: 'Symbol, 0 categories' }))
      .getByText('No breakdown data in this period')).toBeTruthy();
    expect(screen.queryByText('Orion is waiting for your first sync')).toBeNull();
  });

  it('shows a retryable error without inventing performance results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'Secure performance service unavailable.' }, 503),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientPerformanceCenter />);

    expect(await screen.findByRole('heading', { name: 'Performance Center could not load' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Secure performance service unavailable.');
    expect(screen.getByText(/No performance result has been estimated or invented/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('Net P/L')).toBeNull();
  });
});

function performanceSnapshot(
  plan: TradingAnalyticsPlan = 'Premium',
  overrides: Partial<TradingPerformanceSnapshot> = {},
): TradingPerformanceSnapshot {
  const access = tradingPerformanceAccess(plan);
  const report = performanceReport();
  const entitledReport: TradingPerformanceReport = {
    ...report,
    metrics: access.advancedMetrics ? report.metrics : {
      averageWin: null,
      averageLoss: null,
      expectancy: null,
      bestTrade: null,
      worstTrade: null,
      maxWinStreak: null,
      maxLossStreak: null,
    },
    breakdowns: access.breakdowns
      ? report.breakdowns
      : { symbols: [], directions: [], weekdays: [], sessions: [] },
  };
  return {
    generatedAt: '2026-07-24T12:00:00.000Z',
    dataAsOf: '2026-07-24T11:59:30.000Z',
    access,
    connections: [connection(firstConnectionId, plan, '5678', 'Live01', 'ABCD')],
    selectedConnectionId: firstConnectionId,
    availability: 'ready',
    connection: {
      state: 'online',
      lastSeenAt: '2026-07-24T11:59:30.000Z',
      label: 'EA connected',
    },
    account: { currency: 'USD' },
    period: { range: '7d', label: 'Last 7 days', timeZone: 'UTC' },
    dataQuality: {
      partialClosesRolledIntoFinalClose: true,
      incompleteHistoryExcluded: false,
      volumeMismatchExcluded: false,
      nettingReversalsExcluded: false,
      mixedHistoricalCurrenciesDetected: false,
      currencyEvidenceComplete: true,
      coverageStart: '2026-07-18T00:00:00.000Z',
      equityCoverageStart: '2026-07-18T00:00:00.000Z',
      equityCoverageComplete: true,
      calendarBasis: 'FINAL_CLOSE_UTC',
      weekdayBasis: 'FINAL_CLOSE_UTC',
      sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS',
    },
    performance: entitledReport,
    ...overrides,
  };
}

function performanceReport(
  overviewOverrides: Partial<TradingPerformanceReport['overview']> = {},
): TradingPerformanceReport {
  const breakdown = {
    key: 'XAUUSD',
    label: 'XAUUSD',
    netProfit: 20,
    closedTrades: 3,
    wins: 1,
    losses: 1,
    breakeven: 1,
    winRate: 100 / 3,
    averageNet: 20 / 3,
  };
  return {
    window: {
      startAt: '2026-07-18T00:00:00.000Z',
      endAt: '2026-07-24T12:00:00.000Z',
    },
    overview: {
      realizedNet: 20,
      winRate: 100 / 3,
      profitFactor: 1.5,
      maxDrawdownMoney: 25,
      maxDrawdownPercent: 2.5,
      closedTrades: 3,
      ...overviewOverrides,
    },
    metrics: {
      averageWin: 40,
      averageLoss: -20,
      expectancy: 20 / 3,
      bestTrade: 40,
      worstTrade: -20,
      maxWinStreak: 1,
      maxLossStreak: 1,
    },
    calendar: [
      {
        date: '2026-07-21',
        netProfit: 40,
        closedTrades: 1,
        wins: 1,
        losses: 0,
        breakeven: 0,
      },
      {
        date: '2026-07-22',
        netProfit: -20,
        closedTrades: 1,
        wins: 0,
        losses: 1,
        breakeven: 0,
      },
      {
        date: '2026-07-23',
        netProfit: 0,
        closedTrades: 1,
        wins: 0,
        losses: 0,
        breakeven: 1,
      },
    ],
    breakdowns: {
      symbols: [{ ...breakdown }],
      directions: [{ ...breakdown, key: 'buy', label: 'Buy' }],
      weekdays: [{ ...breakdown, key: '2', label: 'Tuesday' }],
      sessions: [{ ...breakdown, key: 'asia', label: 'Asia entry' }],
    },
  };
}

function emptyPerformanceSnapshot(): TradingPerformanceSnapshot {
  const snapshot = performanceSnapshot('Premium');
  return {
    ...snapshot,
    dataQuality: {
      ...snapshot.dataQuality,
      coverageStart: null,
      equityCoverageStart: null,
    },
    performance: {
      ...snapshot.performance!,
      overview: {
        realizedNet: 0,
        winRate: null,
        profitFactor: null,
        maxDrawdownMoney: null,
        maxDrawdownPercent: null,
        closedTrades: 0,
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
      calendar: [],
      breakdowns: { symbols: [], directions: [], weekdays: [], sessions: [] },
    },
  };
}

function connection(
  id: string,
  plan: TradingAnalyticsPlan,
  accountSuffix: string,
  serverSuffix: string,
  installationSuffix: string,
): TradingPerformanceSnapshot['connections'][number] {
  return {
    id,
    plan,
    platform: 'MT5',
    accountType: 'Real',
    maskedAccountNumber: `••••${accountSuffix}`,
    brokerServer: `OrionBroker-${serverSuffix}`,
    installationHint: `••••-${installationSuffix}`,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
