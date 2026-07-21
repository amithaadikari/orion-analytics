// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseRuntimeSnapshot } from '@/lib/license-runtime';
import LicenseRuntimeCenter from '@/components/license-runtime-center';

const licenseId = '22222222-2222-4222-8222-222222222222';
const installationId = 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ';

describe('license pairing center', () => {
  beforeEach(() => { vi.stubGlobal('crypto', { randomUUID: () => '33333333-3333-4333-8333-333333333333' }); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('shows the server-owned feature plan and both required bindings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    render(<LicenseRuntimeCenter />);
    expect(await screen.findByText('Basic')).toBeTruthy();
    expect(screen.getByText(/server enables only Basic features/i)).toBeTruthy();
    expect(screen.getByText(/Unregistered Demo accounts are rejected/i)).toBeTruthy();
    expect(screen.getByText('Active installation')).toBeTruthy();
    expect(screen.getByText('Advanced Recovery')).toBeTruthy();
  });

  it('uses fast refresh only while an approval is waiting', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    render(<LicenseRuntimeCenter />);
    await screen.findByText('Basic');
    expect(interval).toHaveBeenLastCalledWith(expect.any(Function), 60_000);

    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ pending: true }))));
    render(<LicenseRuntimeCenter />);
    await screen.findByLabelText('Approval code 482731');
    expect(interval).toHaveBeenLastCalledWith(expect.any(Function), 15_000);
    interval.mockRestore();
  });

  it('registers a per-license Demo identity without submitting plan or platform authority', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(snapshot())).mockResolvedValueOnce(jsonResponse(snapshot({ demo: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);
    await screen.findByText(/Unregistered Demo accounts are rejected/i);
    fireEvent.change(screen.getByLabelText('Demo account number'), { target: { value: '87654321' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Demo' } });
    fireEvent.change(screen.getByLabelText(/Type REGISTER DEMO/i), { target: { value: 'REGISTER DEMO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register Demo binding' }));
    expect(await screen.findByText(/Demo account registered for this license/i)).toBeTruthy();
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ action: 'setDemoAccount', licenseId, accountNumber: '87654321', brokerServer: 'Broker-Demo' });
    expect(body).not.toHaveProperty('plan');
    expect(body).not.toHaveProperty('platform');
    expect(body).not.toHaveProperty('clientId');
  });

  it('pairs the EA-generated installation and explains that replacement revokes the old device', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(snapshot())).mockResolvedValueOnce(jsonResponse(snapshot({ installation: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);
    await screen.findByText(/EA will request approval automatically/i);
    fireEvent.click(screen.getByText('Advanced Recovery'));
    fireEvent.change(screen.getByLabelText('Installation ID from EA'), { target: { value: installationId } });
    fireEvent.change(screen.getByLabelText('Device label'), { target: { value: 'Home laptop MT5' } });
    fireEvent.change(screen.getByLabelText(/Type ACTIVATE DEVICE/i), { target: { value: 'ACTIVATE DEVICE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate installation' }));
    expect(await screen.findByText(/EA can now validate from this installation/i)).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ action: 'setInstallation', licenseId, installationId, deviceLabel: 'Home laptop MT5' });
  });

  it('shows the EA match code and approves a pending installation with one portal action', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(snapshot({ pending: true }))).mockResolvedValueOnce(jsonResponse(snapshot({ installation: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);
    expect((await screen.findByLabelText('Approval code 482731')).textContent).toBe('482 731');
    expect(screen.getByText(/Demo · ••••4321/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve device' }));
    expect(await screen.findByText(/EA is completing its secure license check/i)).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      action: 'resolveInstallationRequest', pairingRequestId: 'pending-1', decision: 'Approve',
    });
  });

  it('warns before replacing an active installation from a pending request', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(snapshot({ installation: true, pending: true }))).mockResolvedValueOnce(jsonResponse(snapshot({ installation: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and replace device' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/deactivated immediately/i));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ decision: 'Approve', pairingRequestId: 'pending-1' });
  });

  it('disables replacement when the rolling security limit is active', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ installation: true, installationLocked: true }))));
    render(<LicenseRuntimeCenter />);
    expect(await screen.findByText(/Installation replacement unlocks/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Replace active installation' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a server rejection visible while preserving the current pairing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(snapshot({ demo: true }))).mockResolvedValueOnce(jsonResponse({ error: 'Standard membership can replace a Demo account once every 7 days.' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);
    await screen.findByText('••••4321');
    fireEvent.change(screen.getByLabelText('Demo account number'), { target: { value: '99994321' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Demo-2' } });
    fireEvent.change(screen.getByLabelText(/Type CHANGE DEMO/i), { target: { value: 'CHANGE DEMO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Demo binding' }));
    expect(await screen.findByText(/once every 7 days/i)).toBeTruthy();
    expect(screen.getByText('••••4321')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function snapshot(options: { demo?: boolean; installation?: boolean; installationLocked?: boolean; pending?: boolean } = {}): LicenseRuntimeSnapshot {
  return {
    serverTime: '2026-08-01T00:00:00Z', clientStatus: 'Active',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    licenses: [{
      id: licenseId, maskedLicenseKey: 'ORN-••••-••••-••••-PQRT', plan: 'Basic', platform: 'MT5', status: 'Active', expiresAt: null, bindingVersion: 1, eligible: true,
      demoAccount: options.demo ? { id: 'demo-1', maskedAccountNumber: '••••4321', brokerServer: 'Broker-Demo', platform: 'MT5', registeredAt: '2026-08-01T00:00:00Z' } : null,
      installation: options.installation ? { id: 'install-1', hint: '••••-WXYZ', label: 'Home laptop MT5', activatedAt: '2026-08-01T00:00:00Z', lastSeenAt: null } : null,
      pendingInstallationRequest: options.pending ? {
        id: 'pending-1', hint: '••••-ABCD', label: 'Home MT5 terminal', maskedAccountNumber: '••••4321',
        brokerServer: 'Broker-Demo', accountType: 'Demo', platform: 'MT5', matchCode: '482731',
        requestedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-08-01T00:10:00Z',
      } : null,
      canChangeDemo: true, nextDemoChangeAt: null, demoCooldownReason: null,
      canReplaceInstallation: !options.installationLocked,
      nextInstallationChangeAt: options.installationLocked ? '2026-08-02T00:00:00Z' : null,
      installationCooldownReason: options.installationLocked ? 'security-limit' : null,
    }],
  };
}
function jsonResponse(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }); }
