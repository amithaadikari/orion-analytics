// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradingAccountSnapshot } from '@/lib/trading-accounts';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import TradingAccountCenter from '@/components/trading-account-center';

describe('client trading-account center', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => '22222222-2222-4222-8222-222222222222' });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('shows the exact Lifetime Standard cooldown and preserves the current masked identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ canChange: false, nextChangeAt: '2026-07-28T12:00:00Z', cooldownReason: 'standard' }))));
    render(<TradingAccountCenter />);
    expect(await screen.findByText('••••5678')).toBeTruthy();
    expect(screen.getAllByText(/Standard membership unlocks on/i)).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Review account change' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Lifetime includes replacement access/i)).toBeTruthy();
  });

  it('explains active Pro timing only inside Lifetime replacement access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ membership: { storedTier: 'Pro', effectiveTier: 'Pro', status: 'Active', startedAt: null, expiresAt: null } }))));
    render(<TradingAccountCenter />);
    expect(await screen.findByText('Lifetime')).toBeTruthy();
    expect(screen.getByText(/No 7-day wait/i)).toBeTruthy();
    expect(screen.getByText(/two self-service replacements/i)).toBeTruthy();
  });

  it.each(['Basic', 'Premium'] as const)('replaces the edit form with a clear %s plan lock', async (clientPlan) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ clientPlan, canChange: false, nextChangeAt: null, cooldownReason: 'plan-locked' }))));
    render(<TradingAccountCenter />);
    expect(await screen.findByText(`Your ${clientPlan} account is securely locked`)).toBeTruthy();
    expect(screen.getAllByText(/Self-service replacement is available only with Lifetime/i).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Real account number')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review account change' })).toBeNull();
    expect(screen.getByRole('link', { name: /contact Orion support/i }).getAttribute('href')).toBe('#support');
  });

  it('reloads authoritative eligibility when an open-page cooldown reaches its deadline', async () => {
    const locked = snapshot({ canChange: false, nextChangeAt: new Date(Date.now() + 10).toISOString(), cooldownReason: 'standard' });
    const unlocked = snapshot({ canChange: true, nextChangeAt: null, cooldownReason: null });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(locked)).mockResolvedValueOnce(jsonResponse(unlocked));
    vi.stubGlobal('fetch', fetchMock);
    render(<TradingAccountCenter />);
    await screen.findByText('••••5678');
    fireEvent.change(screen.getByLabelText('Real account number'), { target: { value: '99994321' } });
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live-2' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Review account change' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('reviews an initial registration before posting semantic intent without a typed phrase', async () => {
    const first = snapshot({ currentAccount: null, hasRegisteredAccount: false, licensesBound: 0, legacyReview: { pendingCount: 1, suggestedAccountNumber: '87654321' }, history: [] });
    const saved = snapshot({ currentAccount: account('87654321', '••••4321'), licensesBound: 1, legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(first)).mockResolvedValueOnce(jsonResponse({ ...saved, mutation: { changed: true, reboundLicenses: 1 } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    render(<TradingAccountCenter />);

    expect(await screen.findByDisplayValue('87654321')).toBeTruthy();
    expect(screen.queryByLabelText(/Type REGISTER ACCOUNT/i)).toBeNull();
    expect(screen.queryByText(/Type REGISTER ACCOUNT to confirm/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review account registration' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole('dialog', { name: 'Register this real account?' });
    expect(within(dialog).getByText('87654321')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Go back' })));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm registration' }));

    expect(await screen.findByText('••••4321')).toBeTruthy();
    expect(screen.getByText(/1 active license bound successfully/i)).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ requestId: '22222222-2222-4222-8222-222222222222', accountNumber: '87654321', intent: 'Register' });
    expect(body).not.toHaveProperty('confirmation');
    expect(body).not.toHaveProperty('clientId');
    expect(body).not.toHaveProperty('membershipTier');
  });

  it.each(['Basic', 'Premium'] as const)('allows first %s registration and warns that the identity becomes fixed', async (clientPlan) => {
    const first = snapshot({ clientPlan, currentAccount: null, hasRegisteredAccount: false, licensesBound: 0 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(first)));
    render(<TradingAccountCenter />);
    await screen.findByText('Vault awaiting registration');
    fireEvent.change(screen.getByLabelText('Real account number'), { target: { value: '87654321' } });
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review account registration' }));
    const dialog = await screen.findByRole('dialog', { name: 'Register this real account?' });
    expect(within(dialog).getByText(new RegExp(`After registration, the ${clientPlan} plan cannot replace this account`, 'i'))).toBeTruthy();
  });

  it('cancels the review without posting and restores focus to the review button', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot({ currentAccount: null, hasRegisteredAccount: false, licensesBound: 0 })));
    vi.stubGlobal('fetch', fetchMock);
    render(<TradingAccountCenter />);
    await screen.findByText('Vault awaiting registration');
    fireEvent.change(screen.getByLabelText('Real account number'), { target: { value: '87654321' } });
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live' } });
    const reviewButton = screen.getByRole('button', { name: 'Review account registration' });
    reviewButton.focus();
    fireEvent.click(reviewButton);
    const dialog = await screen.findByRole('dialog', { name: 'Register this real account?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(reviewButton));
  });

  it('keeps the old account visible and shows a failed replacement inside the review dialog', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse({ error: 'Standard membership can replace a real account once every 7 days.', nextChangeAt: '2026-07-28T12:00:00Z' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    render(<TradingAccountCenter />);
    expect(await screen.findByText('••••5678')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Real account number'), { target: { value: '99994321' } });
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review account change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace this real account?' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm account change' }));
    expect(await within(dialog).findByText(/once every 7 days/i)).toBeTruthy();
    expect(screen.getAllByText('••••5678').length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body.intent).toBe('Replace');
    expect(body).not.toHaveProperty('confirmation');
  });
});

function snapshot(overrides: Partial<TradingAccountSnapshot> = {}): TradingAccountSnapshot {
  return {
    serverTime: '2026-07-21T12:00:00Z', clientStatus: 'Active',
    clientPlan: 'Lifetime',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    currentAccount: account('12345678', '••••5678'), hasRegisteredAccount: true, licensesBound: 1, eligibleLicenses: 1, eligiblePlatforms: ['MT5'],
    canChange: true, nextChangeAt: null, cooldownDays: 7, cooldownReason: null,
    legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [], ...overrides,
  };
}

function account(accountNumber: string, maskedAccountNumber: string) {
  return {
    id: 'account-1',
    accountNumber,
    maskedAccountNumber,
    broker: 'Broker Ltd',
    brokerServer: 'Broker-Live',
    platform: 'MT5' as const,
    currency: 'USD',
    status: 'Active',
    verifiedAt: '2026-07-21T12:00:00Z',
    registeredAt: '2026-07-21T12:00:00Z',
    deactivatedAt: null,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
