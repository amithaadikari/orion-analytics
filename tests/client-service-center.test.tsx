// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClientServiceCenter from '@/components/client-service-center';
import { PortalNotificationsProvider } from '@/components/portal-notifications-provider';

const linkedTicket = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  subject: 'License will not activate',
  category: 'License',
  priority: 'High',
  status: 'Waiting on client',
  createdAt: '2026-07-19T08:00:00Z',
  updatedAt: '2026-07-20T10:00:00Z',
  closedAt: null,
  messages: [
    { id: 'message-admin', authorType: 'Admin', body: 'Please confirm your MT5 account number.', createdAt: '2026-07-20T10:00:00Z' },
  ],
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Client Updates and Support Center', () => {
  it('keeps both workspaces mounted, switches views, and preserves a ticket draft', async () => {
    vi.stubGlobal('fetch', serviceFetch());
    window.history.replaceState(null, '', '/portal');
    renderServiceCenter();

    expect(await screen.findByText('You’re up to date')).toBeTruthy();
    const updatesPanel = document.getElementById('notifications') as HTMLElement;
    const supportPanel = document.getElementById('support') as HTMLElement;
    expect(updatesPanel.hidden).toBe(false);
    expect(supportPanel.hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /New support ticket/i }));
    await waitFor(() => expect(supportPanel.hidden).toBe(false));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Draft setup question' } });

    fireEvent.click(screen.getByRole('button', { name: 'Open account updates' }));
    expect(updatesPanel.hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open support tickets' }));
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Draft setup question');
  });

  it('opens the support view from a direct support hash', async () => {
    vi.stubGlobal('fetch', serviceFetch());
    window.history.replaceState(null, '', '/portal#support');
    renderServiceCenter();

    await waitFor(() => expect((document.getElementById('support') as HTMLElement).hidden).toBe(false));
    expect(screen.getByRole('button', { name: 'Open support tickets' }).getAttribute('aria-pressed')).toBe('true');
    expect((document.getElementById('notifications') as HTMLElement).hidden).toBe(true);
  });

  it('moves focus out of a hidden notification after opening its support destination', async () => {
    vi.stubGlobal('fetch', supportNotificationFetch());
    window.history.replaceState(null, '', '/portal');
    renderServiceCenter();

    expect(await screen.findByText('Orion replied to your ticket')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    const supportPanel = document.getElementById('support') as HTMLElement;
    await waitFor(() => expect(supportPanel.hidden).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(supportPanel));
    expect((document.getElementById('notifications') as HTMLElement).hidden).toBe(true);
  });

  it('passes notification-derived ticket IDs to support and synchronizes the shared unread count when the visible reply is read', async () => {
    const supportNotificationId = '650e8400-e29b-41d4-a716-446655440001';
    const paymentNotificationId = '650e8400-e29b-41d4-a716-446655440002';
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === '/api/notifications' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ updated: 1, unreadCount: 1 }));
      }
      if (input.startsWith('/api/notifications')) {
        return Promise.resolve(jsonResponse({
          notifications: [
            {
              id: supportNotificationId,
              kind: 'Support reply',
              title: 'Orion replied to your ticket',
              message: 'Open your secure support conversation.',
              href: `/portal?ticket=${linkedTicket.id}#support`,
              ticketId: linkedTicket.id,
              read_at: null,
              created_at: '2026-07-20T10:00:00Z',
            },
            {
              id: paymentNotificationId,
              kind: 'Payment',
              title: 'Payment received',
              message: 'Your payment is awaiting verification.',
              href: '/portal#payments',
              ticketId: null,
              read_at: null,
              created_at: '2026-07-20T09:00:00Z',
            },
          ],
          unreadCount: 2,
        }));
      }
      if (input.startsWith('/api/support-tickets')) {
        return Promise.resolve(jsonResponse({
          actor: { type: 'client', canManage: false },
          tickets: [linkedTicket],
          unreadReplyNotifications: {},
          pageInfo: { hasMore: false, nextCursor: null },
        }));
      }
      return Promise.resolve(jsonResponse({ error: 'Unexpected request' }, 500));
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', `/portal?ticket=${linkedTicket.id}#support`);

    renderServiceCenter();

    expect(await screen.findByRole('heading', { name: 'License will not activate' })).toBeTruthy();
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) => call[0] === '/api/notifications' && call[1]?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall?.[1].body)).toEqual({ ids: [supportNotificationId], read: true });
    });
    const summary = screen.getByLabelText('Client service summary');
    await waitFor(() => expect(within(summary).getByText('1')).toBeTruthy());
    expect(screen.getByLabelText('1 unread notifications')).toBeTruthy();
    expect(screen.getByRole('button', { name: /License.*License will not activate/i }).textContent).not.toContain('New reply');
  });
});

function renderServiceCenter() {
  return render(<PortalNotificationsProvider><ClientServiceCenter /></PortalNotificationsProvider>);
}

function serviceFetch() {
  return vi.fn().mockImplementation((input: string) => {
    if (input.startsWith('/api/notifications')) return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0 }));
    if (input.startsWith('/api/support-tickets')) return Promise.resolve(jsonResponse({ actor: { type: 'client', canManage: false }, tickets: [], unreadReplyNotifications: {}, pageInfo: { hasMore: false, nextCursor: null } }));
    return Promise.resolve(jsonResponse({ error: 'Unexpected request' }, 500));
  });
}

function supportNotificationFetch() {
  return vi.fn().mockImplementation((input: string, init?: RequestInit) => {
    if (input === '/api/notifications' && init?.method === 'PATCH') return Promise.resolve(jsonResponse({ updated: 1, unreadCount: 0 }));
    if (input.startsWith('/api/notifications')) return Promise.resolve(jsonResponse({
      notifications: [{ id: 'support-update', kind: 'Support reply', title: 'Orion replied to your ticket', message: 'Open your secure support conversation.', href: '/portal#support', read_at: null, created_at: '2026-07-20T10:00:00Z' }],
      unreadCount: 1,
    }));
    if (input.startsWith('/api/support-tickets')) return Promise.resolve(jsonResponse({ actor: { type: 'client', canManage: false }, tickets: [], unreadReplyNotifications: {}, pageInfo: { hasMore: false, nextCursor: null } }));
    return Promise.resolve(jsonResponse({ error: 'Unexpected request' }, 500));
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
