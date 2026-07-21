// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseRuntimeSnapshot } from '@/lib/license-runtime';
import LicenseRuntimeCenter from '@/components/license-runtime-center';

const licenseId = '22222222-2222-4222-8222-222222222222';
const secondLicenseId = '44444444-4444-4444-8444-444444444444';
const installationId = 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ';

describe('license identity and device center', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.stubGlobal('crypto', { randomUUID: () => '33333333-3333-4333-8333-333333333333' });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows server-owned plan context, clear account and device cards, and no typed phrase field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    render(<LicenseRuntimeCenter />);

    expect(await screen.findByText('Basic features')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Demo Account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Active Device' })).toBeTruthy();
    expect(screen.getByText(/license plan still controls which features are enabled/i)).toBeTruthy();
    expect(screen.getByText('One active device per license')).toBeTruthy();
    expect(screen.getByText('Advanced Recovery')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Register Demo account' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/type register demo|type change demo|type activate device/i)).toBeNull();
  });

  it('uses fast refresh only while any approval is waiting', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    render(<LicenseRuntimeCenter />);
    await screen.findByText('Basic features');
    expect(interval).toHaveBeenLastCalledWith(expect.any(Function), 60_000);

    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ pending: true }))));
    render(<LicenseRuntimeCenter />);
    await screen.findByLabelText('Approval code 4 8 2 7 3 1');
    expect(interval).toHaveBeenLastCalledWith(expect.any(Function), 15_000);
  });

  it('reveals exact-server guidance and opens a review dialog without mutating', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot()));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    fireEvent.click(await screen.findByRole('button', { name: 'Register Demo account' }));
    const serverInput = screen.getByLabelText('Exact MT5 Server');
    const helpId = serverInput.getAttribute('aria-describedby');
    expect(helpId).toBeTruthy();
    expect(document.getElementById(String(helpId))?.textContent).toMatch(/complete server value, not the broker or company name/i);

    fireEvent.change(screen.getByLabelText('Demo account number'), { target: { value: '87654321' } });
    fireEvent.change(serverInput, { target: { value: 'Broker-Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));

    const dialog = await screen.findByRole('dialog', { name: 'Register this Demo account?' });
    expect(within(dialog).getByText('87654321')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })));
  });

  it('uses the exact MT4 Server label and guidance for an MT4 license', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ platform: 'MT4' }))));
    render(<LicenseRuntimeCenter />);

    fireEvent.click(await screen.findByRole('button', { name: 'Register Demo account' }));
    const serverInput = screen.getByLabelText('Exact MT4 Server');
    const help = document.getElementById(String(serverInput.getAttribute('aria-describedby')));
    expect(help?.textContent).toMatch(/from MT4.*complete server value/i);
  });

  it('closes the review dialog with Escape, restores focus, and performs no mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot()));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    fireEvent.click(await screen.findByRole('button', { name: 'Register Demo account' }));
    fireEvent.change(screen.getByLabelText('Demo account number'), { target: { value: '87654321' } });
    fireEvent.change(screen.getByLabelText('Exact MT5 Server'), { target: { value: 'Broker-Demo' } });
    const reviewButton = screen.getByRole('button', { name: 'Review registration' });
    reviewButton.focus();
    fireEvent.click(reviewButton);
    expect(await screen.findByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(reviewButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('registers a Demo identity with semantic intent and no client authority or phrase', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse(snapshot({ demo: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    fireEvent.click(await screen.findByRole('button', { name: 'Register Demo account' }));
    fireEvent.change(screen.getByLabelText('Demo account number'), { target: { value: '87654321' } });
    fireEvent.change(screen.getByLabelText('Exact MT5 Server'), { target: { value: 'Broker-Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Demo registration' }));

    expect(await screen.findByText(/Demo account registered for this license/i)).toBeTruthy();
    const body = requestBody(fetchMock, 1);
    expect(body).toMatchObject({
      action: 'setDemoAccount',
      licenseId,
      accountNumber: '87654321',
      brokerServer: 'Broker-Demo',
      intent: 'Register',
    });
    expect(body).not.toHaveProperty('confirmation');
    expect(body).not.toHaveProperty('plan');
    expect(body).not.toHaveProperty('platform');
    expect(body).not.toHaveProperty('clientId');
  });

  it('reviews and activates an EA installation through Advanced Recovery without a phrase', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse(snapshot({ installation: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    fireEvent.click(await screen.findByText('Advanced Recovery'));
    fireEvent.change(screen.getByLabelText('Installation ID from EA'), { target: { value: installationId } });
    fireEvent.change(screen.getByLabelText('Device label'), { target: { value: 'Home laptop MT5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review device activation' }));

    const dialog = await screen.findByRole('dialog', { name: 'Activate this device?' });
    expect(within(dialog).getByText('Home laptop MT5')).toBeTruthy();
    expect(within(dialog).getByText('••••-WXYZ')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm device activation' }));

    expect(await screen.findByText(/EA can now validate from this installation/i)).toBeTruthy();
    const body = requestBody(fetchMock, 1);
    expect(body).toMatchObject({
      action: 'setInstallation',
      licenseId,
      installationId,
      deviceLabel: 'Home laptop MT5',
      intent: 'Activate',
    });
    expect(body).not.toHaveProperty('confirmation');
  });

  it('places pending approval first and requires dialog confirmation before approval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot({ pending: true })))
      .mockResolvedValueOnce(jsonResponse(snapshot({ installation: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    const code = await screen.findByLabelText('Approval code 4 8 2 7 3 1');
    expect(code.textContent).toBe('482 731');
    const pendingHeading = screen.getByRole('heading', { name: 'Match this code with your EA' });
    const demoHeading = screen.getByRole('heading', { name: 'Demo Account' });
    expect(Boolean(pendingHeading.compareDocumentPosition(demoHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Review device approval' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this device?' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve device' }));

    expect(await screen.findByText(/EA is completing its secure license check/i)).toBeTruthy();
    expect(requestBody(fetchMock, 1)).toEqual({
      action: 'resolveInstallationRequest',
      pairingRequestId: 'pending-1',
      decision: 'Approve',
    });
  });

  it('shows current and new devices before replacing an active installation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot({ installation: true, pending: true })))
      .mockResolvedValueOnce(jsonResponse(snapshot({ installation: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    const replacementActions = await screen.findAllByRole('button', { name: 'Review device replacement' });
    fireEvent.click(replacementActions[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Approve and replace the active device?' });
    expect(within(dialog).getByText('Home laptop MT5')).toBeTruthy();
    expect(within(dialog).getByText('Home MT5 terminal')).toBeTruthy();
    expect(within(dialog).getByText(/immediately deactivates the current device/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and replace device' }));
    expect(await screen.findByText(/previous device is now deactivated/i)).toBeTruthy();
    expect(requestBody(fetchMock, 1)).toMatchObject({ decision: 'Approve', pairingRequestId: 'pending-1' });
  });

  it('disables device replacement while the rolling security limit is active', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ installation: true, installationLocked: true }))));
    render(<LicenseRuntimeCenter />);

    expect((await screen.findAllByText(/Device replacement unlocks/i)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Advanced Recovery'));
    const replacement = screen.getByRole('button', { name: 'Review device replacement' }) as HTMLButtonElement;
    expect(replacement.disabled).toBe(true);
  });

  it('keeps a server rejection visible and preserves the current Demo binding', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot({ demo: true })))
      .mockResolvedValueOnce(jsonResponse({ error: 'Standard membership can replace a Demo account once every 7 days.' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    await screen.findByText('••••4321');
    fireEvent.click(screen.getByRole('button', { name: 'Change Demo account' }));
    fireEvent.change(screen.getByLabelText('Demo account number'), { target: { value: '99994321' } });
    fireEvent.change(screen.getByLabelText('Exact MT5 Server'), { target: { value: 'Broker-Demo-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Demo change' }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/once every 7 days/i)).toBeTruthy();
    expect(screen.getAllByText('••••4321').length).toBeGreaterThan(0);
    expect(requestBody(fetchMock, 1)).toMatchObject({ intent: 'Replace' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('announces a pending request on another license without changing the current selection', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot({ secondLicense: true })))
      .mockResolvedValueOnce(jsonResponse(snapshot({ secondLicense: true, secondPending: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    const select = await screen.findByLabelText('License to manage') as HTMLSelectElement;
    expect(select.value).toBe(licenseId);
    await waitFor(() => expect(interval).toHaveBeenCalledWith(expect.any(Function), 60_000));
    const poll = interval.mock.calls.find(([, delay]) => delay === 60_000)?.[0] as (() => void) | undefined;
    expect(poll).toBeTruthy();
    poll?.();

    expect(await screen.findByText('Device approval waiting on another license')).toBeTruthy();
    expect(select.value).toBe(licenseId);
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    expect(select.value).toBe(secondLicenseId);
    expect(await screen.findByLabelText('Approval code 4 8 2 7 3 1')).toBeTruthy();
  });

  it('closes a pending dialog if polling shows that the request expired', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot({ pending: true })))
      .mockResolvedValueOnce(jsonResponse(snapshot()));
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    fireEvent.click(await screen.findByRole('button', { name: 'Review device approval' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    const poll = interval.mock.calls.find(([, delay]) => delay === 15_000)?.[0] as (() => void) | undefined;
    expect(poll).toBeTruthy();
    poll?.();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/device request is no longer active/i)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores an older polling response after a device approval starts', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    const pollResponse = deferred<Response>();
    const postResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot({ pending: true })))
      .mockReturnValueOnce(pollResponse.promise)
      .mockReturnValueOnce(postResponse.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<LicenseRuntimeCenter />);

    await screen.findByRole('button', { name: 'Review device approval' });
    const poll = interval.mock.calls.find(([, delay]) => delay === 15_000)?.[0] as (() => void) | undefined;
    poll?.();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Review device approval' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this device?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve device' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    poll?.();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      pollResponse.resolve(jsonResponse(snapshot()));
      await pollResponse.promise;
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog', { name: 'Approve this device?' })).toBeTruthy();
    expect(screen.queryByText(/device request is no longer active/i)).toBeNull();

    await act(async () => {
      postResponse.resolve(jsonResponse(snapshot({ installation: true })));
      await postResponse.promise;
    });
    expect(await screen.findByText(/EA is completing its secure license check/i)).toBeTruthy();
    expect(screen.queryByText(/device request is no longer active/i)).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  return JSON.parse(String(fetchMock.mock.calls[callIndex][1]?.body)) as Record<string, unknown>;
}

function snapshot(options: {
  demo?: boolean;
  installation?: boolean;
  installationLocked?: boolean;
  pending?: boolean;
  secondLicense?: boolean;
  secondPending?: boolean;
  platform?: 'MT4' | 'MT5';
} = {}): LicenseRuntimeSnapshot {
  const first = runtimeLicense({
    id: licenseId,
    demo: options.demo,
    installation: options.installation,
    installationLocked: options.installationLocked,
    pending: options.pending,
    platform: options.platform,
  });
  const licenses = [first];
  if (options.secondLicense) {
    licenses.push(runtimeLicense({ id: secondLicenseId, pending: options.secondPending, plan: 'Premium' }));
  }
  return {
    serverTime: '2026-08-01T00:00:00Z',
    clientStatus: 'Active',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    licenses,
  };
}

function runtimeLicense(options: {
  id: string;
  demo?: boolean;
  installation?: boolean;
  installationLocked?: boolean;
  pending?: boolean;
  plan?: 'Basic' | 'Premium' | 'Lifetime';
  platform?: 'MT4' | 'MT5';
}): LicenseRuntimeSnapshot['licenses'][number] {
  return {
    id: options.id,
    maskedLicenseKey: options.id === licenseId ? 'ORN-••••-••••-••••-PQRT' : 'ORN-••••-••••-••••-WXYZ',
    plan: options.plan || 'Basic',
    platform: options.platform || 'MT5',
    status: 'Active',
    expiresAt: null,
    bindingVersion: 1,
    eligible: true,
    demoAccount: options.demo ? {
      id: 'demo-1', maskedAccountNumber: '••••4321', brokerServer: 'Broker-Demo', platform: options.platform || 'MT5', registeredAt: '2026-08-01T00:00:00Z',
    } : null,
    installation: options.installation ? {
      id: 'install-1', hint: '••••-WXYZ', label: 'Home laptop MT5', activatedAt: '2026-08-01T00:00:00Z', lastSeenAt: null,
    } : null,
    pendingInstallationRequest: options.pending ? {
      id: 'pending-1', hint: '••••-ABCD', label: 'Home MT5 terminal', maskedAccountNumber: '••••4321',
      brokerServer: 'Broker-Demo', accountType: 'Demo', platform: options.platform || 'MT5', matchCode: '482731',
      requestedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-08-01T00:10:00Z',
    } : null,
    canChangeDemo: true,
    nextDemoChangeAt: null,
    demoCooldownReason: null,
    canReplaceInstallation: !options.installationLocked,
    nextInstallationChangeAt: options.installationLocked ? '2026-08-02T00:00:00Z' : null,
    installationCooldownReason: options.installationLocked ? 'security-limit' : null,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
