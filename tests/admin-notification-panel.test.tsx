// @vitest-environment jsdom

import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminNotificationPanel, { parseHeaderCounts } from '@/components/admin-notification-panel';
import type { AdminAlertPreferences, AlertCounts } from '@/components/admin-action-center';

const allAlertsEnabled: AdminAlertPreferences = {
  registrationAlerts: true,
  paymentAlerts: true,
  licenseAlerts: true,
  supportAlerts: true,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('administrator notification panel', () => {
  it('shows a loading state, then an exact preference-aware badge while keeping every queue visible', async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PanelHarness
        preferences={{
          ...allAlertsEnabled,
          paymentAlerts: false,
          supportAlerts: false,
        }}
      />,
    );

    const loadingTrigger = screen.getByRole('button', {
      name: 'Administrator action inbox. Queue status is loading or unavailable.',
    });
    fireEvent.click(loadingTrigger);
    expect(screen.getByRole('status', { name: 'Loading administrator action inbox' })).toBeTruthy();

    await act(async () => {
      response.resolve(jsonResponse(headerPayload({
        registrations: 3,
        payments: 4,
        licenses: 5,
        support: 6,
        suspended: 2,
      })));
      await response.promise;
    });

    const trigger = await screen.findByRole('button', {
      name: 'Administrator action inbox. 10 items need attention.',
    });
    expect(within(trigger).getByText('10')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/action-center?view=header', {
      cache: 'no-store',
      credentials: 'same-origin',
    });

    const panel = screen.getByRole('region', { name: 'Action inbox' });
    expect(within(panel).getByText('10 items need attention')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Registration reviews: 3 records. Open review page.' })).toBeTruthy();

    const paymentQueue = within(panel).getByRole('button', {
      name: 'Payment verification: 4 records. Open review page.',
    });
    expect(within(paymentQueue).getByText('4')).toBeTruthy();
    expect(within(paymentQueue).getByText('Hidden from header count')).toBeTruthy();

    const supportQueue = within(panel).getByRole('button', {
      name: 'Support conversations: 6 records. Open review page.',
    });
    expect(within(supportQueue).getByText('Hidden from header count')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Suspended clients: 2 records. Open review page.' })).toBeTruthy();
  });

  it('opens the selected review destination, closes the panel, and restores trigger focus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(headerPayload(baseCounts))));
    const onNavigate = vi.fn();
    render(<PanelHarness initialCounts={baseCounts} onNavigate={onNavigate} />);

    const trigger = screen.getByRole('button', { name: 'Administrator action inbox. 5 items need attention.' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', {
      name: 'Payment verification: 1 record. Open review page.',
    }));

    expect(onNavigate).toHaveBeenCalledWith('payments', 'Pending');
    expect(screen.queryByRole('region', { name: 'Action inbox' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Open full Action Center/i }));
    expect(onNavigate).toHaveBeenLastCalledWith('overview', undefined);
  });

  it('closes with Escape or an outside click and restores focus when focus was inside', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(headerPayload(baseCounts))));
    render(<PanelHarness initialCounts={baseCounts} />);
    const trigger = screen.getByRole('button', { name: 'Administrator action inbox. 5 items need attention.' });

    fireEvent.click(trigger);
    const refresh = screen.getByRole('button', { name: 'Refresh operational queues' });
    refresh.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Action inbox' })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    screen.getByRole('button', { name: /Open full Action Center/i }).focus();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region', { name: 'Action inbox' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('explains a failed initial load and recovers through the retry action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse(headerPayload(baseCounts)));
    vi.stubGlobal('fetch', fetchMock);
    render(<PanelHarness />);

    const trigger = screen.getByRole('button', {
      name: 'Administrator action inbox. Queue status is loading or unavailable.',
    });
    fireEvent.click(trigger);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Action inbox unavailable')).toBeTruthy();
    expect(within(alert).getByText('Live operational queues could not be loaded.')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('5 items need attention')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Action inbox unavailable')).toBeNull();
  });

  it('rejects malformed or internally inconsistent count payloads', () => {
    expect(parseHeaderCounts({ counts: { ...baseCounts, total: 5 } })).toEqual(baseCounts);
    expect(parseHeaderCounts({ counts: { ...baseCounts, total: 99 } })).toBeNull();
    expect(parseHeaderCounts({ counts: { ...baseCounts, support: -1, total: 3 } })).toBeNull();
    expect(parseHeaderCounts({ counts: { ...baseCounts, payments: 1.5, total: 5.5 } })).toBeNull();
    expect(parseHeaderCounts({ alerts: baseCounts })).toBeNull();
  });
});

const baseCounts: AlertCounts = {
  registrations: 1,
  payments: 1,
  licenses: 1,
  support: 1,
  suspended: 1,
};

function PanelHarness({
  initialCounts = null,
  preferences = allAlertsEnabled,
  onNavigate = vi.fn(),
}: {
  initialCounts?: AlertCounts | null;
  preferences?: AdminAlertPreferences;
  onNavigate?: (section: string, filter?: string) => void;
}) {
  const [counts, setCounts] = useState<AlertCounts | null>(initialCounts);
  return (
    <AdminNotificationPanel
      counts={counts}
      preferences={preferences}
      onCountsChange={setCounts}
      onNavigate={onNavigate}
    />
  );
}

function headerPayload(counts: AlertCounts) {
  return {
    counts: {
      ...counts,
      total: counts.registrations + counts.payments + counts.licenses + counts.support + counts.suspended,
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
