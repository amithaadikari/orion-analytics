// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows the exact Standard cooldown and preserves the current masked identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ canChange: false, nextChangeAt: '2026-07-28T12:00:00Z', cooldownReason: 'standard' }))));
    render(<TradingAccountCenter />);
    expect(await screen.findByText('••••5678')).toBeTruthy();
    expect(screen.getAllByText(/Standard membership unlocks on/i)).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Change and rebind licenses' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/successful self-service replacement starts a 7-day cooldown/i)).toBeTruthy();
  });

  it('explains active Pro access without presenting it as a seven-day rule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot({ membership: { storedTier: 'Pro', effectiveTier: 'Pro', status: 'Active', startedAt: null, expiresAt: null } }))));
    render(<TradingAccountCenter />);
    expect(await screen.findByText('Pro')).toBeTruthy();
    expect(screen.getByText(/No 7-day wait/i)).toBeTruthy();
    expect(screen.getByText(/two self-service replacements/i)).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText(/Type CHANGE ACCOUNT/i), { target: { value: 'CHANGE ACCOUNT' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Change and rebind licenses' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('registers an initial account with typed confirmation and refreshes the visible binding', async () => {
    const first = snapshot({ currentAccount: null, licensesBound: 0, legacyReview: { pendingCount: 1, suggestedAccountNumber: '87654321' }, history: [] });
    const saved = snapshot({ currentAccount: account('87654321', '••••4321'), licensesBound: 1, legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(first)).mockResolvedValueOnce(jsonResponse({ ...saved, mutation: { changed: true, reboundLicenses: 1 } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    render(<TradingAccountCenter />);

    expect(await screen.findByDisplayValue('87654321')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live' } });
    fireEvent.change(screen.getByLabelText(/Type REGISTER ACCOUNT/i), { target: { value: 'REGISTER ACCOUNT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register and bind licenses' }));

    expect(await screen.findByText('••••4321')).toBeTruthy();
    expect(screen.getByText(/1 active license bound successfully/i)).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ requestId: '22222222-2222-4222-8222-222222222222', accountNumber: '87654321', confirmation: 'REGISTER ACCOUNT' });
    expect(body).not.toHaveProperty('clientId');
    expect(body).not.toHaveProperty('membershipTier');
  });

  it('keeps the old account visible when the database rejects a replacement', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse({ error: 'Standard membership can replace a real account once every 7 days.', nextChangeAt: '2026-07-28T12:00:00Z' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    render(<TradingAccountCenter />);
    expect(await screen.findByText('••••5678')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Real account number'), { target: { value: '99994321' } });
    fireEvent.change(screen.getByLabelText('Broker'), { target: { value: 'Broker Ltd' } });
    fireEvent.change(screen.getByLabelText('Exact broker server'), { target: { value: 'Broker-Live-2' } });
    fireEvent.change(screen.getByLabelText(/Type CHANGE ACCOUNT/i), { target: { value: 'CHANGE ACCOUNT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change and rebind licenses' }));
    expect(await screen.findByText(/once every 7 days/i)).toBeTruthy();
    expect(screen.getByText('••••5678')).toBeTruthy();
  });
});

function snapshot(overrides: Partial<TradingAccountSnapshot> = {}): TradingAccountSnapshot {
  return {
    serverTime: '2026-07-21T12:00:00Z', clientStatus: 'Active',
    membership: { storedTier: 'Standard', effectiveTier: 'Standard', status: 'Active', startedAt: null, expiresAt: null },
    currentAccount: account('12345678', '••••5678'), licensesBound: 1, eligibleLicenses: 1, eligiblePlatforms: ['MT5'],
    canChange: true, nextChangeAt: null, cooldownDays: 7, cooldownReason: null,
    legacyReview: { pendingCount: 0, suggestedAccountNumber: null }, history: [], ...overrides,
  };
}
function account(accountNumber: string, maskedAccountNumber: string) { return { id: 'account-1', accountNumber, maskedAccountNumber, broker: 'Broker Ltd', brokerServer: 'Broker-Live', platform: 'MT5' as const, currency: 'USD', status: 'Active', verifiedAt: '2026-07-21T12:00:00Z', registeredAt: '2026-07-21T12:00:00Z', deactivatedAt: null }; }
function jsonResponse(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }); }
