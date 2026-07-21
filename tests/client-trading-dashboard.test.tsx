// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('No closed trades in this period')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('range=30d'))).toBe(true));
  });
});
