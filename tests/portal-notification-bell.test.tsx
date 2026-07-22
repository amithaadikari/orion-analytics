// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortalNotificationBell from '@/components/portal-notification-bell';
import PortalNotificationCenter from '@/components/portal-notification-center';
import { PortalNotificationsProvider, usePortalNotifications } from '@/components/portal-notifications-provider';

const notifications = Array.from({ length: 6 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  kind: index === 0 ? 'Support reply' : index === 1 ? 'Payment' : 'License status',
  title: index === 0 ? 'New support reply' : `Account update ${index}`,
  message: `Secure Orion update ${index}.`,
  href: index === 0 ? '/portal#support' : '/portal#notifications',
  ticketId: index === 0 ? '10000000-0000-4000-8000-000000000000' : null,
  read_at: null,
  created_at: `2026-07-20T${String(12 - index).padStart(2, '0')}:00:00Z`,
}));

const tradingNotification = {
  id: '00000000-0000-4000-8000-000000000099',
  kind: 'Trading alert',
  title: 'Floating drawdown alert',
  message: 'Your configured floating drawdown threshold was reached.',
  href: '/portal/trading#risk-alerts',
  ticketId: null,
  read_at: null,
  created_at: '2026-07-20T13:00:00Z',
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Portal notification bell', () => {
  it('shares one notification request with the full center and shows the exact count plus newest five', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ notifications, unreadCount: 12 }));
    vi.stubGlobal('fetch', fetchMock);
    renderNotifications(<><PortalNotificationBell /><PortalNotificationCenter embedded /></>);

    const trigger = await screen.findByRole('button', { name: 'Notifications, 12 unread' });
    expect(within(trigger).getByText('9+')).toBeTruthy();
    expect(screen.getByLabelText('12 unread notifications')).toBeTruthy();
    expect(getNotificationGets(fetchMock)).toHaveLength(1);

    fireEvent.click(trigger);
    const popover = screen.getByRole('region', { name: 'Recent notifications' });
    expect(within(popover).getByText('New support reply')).toBeTruthy();
    expect(within(popover).getByText('Account update 4')).toBeTruthy();
    expect(within(popover).queryByText('Account update 5')).toBeNull();
  });

  it('uses the Trading tone and Activity icon for trading alerts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notifications: [tradingNotification], unreadCount: 1 })));
    renderNotifications(<PortalNotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));

    const popover = screen.getByRole('region', { name: 'Recent notifications' });
    const item = within(popover).getByRole('button', { name: /Floating drawdown alert/i });
    const kind = item.querySelector('[data-kind="trading"]');
    expect(kind).toBeTruthy();
    expect(kind?.querySelector('.lucide-activity')).toBeTruthy();
  });

  it('keeps the top badge and full center synchronized when all updates are read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ notifications, unreadCount: 6 }))
      .mockResolvedValueOnce(jsonResponse({ updated: 6, unreadCount: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    renderNotifications(<><PortalNotificationBell /><PortalNotificationCenter embedded /></>);

    const trigger = await screen.findByRole('button', { name: 'Notifications, 6 unread' });
    fireEvent.click(trigger);
    const popover = screen.getByRole('region', { name: 'Recent notifications' });
    fireEvent.click(within(popover).getByRole('button', { name: 'Mark all as read' }));

    expect(await screen.findByRole('button', { name: 'Notifications, none unread' })).toBeTruthy();
    expect(screen.getByLabelText('0 unread notifications')).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ all: true, read: true });
  });

  it('opens a safe destination even when marking that notification read fails', async () => {
    window.history.replaceState(null, '', '/portal');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ notifications: [notifications[0]], unreadCount: 1 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unable to update notifications' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    renderNotifications(<PortalNotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    const popover = screen.getByRole('region', { name: 'Recent notifications' });
    fireEvent.click(within(popover).getByRole('button', { name: /New support reply/i }));

    await waitFor(() => expect(window.location.hash).toBe('#support'));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: notifications[0].id, read: true });
  });

  it('closes with Escape or an outside click and restores focus from the panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notifications: [], unreadCount: 0 })));
    renderNotifications(<PortalNotificationBell />);
    const trigger = await screen.findByRole('button', { name: 'Notifications, none unread' });

    fireEvent.click(trigger);
    const viewAll = screen.getByRole('link', { name: /View all account updates/i });
    viewAll.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Recent notifications' })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    screen.getByRole('link', { name: /View all account updates/i }).focus();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region', { name: 'Recent notifications' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('quietly refreshes on focus and marks a bounded set through shared state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ notifications: notifications.slice(0, 3), unreadCount: 3 }))
      .mockResolvedValueOnce(jsonResponse({ notifications: notifications.slice(0, 3), unreadCount: 3 }))
      .mockResolvedValueOnce(jsonResponse({ updated: 2, unreadCount: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    renderNotifications(<><PortalNotificationBell /><MarkManyProbe ids={[notifications[0].id, notifications[1].id]} /></>);

    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(getNotificationGets(fetchMock)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Mark selected notifications' }));

    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ ids: [notifications[0].id, notifications[1].id], read: true });
  });
});

function MarkManyProbe({ ids }: { ids: string[] }) {
  const { markMany } = usePortalNotifications();
  return <button type="button" onClick={() => void markMany(ids)}>Mark selected notifications</button>;
}

function renderNotifications(children: React.ReactNode) {
  return render(<PortalNotificationsProvider>{children}</PortalNotificationsProvider>);
}

function getNotificationGets(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input, init]) => typeof input === 'string' && input.startsWith('/api/notifications?') && !init?.method);
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
