// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClientServiceCenter from '@/components/client-service-center';

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
    render(<ClientServiceCenter />);

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
    render(<ClientServiceCenter />);

    await waitFor(() => expect((document.getElementById('support') as HTMLElement).hidden).toBe(false));
    expect(screen.getByRole('button', { name: 'Open support tickets' }).getAttribute('aria-pressed')).toBe('true');
    expect((document.getElementById('notifications') as HTMLElement).hidden).toBe(true);
  });

  it('moves focus out of a hidden notification after opening its support destination', async () => {
    vi.stubGlobal('fetch', supportNotificationFetch());
    window.history.replaceState(null, '', '/portal');
    render(<ClientServiceCenter />);

    expect(await screen.findByText('Orion replied to your ticket')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    const supportPanel = document.getElementById('support') as HTMLElement;
    await waitFor(() => expect(supportPanel.hidden).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(supportPanel));
    expect((document.getElementById('notifications') as HTMLElement).hidden).toBe(true);
  });
});

function serviceFetch() {
  return vi.fn().mockImplementation((input: string) => {
    if (input.startsWith('/api/notifications')) return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0 }));
    if (input.startsWith('/api/support-tickets')) return Promise.resolve(jsonResponse({ actor: { type: 'client', canManage: false }, tickets: [] }));
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
    if (input.startsWith('/api/support-tickets')) return Promise.resolve(jsonResponse({ actor: { type: 'client', canManage: false }, tickets: [] }));
    return Promise.resolve(jsonResponse({ error: 'Unexpected request' }, 500));
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
