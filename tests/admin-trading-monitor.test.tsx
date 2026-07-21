// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminTradingMonitor from '@/components/admin-trading-monitor';
import { tradingConnectionAttention, tradingConnectionState } from '@/lib/admin-trading-monitor';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('EA fleet monitor', () => {
  it('derives connection state only from authoritative server receipt time', () => {
    const now = new Date('2026-07-21T12:10:00Z');
    expect(tradingConnectionState('2026-07-21T12:08:00Z', now)).toBe('online');
    expect(tradingConnectionState('2026-07-21T12:04:00Z', now)).toBe('delayed');
    expect(tradingConnectionState('2026-07-21T11:50:00Z', now)).toBe('offline');
    expect(tradingConnectionState(null, now)).toBe('never');
    expect(tradingConnectionAttention('offline', 2)).toBe('offline-open-positions');
  });

  it('shows fleet counts, masked identity and operational attention', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      generatedAt: '2026-07-21T12:10:00Z',
      counts: { total: 1, online: 0, delayed: 0, offline: 1, never: 0, offlineWithOpenPositions: 1, rejected24h: 3 },
      items: [{
        connectionId: 'scope-1', clientId: 'client-1', clientName: 'Client One', plan: 'Premium',
        maskedLicenseKey: 'ORN-••••-••••-••••-PQRT', maskedAccountNumber: '••••4321', brokerServer: 'Broker-Live',
        platform: 'MT5', accountType: 'Real', installationHint: '••••-WXYZ', state: 'offline',
        lastSeenAt: '2026-07-21T11:50:00Z', lastCapturedAt: '2026-07-21T11:50:00Z', eaVersion: '5.2.0',
        terminalBuild: 5320, openPositions: 2, attention: 'offline-open-positions',
      }],
    }), { status: 200 })));

    render(<AdminTradingMonitor />);
    expect(await screen.findByText('Client One')).toBeTruthy();
    expect(screen.getByText('Offline with positions')).toBeTruthy();
    expect(screen.getByText('••••4321')).toBeTruthy();
    expect(document.body.textContent).not.toContain('ORN-REAL-LICENSE-KEY');
  });

  it('filters without another network request and supports retry after an error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Fleet unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        generatedAt: '2026-07-21T12:10:00Z',
        counts: { total: 0, online: 0, delayed: 0, offline: 0, never: 0, offlineWithOpenPositions: 0, rejected24h: 0 },
        items: [],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminTradingMonitor />);
    expect(await screen.findByText('Fleet unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No EA connections match these filters.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
