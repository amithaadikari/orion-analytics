// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSettingsPanel, { type AdminAccountSnapshot } from '@/components/admin-settings-panel';

const account: AdminAccountSnapshot = {
  email: 'owner@orionscalper.com',
  emailVerified: true,
  pendingEmail: null,
  role: 'admin',
  accountCreatedAt: '2026-01-01T00:00:00.000Z',
  lastSignInAt: '2026-07-20T12:00:00.000Z',
  currentDevice: 'Desktop · Chrome · macOS · LK',
  initialFactorId: null,
  profile: { displayName: 'Orion Administrator', avatarKey: 'robot-core' },
  preferences: {
    theme: 'royal', registrationAlerts: true, paymentAlerts: true, licenseAlerts: true, supportAlerts: true,
  },
};

describe('administrator settings center', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      profile: { displayName: 'Orion Owner', avatarKey: 'robot-radar' },
      preferences: { theme: 'black', registrationAlerts: true, paymentAlerts: true, licenseAlerts: false, supportAlerts: true },
      activities: [{ id: 'event-1', type: 'session_started', title: 'New administrator sign-in', detail: 'A successful session was opened.', createdAt: '2026-07-20T12:00:00.000Z', device: 'Desktop · Chrome · macOS · LK', current: true }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads the saved identity, alert choices, and sanitized security activity', async () => {
    render(<AdminSettingsPanel account={account} theme="royal" onThemeChange={vi.fn()} onProfileChange={vi.fn()} onPreferencesChange={vi.fn()} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Orion Owner' })).toBeTruthy();
    expect(screen.getByText('New administrator sign-in')).toBeTruthy();
    expect(screen.getAllByText('Desktop · Chrome · macOS · LK').length).toBeGreaterThan(0);
    expect((screen.getByRole('checkbox', { name: /License expiry/i }) as HTMLInputElement).checked).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin-account-security', expect.objectContaining({ cache: 'no-store' }));
  });

  it('rolls an alert toggle back when persistence fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        profile: account.profile,
        preferences: account.preferences,
        activities: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unable to save alert preferences.' }), { status: 500 }));
    render(<AdminSettingsPanel account={account} theme="royal" onThemeChange={vi.fn()} onProfileChange={vi.fn()} onPreferencesChange={vi.fn()} onNavigate={vi.fn()} />);

    const paymentAlerts = await screen.findByRole('checkbox', { name: /Payment verification/i });
    await waitFor(() => expect((paymentAlerts as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(paymentAlerts);
    await waitFor(() => expect(screen.getByText('Unable to save alert preferences.')).toBeTruthy());
    expect((paymentAlerts as HTMLInputElement).checked).toBe(true);
    const patch = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      action: 'preferences', registrationAlerts: true, paymentAlerts: false, licenseAlerts: true, supportAlerts: true,
    });
  });
});
