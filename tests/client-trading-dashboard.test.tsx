// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClientTradingDashboard from '@/components/client-trading-dashboard';
import type { TradingAnalyticsSnapshot } from '@/lib/trading-analytics';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseSnapshot: TradingAnalyticsSnapshot = {
  generatedAt: '2026-07-21T14:05:00Z',
  dataAsOf: '2026-07-21T14:04:30Z',
  access: {
    plan: 'Basic',
    allowedRanges: ['7d'],
    maxRange: '7d',
    advancedMetrics: false,
    historyPagination: false,
    historyPageSize: 20,
    allHistory: false,
  },
  connections: [{
    id: '11111111-1111-4111-8111-111111111111',
    plan: 'Basic',
    platform: 'MT5',
    accountType: 'Real',
    maskedAccountNumber: '••••5678',
    brokerServer: 'OrionBroker-Live01',
    installationHint: '••••-ABCD',
  }],
  selectedConnectionId: '11111111-1111-4111-8111-111111111111',
  availability: 'ready',
  connection: { state: 'online', lastSeenAt: '2026-07-21T14:04:30Z', label: 'Last update received' },
  account: { currency: 'USD', balance: 1050, equity: 1062, margin: 50, marginLevel: 2124, floatingNet: 12 },
  period: { range: '7d', label: 'Last 7 days', timeZone: 'UTC' },
  metrics: { realizedNet: 38, winRate: 60, profitFactor: null, maxDrawdownMoney: null, maxDrawdownPercent: null, closedTrades: 5 },
  dataQuality: { nettingReversalsExcluded: false },
  summaries: null,
  equity: [],
  openPositions: [],
  activity: { items: [], hasMore: false, incompleteHistoryExcluded: false },
  history: { items: [], nextCursor: null },
};

function respond(snapshot: TradingAnalyticsSnapshot) {
  return vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
}

describe('client trading dashboard states', () => {
  it('shows a truthful loading state without temporary zero account values', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => undefined)));
    render(<ClientTradingDashboard />);

    expect(screen.getByText('Loading your latest trading activity…')).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('guides an unconnected client to account and device setup', async () => {
    vi.stubGlobal('fetch', respond({
      ...baseSnapshot,
      availability: 'setup_required',
      connection: { state: 'never', lastSeenAt: null, label: 'No EA connection' },
      account: null,
      connections: [],
      selectedConnectionId: null,
      dataAsOf: null,
    }));
    render(<ClientTradingDashboard />);

    expect(await screen.findByText('Complete your Orion trading setup')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open account setup/i }).getAttribute('href')).toBe('/portal#trading-accounts');
    expect(screen.getByRole('link', { name: /Check device pairing/i }).getAttribute('href')).toBe('/portal#license-pairing');
  });

  it('distinguishes first-sync waiting from a no-trade result', async () => {
    vi.stubGlobal('fetch', respond({
      ...baseSnapshot,
      availability: 'waiting_first_sync',
      connection: { state: 'never', lastSeenAt: null, label: 'Waiting for EA' },
      account: null,
      dataAsOf: null,
    }));
    render(<ClientTradingDashboard />);

    expect(await screen.findByText('Orion is waiting for your EA')).toBeTruthy();
    expect(screen.getByText('Real ••••5678')).toBeTruthy();
    expect(screen.queryByText('No closed trades in this period')).toBeNull();
  });

  it('keeps last-known values visible while clearly warning that an offline feed is stale', async () => {
    vi.stubGlobal('fetch', respond({
      ...baseSnapshot,
      connection: { state: 'offline', lastSeenAt: '2026-07-21T13:00:00Z', label: 'No recent EA update' },
    }));
    render(<ClientTradingDashboard />);

    expect(await screen.findAllByText('EA offline')).not.toHaveLength(0);
    expect(screen.getByText(/may have changed in MetaTrader/i)).toBeTruthy();
    expect(screen.getByText('No open positions reported')).toBeTruthy();
    const executionsTab = screen.getByRole('tab', { name: /^Executions,/i });
    const closedTab = screen.getByRole('tab', { name: /^Closed trades,/i });
    expect(executionsTab.getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel', { name: /^Executions,/i })).getByText('No exit executions in this period')).toBeTruthy();
    fireEvent.click(closedTab);
    expect(closedTab.getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel', { name: /^Closed trades,/i })).getByText('No closed trades in this period')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Review Premium' })).toHaveLength(2);
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('warns when MT5 netting reversals were safely excluded from performance', async () => {
    vi.stubGlobal('fetch', respond({
      ...baseSnapshot,
      dataQuality: { nettingReversalsExcluded: true },
    }));
    render(<ClientTradingDashboard />);

    expect(await screen.findByText('Netting reversals excluded')).toBeTruthy();
    expect(screen.getByText(/Live account values and open positions remain available/i)).toBeTruthy();
  });

  it('shows a partial exit immediately and keeps it separate from completed-trade metrics', async () => {
    vi.stubGlobal('fetch', respond({
      ...baseSnapshot,
      openPositions: [{
        id: '7001', ticket: '7001', symbol: 'XAUUSD', side: 'Buy', volume: 0.04,
        openedAt: '2026-07-21T13:00:00Z', entryPrice: 2400, currentPrice: 2403,
        stopLoss: 2390, takeProfit: 2420, floatingNet: 12,
      }],
      activity: {
        hasMore: true,
        incompleteHistoryExcluded: true,
        items: [
          {
            id: '9002', positionId: '7001', ticket: '8002', symbol: 'XAUUSD', side: 'Buy',
            volume: 0.04, executedAt: '2026-07-21T14:03:00Z', exitPrice: 2403,
            profit: 3.2, swap: 0, commission: -0.2, netProfit: 3,
            remainingVolume: 0, status: 'Closed',
          },
          {
            id: '9001', positionId: '7001', ticket: '8001', symbol: 'XAUUSD', side: 'Buy',
            volume: 0.06, executedAt: '2026-07-21T14:02:00Z', exitPrice: 2402.5,
            profit: 4.5, swap: 0, commission: -0.35, netProfit: 4.15,
            remainingVolume: 0.04, status: 'Partial',
          },
        ],
      },
    }));

    render(<ClientTradingDashboard />);
    const execution = await screen.findByRole('article', { name: 'Partial close XAUUSD execution' });
    expect(within(execution).getByText('Partial close')).toBeTruthy();
    expect(within(execution).getByText('0.06')).toBeTruthy();
    expect(within(execution).getByText('2,402.50')).toBeTruthy();
    expect(within(execution).getByText('After execution')).toBeTruthy();
    expect(within(execution).getByText('0.04 remained')).toBeTruthy();
    expect(within(execution).queryByText('0.04 open')).toBeNull();
    const partialResults = within(execution).getAllByText('+$4.15');
    expect(partialResults).toHaveLength(2);
    expect(partialResults.filter((result) => result.getAttribute('aria-hidden') === 'true')).toHaveLength(1);
    expect(within(execution).getByText('Exit result').nextElementSibling?.getAttribute('aria-hidden')).toBeNull();
    expect(execution.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-21T14:02:00Z');
    expect(within(execution).getByText('Exit result')).toBeTruthy();
    const finalExecution = screen.getByRole('article', { name: 'Final close XAUUSD execution' });
    expect(within(finalExecution).getByText('After execution')).toBeTruthy();
    expect(within(finalExecution).getByText('Position closed by this execution')).toBeTruthy();
    expect(screen.getByText('Some older exits are hidden')).toBeTruthy();
    expect(screen.getByText(/opening deal is unavailable.*excludes them instead of inventing position details/i)).toBeTruthy();
    expect(screen.getByText(/Each row is one exit reported by the EA.*charges reported on that exit.*completed-trade metrics remain based on fully closed positions/i)).toBeTruthy();
    expect(screen.getByText('Showing the most recent executions for this period.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Trade history' })).toBeTruthy();
    const executionsTab = screen.getByRole('tab', { name: /^Executions,/i });
    const closedTab = screen.getByRole('tab', { name: /^Closed trades,/i });
    expect(executionsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Closed trades' })).toBeNull();
    fireEvent.click(closedTab);
    expect(screen.getByRole('heading', { name: 'Closed trades' })).toBeTruthy();
    expect(screen.getByText('No closed trades in this period')).toBeTruthy();
    fireEvent.click(executionsTab);
    expect(screen.getByRole('article', { name: 'Partial close XAUUSD execution' })).toBeTruthy();
  });

  it('combines both records into keyboard-accessible tabs without another API request', async () => {
    const fetchMock = respond({
      ...baseSnapshot,
      metrics: { ...baseSnapshot.metrics, closedTrades: 1 },
      activity: {
        hasMore: false,
        incompleteHistoryExcluded: false,
        items: [{
          id: '9101', positionId: '7101', ticket: '8101', symbol: 'XAUUSD', side: 'Buy',
          volume: 0.02, executedAt: '2026-07-21T14:01:00Z', exitPrice: 2401.5,
          profit: 2.4, swap: 0, commission: -0.1, netProfit: 2.3,
          remainingVolume: 0.03, status: 'Partial',
        }],
      },
      history: {
        nextCursor: null,
        items: [{
          id: '7201', ticket: '7201', symbol: 'XAUUSD', side: 'Sell', volume: 0.05,
          openedAt: '2026-07-21T12:00:00Z', closedAt: '2026-07-21T13:00:00Z',
          entryPrice: 2405, exitPrice: 2400, profit: 25, swap: -0.5,
          commission: -1, netProfit: 23.5,
        }],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClientTradingDashboard />);

    const tablist = await screen.findByRole('tablist', { name: 'Trade history view' });
    const executionsTab = within(tablist).getByRole('tab', { name: /^Executions,/i });
    const closedTab = within(tablist).getByRole('tab', { name: /^Closed trades,/i });
    expect(executionsTab.getAttribute('aria-selected')).toBe('true');
    expect(executionsTab.getAttribute('tabindex')).toBe('0');
    expect(closedTab.getAttribute('aria-selected')).toBe('false');
    expect(closedTab.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tabpanel', { name: /^Executions,/i }).id).toBe(executionsTab.getAttribute('aria-controls'));
    expect(screen.getByRole('article', { name: 'Partial close XAUUSD execution' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Closed Orion trading history' })).toBeNull();
    const requestCount = fetchMock.mock.calls.length;

    fireEvent.keyDown(executionsTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(closedTab);
    expect(closedTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /^Closed trades,/i }).id).toBe(closedTab.getAttribute('aria-controls'));
    expect(screen.getByRole('table', { name: 'Closed Orion trading history' })).toBeTruthy();
    expect(screen.getByRole('row', { name: /XAUUSD #7201 Sell 0.05/i })).toBeTruthy();
    expect(fetchMock.mock.calls).toHaveLength(requestCount);

    fireEvent.keyDown(closedTab, { key: 'Home' });
    expect(document.activeElement).toBe(executionsTab);
    expect(executionsTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(executionsTab, { key: 'End' });
    expect(document.activeElement).toBe(closedTab);
    fireEvent.keyDown(closedTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(executionsTab);
  });

  it('paginates only closed trades and keeps execution activity unchanged', async () => {
    const executionItem = {
      id: '9201', positionId: '7401', ticket: '8401', symbol: 'XAUUSD', side: 'Buy' as const,
      volume: 0.02, executedAt: '2026-07-21T14:01:00Z', exitPrice: 2401.5,
      profit: 2.4, swap: 0, commission: -0.1, netProfit: 2.3,
      remainingVolume: 0.03, status: 'Partial' as const,
    };
    const newestTrade = {
      id: '7301', ticket: '7301', symbol: 'XAUUSD', side: 'Sell' as const, volume: 0.05,
      openedAt: '2026-07-21T12:00:00Z', closedAt: '2026-07-21T13:00:00Z',
      entryPrice: 2405, exitPrice: 2400, profit: 25, swap: -0.5,
      commission: -1, netProfit: 23.5,
    };
    const olderTrade = {
      id: '7300', ticket: '7300', symbol: 'XAUUSD', side: 'Buy' as const, volume: 0.03,
      openedAt: '2026-07-20T09:00:00Z', closedAt: '2026-07-20T10:00:00Z',
      entryPrice: 2388, exitPrice: 2392, profit: 12, swap: 0,
      commission: -0.6, netProfit: 11.4,
    };
    const firstPage: TradingAnalyticsSnapshot = {
      ...baseSnapshot,
      access: {
        plan: 'Premium',
        allowedRanges: ['7d', '30d', '90d'],
        maxRange: '90d',
        advancedMetrics: true,
        historyPagination: true,
        historyPageSize: 50,
        allHistory: false,
      },
      connections: [{ ...baseSnapshot.connections[0], plan: 'Premium' }],
      activity: { items: [executionItem], hasMore: false, incompleteHistoryExcluded: false },
      history: { items: [newestTrade], nextCursor: 'older-page' },
    };
    const secondPage: TradingAnalyticsSnapshot = {
      ...firstPage,
      history: { items: [newestTrade, olderTrade], nextCursor: null },
    };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const snapshot = String(input).includes('cursor=older-page') ? secondPage : firstPage;
      return Promise.resolve(new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClientTradingDashboard />);

    const closedTab = await screen.findByRole('tab', { name: /^Closed trades,/i });
    fireEvent.click(closedTab);
    fireEvent.click(screen.getByRole('button', { name: /Load older trades/i }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('cursor=older-page'))).toBe(true));
    const table = screen.getByRole('table', { name: 'Closed Orion trading history' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    expect(within(table).getAllByText('#7301')).toHaveLength(1);
    expect(within(table).getByText('#7300')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load older trades/i })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /^Executions,/i }));
    const executionPanel = screen.getByRole('tabpanel', { name: /^Executions,/i });
    expect(within(executionPanel).getAllByRole('article')).toHaveLength(1);
    expect(within(executionPanel).getByRole('article', { name: 'Partial close XAUUSD execution' })).toBeTruthy();
    expect(within(executionPanel).queryByText('#7300')).toBeNull();
  });

  it('labels a final exit as position closed without implying history pagination', async () => {
    vi.stubGlobal('fetch', respond({
      ...baseSnapshot,
      activity: {
        hasMore: false,
        incompleteHistoryExcluded: false,
        items: [{
          id: '9002', positionId: '7002', ticket: null, symbol: 'XAUUSD', side: 'Sell',
          volume: 0.08, executedAt: '2026-07-21T14:03:00Z', exitPrice: 2398.25,
          profit: 7, swap: -0.1, commission: -0.4, netProfit: 6.5,
          remainingVolume: 0, status: 'Closed',
        }],
      },
    }));

    render(<ClientTradingDashboard />);
    const execution = await screen.findByRole('article', { name: 'Final close XAUUSD execution' });
    expect(within(execution).getByText('Final close')).toBeTruthy();
    expect(within(execution).getByText('0.08')).toBeTruthy();
    expect(within(execution).getByText('After execution')).toBeTruthy();
    expect(within(execution).getByText('Position closed by this execution')).toBeTruthy();
    expect(within(execution).getByText('Execution #9002 · Position #7002')).toBeTruthy();
    expect(screen.queryByText('Showing the most recent executions for this period.')).toBeNull();
    expect(screen.queryByRole('button', { name: /older executions/i })).toBeNull();
  });

  it('shows a retryable error without inventing account or trade state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: 'Secure connection unavailable.' }), { status: 503 }))));
    render(<ClientTradingDashboard />);

    expect(await screen.findByText('Trading dashboard could not load')).toBeTruthy();
    expect(screen.getByText(/No account value or trade status has been guessed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('uses server-provided Premium ranges and exposes advanced metrics', async () => {
    const fetchMock = respond({
      ...baseSnapshot,
      access: {
        plan: 'Premium',
        allowedRanges: ['7d', '30d', '90d'],
        maxRange: '90d',
        advancedMetrics: true,
        historyPagination: true,
        historyPageSize: 50,
        allHistory: false,
      },
      connections: [{ ...baseSnapshot.connections[0], plan: 'Premium' }],
      metrics: { ...baseSnapshot.metrics, profitFactor: 1.82, maxDrawdownMoney: 42, maxDrawdownPercent: 3.7 },
      history: { items: [], nextCursor: 'next-page' },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClientTradingDashboard />);

    expect(await screen.findByText('1.82')).toBeTruthy();
    expect(screen.getByText('$42.00 · 3.7%')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Review Premium' })).toBeNull();
    expect(screen.getByRole('button', { name: '30D' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1Y' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Load older trades/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Closed trades,/i }));
    expect(screen.getByRole('button', { name: /Load older trades/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('range=30d'))).toBe(true));
    expect(screen.getByRole('tab', { name: /^Closed trades,/i }).getAttribute('aria-selected')).toBe('true');
  });
});
