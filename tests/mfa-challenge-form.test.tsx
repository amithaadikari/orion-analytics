// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  challengeAndVerify: vi.fn(),
  signOut: vi.fn(),
  record: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: () => ({ auth: { mfa: { challengeAndVerify: mocks.challengeAndVerify }, signOut: mocks.signOut } }) }));
vi.mock('@/lib/account-security-client', () => ({ recordAccountSecurityEvent: mocks.record }));

import MfaChallengeForm from '@/components/mfa-challenge-form';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('MFA sign-in challenge', () => {
  it('rejects an incomplete code before calling Supabase', () => {
    render(<MfaChallengeForm factors={[{ id: 'factor-1', label: 'Orion Authenticator' }]} next="/portal/settings" signInPath="/client-login" />);
    fireEvent.change(screen.getByLabelText(/Six-digit authenticator code/i), { target: { value: '123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify & continue' }).closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/complete six-digit/i);
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('verifies the enrolled factor, records the session, and returns to the safe destination', async () => {
    mocks.challengeAndVerify.mockResolvedValue({ error: null });
    mocks.record.mockResolvedValue(true);
    render(<MfaChallengeForm factors={[{ id: 'factor-1', label: 'Orion Authenticator' }]} next="/portal/settings" signInPath="/client-login" />);
    fireEvent.change(screen.getByLabelText(/Six-digit authenticator code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));
    await waitFor(() => expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' }));
    expect(mocks.record).toHaveBeenCalledWith('session_started');
    expect(mocks.replace).toHaveBeenCalledWith('/portal/settings');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('prevents switching accounts while verification is in progress', async () => {
    let finishVerification!: (value: { error: null }) => void;
    mocks.challengeAndVerify.mockReturnValue(new Promise((resolve) => { finishVerification = resolve; }));
    mocks.record.mockResolvedValue(true);
    render(<MfaChallengeForm factors={[{ id: 'factor-1', label: 'Orion Authenticator' }]} next="/portal" signInPath="/client-login" />);
    fireEvent.change(screen.getByLabelText(/Six-digit authenticator code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & continue' }));

    await waitFor(() => expect(mocks.challengeAndVerify).toHaveBeenCalled());
    expect((screen.getByRole('button', { name: 'Use another account' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.signOut).not.toHaveBeenCalled();

    finishVerification({ error: null });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/portal'));
  });
});
