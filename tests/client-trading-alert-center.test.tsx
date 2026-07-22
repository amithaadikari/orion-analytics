// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClientTradingAlertCenter from '@/components/client-trading-alert-center';
import type { TradingAlertSnapshot } from '@/lib/trading-alerts';

const connectionId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Client Trading Alert Center', () => {
  it('shows a truthful loading shell without inventing preference values', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => undefined)));
    renderCenter();
    expect(screen.getByText('Loading alert settings…')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows Basic connection and final-close alerts with one clear Premium lock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot('Basic'))));
    renderCenter();

    expect(await screen.findByRole('heading', { name: 'Risk & Alerts' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Connection health/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Final trade close/i })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Trade opened/i })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Unlock advanced trading alerts' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review Premium alerts/i }).getAttribute('href')).toBe('/checkout?plan=premium');
  });

  it('saves only included controls for Basic and keeps authority server-side', async () => {
    const initial = snapshot('Basic');
    const changed = { ...initial, preferences: { ...initial.preferences, connectionHealth: false }, monitoring: { ...initial.monitoring, activeRules: 1 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(changed));
    vi.stubGlobal('fetch', fetchMock);
    renderCenter();

    fireEvent.click(await screen.findByRole('checkbox', { name: /Connection health/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save alert settings' }));
    expect(await screen.findByText('Alert settings saved.')).toBeTruthy();
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe('/api/trading-alerts');
    expect(JSON.parse(request[1].body)).toEqual({
      connectionId,
      preferences: { connectionHealth: false, finalClose: true },
    });
  });

  it('unlocks Premium event and threshold controls and validates enabled rules', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot('Premium'))));
    renderCenter({ plan: 'Premium' });

    expect(await screen.findByRole('checkbox', { name: /Trade opened/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Partial close/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Daily realized-loss limit/i }));
    expect(screen.getByText('Enter a daily realized-loss limit greater than zero.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save alert settings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Daily realized-loss limit threshold/i }), { target: { value: '125.50' } });
    expect(screen.queryByText('Enter a daily realized-loss limit greater than zero.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save alert settings' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the client draft when saving fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot('Premium')))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unable to save your trading alert settings.' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    renderCenter({ plan: 'Premium' });

    const tradeOpened = await screen.findByRole('checkbox', { name: /Trade opened/i });
    fireEvent.click(tradeOpened);
    fireEvent.click(screen.getByRole('button', { name: 'Save alert settings' }));
    expect(await screen.findByText('Unable to save your trading alert settings.')).toBeTruthy();
    expect((tradeOpened as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Save alert settings' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('isolates a migration/load error and offers a retry without hiding the dashboard', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Trading alerts are waiting for the latest database migration.' }, 503))
      .mockResolvedValueOnce(jsonResponse(snapshot('Basic')));
    vi.stubGlobal('fetch', fetchMock);
    renderCenter();

    expect(await screen.findByText('Risk & Alerts could not load')).toBeTruthy();
    expect(screen.getByText(/Your trading dashboard remains available/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: /Connection health/i })).toBeTruthy();
  });

  it('clears the previous connection settings while a newly selected connection loads', async () => {
    const pending = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot('Basic')))
      .mockReturnValueOnce(pending);
    vi.stubGlobal('fetch', fetchMock);
    const view = renderCenter();

    expect(await screen.findByRole('checkbox', { name: /Connection health/i })).toBeTruthy();
    view.rerender(<ClientTradingAlertCenter
      connectionId="22222222-2222-4222-8222-222222222222"
      plan="Basic"
      currency="EUR"
      connectionLabel="MT5 Demo ••••9911"
    />);

    expect(screen.getByText('Loading alert settings…')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

function renderCenter(options: { plan?: 'Basic' | 'Premium' | 'Lifetime' } = {}) {
  return render(<ClientTradingAlertCenter
    connectionId={connectionId}
    plan={options.plan || 'Basic'}
    currency="USD"
    connectionLabel="MT5 Real ••••5678"
  />);
}

function snapshot(plan: 'Basic' | 'Premium' | 'Lifetime'): TradingAlertSnapshot {
  const advanced = plan !== 'Basic';
  return {
    generatedAt: '2026-07-21T15:00:00Z',
    connection: {
      id: connectionId,
      plan,
      platform: 'MT5',
      accountType: 'Real',
      maskedAccountNumber: '••••5678',
      brokerServer: 'Broker-Live',
      currency: 'USD',
    },
    access: { plan, connectionHealth: true, finalClose: true, advancedEvents: advanced, riskGuardrails: advanced },
    preferences: {
      connectionHealth: true,
      finalClose: true,
      tradeOpened: advanced,
      partialClose: advanced,
      dailyLossEnabled: false,
      dailyLossLimit: null,
      drawdownEnabled: false,
      drawdownPercent: null,
      equityFloorEnabled: false,
      equityFloor: null,
    },
    monitoring: { activeRules: advanced ? 4 : 2, activeBreaches: 0, lastEvaluatedAt: null, lastAlertAt: null },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
