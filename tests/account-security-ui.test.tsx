// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ browserClient: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: mocks.browserClient }));

import ClientAccountSettings from '@/components/client-account-settings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('client account security settings', () => {
  it('shows truthful status, forward-only activity, and saves the real reminder preference', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        preferences: { licenseReminders: true, securityAlerts: true },
        activities: [{
          id: 'event-1',
          type: 'session_started',
          title: 'New sign-in recorded',
          detail: 'A successful Orion account session was opened.',
          createdAt: '2026-07-20T12:00:00.000Z',
          device: 'Desktop · Chrome · macOS · LK',
          current: true,
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ preferences: { licenseReminders: false, securityAlerts: true } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ClientAccountSettings
      email="trader@example.com"
      emailVerified
      pendingEmail={null}
      accountCreatedAt="2026-07-01T00:00:00.000Z"
      lastSignInAt="2026-07-20T12:00:00.000Z"
      currentDevice="Desktop · Chrome · macOS · LK"
      initialFactorId={null}
    />);

    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('Not enabled')).toBeTruthy();
    expect(await screen.findByText('New sign-in recorded')).toBeTruthy();
    expect(screen.getAllByText('Current')).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Set up authenticator' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/recorded from this update onward/i)).toBeTruthy();

    const preference = screen.getByRole('checkbox') as HTMLInputElement;
    expect(preference.checked).toBe(true);
    fireEvent.click(preference);
    await waitFor(() => expect(preference.checked).toBe(false));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/account-security', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ licenseReminders: false }),
    }));
  });

  it('gates new authenticator enrollment when database assurance is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Migration pending' }, 503)));
    render(<ClientAccountSettings
      email="trader@example.com"
      emailVerified={false}
      pendingEmail={null}
      accountCreatedAt="2026-07-01T00:00:00.000Z"
      lastSignInAt={null}
      currentDevice="Desktop · Unknown browser · Unknown OS"
      initialFactorId={null}
    />);

    expect(await screen.findByText('Security records are not active yet')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Setup temporarily unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No historical devices are fabricated/i)).toBeTruthy();
  });

  it('changes the password directly through Supabase and never sends password values to Orion', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    mocks.browserClient.mockReturnValue({ auth: { updateUser } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ preferences: { licenseReminders: true, securityAlerts: true }, activities: [] }))
      .mockResolvedValueOnce(jsonResponse({ activity: { id: 'event-2', type: 'password_changed', title: 'Password changed', detail: 'Updated.', createdAt: '2026-07-20T12:00:00Z', device: 'Desktop' } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    render(<ClientAccountSettings
      email="trader@example.com"
      emailVerified
      pendingEmail={null}
      accountCreatedAt="2026-07-01T00:00:00.000Z"
      lastSignInAt="2026-07-20T12:00:00.000Z"
      currentDevice="Desktop · Chrome · macOS"
      initialFactorId={null}
    />);
    await screen.findByRole('button', { name: 'Set up authenticator' });

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'CurrentPass1!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewSecurePass2!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewSecurePass2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ current_password: 'CurrentPass1!', password: 'NewSecurePass2!' }));
    expect(await screen.findByText(/Password changed successfully/i)).toBeTruthy();
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith('/api/account-security', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ event: 'password_changed' }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('CurrentPass1!');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('NewSecurePass2!');
  });

  it('uses Supabase’s QR data URL once and never cleans up a newly verified factor', async () => {
    const qrCode = 'data:image/svg+xml;utf-8,%3Csvg%3Eqr%3C%2Fsvg%3E';
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: null });
    mocks.browserClient.mockReturnValue({ auth: { mfa: {
      listFactors: vi.fn().mockResolvedValue({ data: { all: [] }, error: null }),
      enroll: vi.fn().mockResolvedValue({ data: { id: 'factor-new', type: 'totp', totp: { qr_code: qrCode, secret: 'ABCDEF123456', uri: 'otpauth://totp/example' } }, error: null }),
      challengeAndVerify,
      unenroll,
    } } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ preferences: { licenseReminders: true, securityAlerts: true }, activities: [] }))
      .mockResolvedValueOnce(jsonResponse({ activity: { id: 'mfa-event', type: 'mfa_enabled', title: 'Authenticator protection enabled', detail: 'Enabled.', createdAt: '2026-07-20T12:00:00Z', device: 'Desktop' } }, 201)));
    const rendered = render(<ClientAccountSettings
      email="trader@example.com"
      emailVerified
      pendingEmail={null}
      accountCreatedAt="2026-07-01T00:00:00.000Z"
      lastSignInAt="2026-07-20T12:00:00.000Z"
      currentDevice="Desktop · Chrome · macOS"
      initialFactorId={null}
    />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    const qr = await screen.findByAltText('Orion authenticator enrollment QR code');
    expect(qr.getAttribute('src')).toBe(qrCode);
    const enrollmentCode = screen.getByLabelText(/Enter the current six-digit code/i);
    expect(document.activeElement).toBe(enrollmentCode);
    fireEvent.change(enrollmentCode, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    await waitFor(() => expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-new', code: '123456' }));
    expect(await screen.findByText(/Authenticator protection is active/i)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove this authenticator' })));
    rendered.unmount();
    expect(unenroll).not.toHaveBeenCalled();
  });

  it('returns keyboard focus to authenticator setup after cancelling enrollment', async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    mocks.browserClient.mockReturnValue({ auth: { mfa: {
      listFactors: vi.fn().mockResolvedValue({ data: { all: [] }, error: null }),
      enroll: vi.fn().mockResolvedValue({ data: { id: 'factor-pending', type: 'totp', totp: { qr_code: '<svg />', secret: 'PENDING123456', uri: 'otpauth://totp/example' } }, error: null }),
      unenroll,
    } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      preferences: { licenseReminders: true, securityAlerts: true },
      activities: [],
    })));
    render(<ClientAccountSettings
      email="trader@example.com"
      emailVerified
      pendingEmail={null}
      accountCreatedAt="2026-07-01T00:00:00.000Z"
      lastSignInAt="2026-07-20T12:00:00.000Z"
      currentDevice="Desktop · Chrome · macOS"
      initialFactorId={null}
    />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel safely' }));
    await waitFor(() => expect(unenroll).toHaveBeenCalledWith({ factorId: 'factor-pending' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Set up authenticator' })));
  });

  it('moves keyboard focus into inline security confirmations and restores it on cancel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      preferences: { licenseReminders: true, securityAlerts: true },
      activities: [],
    })));
    render(<ClientAccountSettings
      email="trader@example.com"
      emailVerified
      pendingEmail={null}
      accountCreatedAt="2026-07-01T00:00:00.000Z"
      lastSignInAt="2026-07-20T12:00:00.000Z"
      currentDevice="Desktop · Chrome · macOS"
      initialFactorId="factor-existing"
    />);
    await screen.findByText('Authenticator enabled');

    const remove = screen.getByRole('button', { name: 'Remove this authenticator' });
    fireEvent.click(remove);
    const confirmRemoval = screen.getByRole('button', { name: 'Yes, remove it' });
    expect(document.activeElement).toBe(confirmRemoval);
    fireEvent.click(screen.getByRole('button', { name: 'Keep protection' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove this authenticator' })));

    const signOut = screen.getByRole('button', { name: 'Sign out other devices' });
    fireEvent.click(signOut);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign out other devices' })));
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
