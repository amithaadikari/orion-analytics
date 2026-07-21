// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminTradingMonitor from '@/components/admin-trading-monitor';
import {
  buildEaVersionAdoption,
  tradingConnectionAttention,
  tradingConnectionState,
  type AdminTradingMonitorItem,
} from '@/lib/admin-trading-monitor';

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

  it('calculates V5.2 adoption against the complete eligible fleet', () => {
    const adoption = buildEaVersionAdoption([
      { eaVersion: '5.2.0' },
      { eaVersion: 'v5.1.0' },
      { eaVersion: null },
    ] as AdminTradingMonitorItem[]);
    expect(adoption).toMatchObject({
      currentVersion: '5.2.0',
      totalConnections: 3,
      reportingConnections: 2,
      currentConnections: 1,
      unknownConnections: 1,
      adoptionPercent: 33.3,
    });
    expect(adoption.breakdown.map((row) => row.version)).toEqual(['5.2.0', '5.1.0']);
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

  it('shows release adoption, sanitized incidents and scheduled-run evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      generatedAt: '2026-07-21T12:10:00Z',
      counts: { total: 2, online: 1, delayed: 0, offline: 1, never: 0, offlineWithOpenPositions: 1, rejected24h: 25 },
      items: [],
      reliability: {
        available: true,
        canAcknowledge: true,
        versions: {
          currentVersion: '5.2.0', totalConnections: 2, reportingConnections: 2,
          currentConnections: 1, unknownConnections: 0, adoptionPercent: 50,
          breakdown: [
            { version: '5.2.0', connections: 1, percentage: 50, current: true },
            { version: '5.1.0', connections: 1, percentage: 50, current: false },
          ],
        },
        incidents: [{
          id: '6f8630ce-e467-4e30-9403-71c0de77ae5b', incidentType: 'offline_with_open_positions',
          severity: 'critical', status: 'Open', summary: 'EA offline with last-reported open positions',
          clientId: 'client-1', clientName: 'Client One', maskedAccountNumber: '••••4321',
          maskedLicenseKey: 'ORN-••••-PQRT', firstDetectedAt: '2026-07-21T12:00:00Z',
          lastDetectedAt: '2026-07-21T12:10:00Z', resolvedAt: null, acknowledgedAt: null,
          acknowledgedByEmail: null,
        }],
        runs: [{
          id: '3a0232fc-039b-4c3e-964e-dcdf40c0e592', jobName: 'reliability-evaluator',
          status: 'Succeeded', evaluatorVersion: '1.0.0', startedAt: '2026-07-21T12:10:00Z', completedAt: '2026-07-21T12:10:01Z',
          streamsEvaluated: 2, offlineWithOpenPositions: 1, offlineStreams: 0, rejectionWindowCount: 25,
          rejectionSpikes: 1, incidentsDetected: 2, incidentsOpened: 2, incidentsRefreshed: 0, incidentsResolved: 0, errorCode: null,
        }],
      },
    }), { status: 200 })));
    render(<AdminTradingMonitor />);
    expect(await screen.findByText('50%')).toBeTruthy();
    expect(screen.getByText('EA offline with last-reported open positions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
    expect(screen.getByText('Succeeded')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /resolve|delete/i })).toBeNull();
  });

  it('acknowledges an incident with the exact action and refreshes authoritative state', async () => {
    const snapshot = (acknowledgedAt: string | null) => ({
      generatedAt: '2026-07-21T12:10:00Z',
      counts: { total: 0, online: 0, delayed: 0, offline: 0, never: 0, offlineWithOpenPositions: 0, rejected24h: 0 },
      items: [],
      reliability: {
        available: true, unavailableReason: null, canAcknowledge: true,
        openIncidentCount: 1, openIncidentOverflow: false,
        versions: {
          currentVersion: '5.2.0', totalConnections: 0, reportingConnections: 0,
          currentConnections: 0, unknownConnections: 0, adoptionPercent: null, breakdown: [],
        },
        incidents: [{
          id: '6f8630ce-e467-4e30-9403-71c0de77ae5b', incidentType: 'offline_stream',
          severity: 'warning', status: 'Open', summary: 'Connection offline',
          clientId: 'client-1', clientName: 'Client One', maskedAccountNumber: '••••4321',
          maskedLicenseKey: 'ORN-••••-PQRT', firstDetectedAt: '2026-07-21T12:00:00Z',
          lastDetectedAt: '2026-07-21T12:10:00Z', resolvedAt: null, acknowledgedAt,
        }],
        runs: [],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot(null)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('2026-07-21T12:11:00Z')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminTradingMonitor />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByLabelText('Incident status: Acknowledged')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/trading-monitor');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        incidentId: '6f8630ce-e467-4e30-9403-71c0de77ae5b',
        action: 'acknowledge',
      }),
    });
  });

  it('distinguishes a temporary reliability outage from pending migration activation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      generatedAt: '2026-07-21T12:10:00Z',
      counts: { total: 0, online: 0, delayed: 0, offline: 0, never: 0, offlineWithOpenPositions: 0, rejected24h: 0 },
      items: [],
      reliability: {
        available: false,
        unavailableReason: 'temporarily_unavailable',
        canAcknowledge: false,
        versions: {
          currentVersion: '5.2.0', totalConnections: 0, reportingConnections: 0,
          currentConnections: 0, unknownConnections: 0, adoptionPercent: null, breakdown: [],
        },
        incidents: [], openIncidentCount: 0, openIncidentOverflow: false, runs: [],
      },
    }), { status: 200 })));

    render(<AdminTradingMonitor />);
    expect(await screen.findByText('Reliability data temporarily unavailable')).toBeTruthy();
    expect(screen.getByText('Scheduler evidence temporarily unavailable')).toBeTruthy();
    expect(screen.queryByText('Reliability activation pending')).toBeNull();
  });

  it('shows accurate incident states to a read-only analyst without action controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      generatedAt: '2026-07-21T12:10:00Z',
      counts: { total: 0, online: 0, delayed: 0, offline: 0, never: 0, offlineWithOpenPositions: 0, rejected24h: 0 },
      items: [],
      reliability: {
        available: true,
        canAcknowledge: false,
        openIncidentCount: 14,
        openIncidentOverflow: true,
        versions: {
          currentVersion: '5.2.0', totalConnections: 0, reportingConnections: 0,
          currentConnections: 0, unknownConnections: 0, adoptionPercent: null, breakdown: [],
        },
        incidents: [
          {
            id: '6f8630ce-e467-4e30-9403-71c0de77ae5b', incidentType: 'offline_stream',
            severity: 'warning', status: 'Open', summary: 'Unacknowledged open incident',
            clientId: 'client-1', clientName: 'Client One', maskedAccountNumber: '••••4321',
            maskedLicenseKey: 'ORN-••••-PQRT', firstDetectedAt: '2026-07-21T12:00:00Z',
            lastDetectedAt: '2026-07-21T12:10:00Z', resolvedAt: null, acknowledgedAt: null,
            acknowledgedByEmail: null,
          },
          {
            id: '42a9cbe3-428d-4d34-bd04-291ad680c966', incidentType: 'rejection_spike',
            severity: 'high', status: 'Resolved', summary: 'Resolved incident with prior acknowledgement',
            clientId: null, clientName: null, maskedAccountNumber: null, maskedLicenseKey: null,
            firstDetectedAt: '2026-07-21T11:00:00Z', lastDetectedAt: '2026-07-21T11:10:00Z',
            resolvedAt: '2026-07-21T11:20:00Z', acknowledgedAt: '2026-07-21T11:05:00Z',
            acknowledgedByEmail: 'admin@example.com',
          },
        ],
        runs: [{
          id: 'ceec0095-cfde-4dd4-814e-86f8724bebbf', jobName: 'reliability-evaluator',
          status: 'Succeeded', skipped: true, skipReason: 'concurrent_evaluation', evaluatorVersion: '1.0.0',
          startedAt: '2026-07-21T12:10:00Z', completedAt: '2026-07-21T12:10:00Z', streamsEvaluated: 0,
          offlineWithOpenPositions: 0, offlineStreams: 0, rejectionWindowCount: 0, rejectionSpikes: 0,
          incidentsDetected: 0, incidentsOpened: 0, incidentsRefreshed: 0, incidentsResolved: 0, errorCode: null,
        }],
      },
    }), { status: 200 })));

    render(<AdminTradingMonitor />);
    expect(await screen.findByText('Unacknowledged open incident')).toBeTruthy();
    expect(screen.getByLabelText('Incident status: Open')).toBeTruthy();
    expect(screen.getByLabelText('Incident status: Resolved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByText('Acknowledged')).toBeNull();
    expect(screen.getByText('Incident list is limited. 14 open incidents require review.')).toBeTruthy();
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.queryByText('Succeeded')).toBeNull();
  });
});
