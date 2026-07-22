// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortalNotificationCenter from '@/components/portal-notification-center';
import { PortalNotificationsProvider } from '@/components/portal-notifications-provider';

const notifications = [
  { id: 'notice-payment', kind: 'Payment', title: 'Payment confirmed', message: 'Your Basic payment is now marked Paid.', href: '/portal#payments', read_at: null, created_at: '2026-07-20T10:00:00Z' },
  { id: 'notice-license', kind: 'License status', title: 'License updated', message: 'Your MT5 license is active.', href: '/portal#licenses', read_at: '2026-07-20T11:00:00Z', created_at: '2026-07-20T09:00:00Z' },
  { id: 'notice-support', kind: 'Support reply', title: 'New support reply', message: 'Orion replied to your ticket.', href: '/portal#support', read_at: null, created_at: '2026-07-20T08:00:00Z' },
];

const tradingNotification = {
  id: 'notice-trading',
  kind: 'Trading alert',
  title: 'Daily loss threshold reached',
  message: 'Your configured trading risk threshold was reached.',
  href: '/portal/trading#risk-alerts',
  read_at: null,
  created_at: '2026-07-20T12:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Portal Notification Center', () => {
  it('loads real notification types, reports its summary, and filters the recent list', async () => {
    const summary = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notifications, unreadCount: 2 })));
    renderCenter(<PortalNotificationCenter embedded onSummaryChange={summary} />);

    expect(await screen.findByText('Payment confirmed')).toBeTruthy();
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ unreadCount: 2, totalCount: 3, loaded: true }));
    fireEvent.click(screen.getByRole('button', { name: /Licenses 1/i }));
    expect(screen.getByText('License updated')).toBeTruthy();
    expect(screen.queryByText('Payment confirmed')).toBeNull();
    expect(screen.queryByText('New support reply')).toBeNull();
  });

  it('filters trading alerts into their own Activity-styled category', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      notifications: [tradingNotification, ...notifications],
      unreadCount: 3,
    })));
    renderCenter(<PortalNotificationCenter embedded />);

    fireEvent.click(await screen.findByRole('button', { name: /Trading 1/i }));

    const alertTitle = screen.getByText('Daily loss threshold reached');
    const item = alertTitle.closest('li');
    const kind = item?.querySelector('[data-kind="trading"]');
    expect(kind).toBeTruthy();
    expect(kind?.querySelector('.lucide-activity')).toBeTruthy();
    expect(screen.queryByText('Payment confirmed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('shows a truthful empty state when no trading alerts exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notifications, unreadCount: 2 })));
    renderCenter(<PortalNotificationCenter embedded />);

    fireEvent.click(await screen.findByRole('button', { name: /Trading 0/i }));

    expect(screen.getByText('No trading updates')).toBeTruthy();
    expect(screen.getByText('Choose another filter to view the rest of your account activity.')).toBeTruthy();
  });

  it('marks every update read and shows visible success feedback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ notifications, unreadCount: 2 }))
      .mockResolvedValueOnce(jsonResponse({ updated: 2, unreadCount: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    renderCenter(<PortalNotificationCenter embedded />);

    fireEvent.click(await screen.findByRole('button', { name: /Mark all read/i }));

    expect(await screen.findByText('All updates marked as read.')).toBeTruthy();
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe('/api/notifications');
    expect(JSON.parse(request[1].body)).toEqual({ all: true, read: true });
    expect(screen.queryByText('New')).toBeNull();
  });

  it('distinguishes an unavailable timeline from an empty account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Notifications are temporarily unavailable' }, 500))
      .mockResolvedValueOnce(jsonResponse({ notifications: [], unreadCount: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    renderCenter(<PortalNotificationCenter embedded />);

    expect(await screen.findByText('Notifications are temporarily unavailable')).toBeTruthy();
    expect(screen.queryByText('You’re up to date')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You’re up to date')).toBeTruthy();
  });

  it('keeps long notification histories compact until requested', async () => {
    const longList = Array.from({ length: 7 }, (_, index) => ({ ...notifications[0], id: `notice-${index}`, title: `Update ${index}`, created_at: `2026-07-${String(20 - index).padStart(2, '0')}T10:00:00Z` }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notifications: longList, unreadCount: 7 })));
    renderCenter(<PortalNotificationCenter embedded />);

    expect(await screen.findByText('Update 0')).toBeTruthy();
    expect(screen.queryByText('Update 5')).toBeNull();
    const showOlder = screen.getByRole('button', { name: /Show 2 older updates/i });
    expect(showOlder.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(showOlder);
    expect(screen.getByText('Update 5')).toBeTruthy();
    expect(screen.getByText('Update 6')).toBeTruthy();
  });
});

function renderCenter(center: React.ReactNode) {
  return render(<PortalNotificationsProvider>{center}</PortalNotificationsProvider>);
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
