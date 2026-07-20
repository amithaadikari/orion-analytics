// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SupportTicketCenter from '@/components/support-ticket-center';

const waitingTicket = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  subject: 'License will not activate',
  category: 'License',
  priority: 'High',
  status: 'Waiting on client',
  createdAt: '2026-07-19T08:00:00Z',
  updatedAt: '2026-07-20T10:00:00Z',
  closedAt: null,
  messages: [
    { id: 'message-client', authorType: 'Client', body: 'The license says invalid.', createdAt: '2026-07-19T08:00:00Z' },
    { id: 'message-admin', authorType: 'Admin', body: 'Please confirm your MT5 account number.', createdAt: '2026-07-20T10:00:00Z' },
  ],
};

const resolvedTicket = {
  ...waitingTicket,
  id: '550e8400-e29b-41d4-a716-446655440002',
  subject: 'Resolved setup question',
  status: 'Resolved',
  priority: 'Normal',
  updatedAt: '2026-07-18T10:00:00Z',
};

const openTicket = {
  ...waitingTicket,
  id: '550e8400-e29b-41d4-a716-446655440003',
  subject: 'New payment question',
  category: 'Payment',
  status: 'Open',
  updatedAt: '2026-07-17T10:00:00Z',
};

const closedTicket = {
  ...waitingTicket,
  id: '550e8400-e29b-41d4-a716-446655440004',
  subject: 'Closed billing question',
  category: 'Payment',
  status: 'Closed',
  priority: 'Normal',
  updatedAt: '2026-07-16T10:00:00Z',
  closedAt: '2026-07-16T10:00:00Z',
};

const olderOpenTicket = {
  ...waitingTicket,
  id: '550e8400-e29b-41d4-a716-446655440005',
  subject: 'Older technical ticket',
  category: 'Technical',
  status: 'In progress',
  priority: 'Normal',
  updatedAt: '2026-07-15T10:00:00Z',
};

const clientActor = { type: 'client' as const, canManage: false };
const clientPayload = ticketPayload([waitingTicket, resolvedTicket]);
type TestTicket = Omit<typeof waitingTicket, 'closedAt'> & { closedAt: string | null };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Support Ticket Center', () => {
  it('forces the client-portal scope, reports active tickets, and uses client-friendly statuses', async () => {
    const summary = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(clientPayload));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportTicketCenter portalEmbedded onSummaryChange={summary} />);

    expect(await screen.findByRole('heading', { name: 'License will not activate' })).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/support-tickets?scope=self&limit=12');
    expect(screen.getAllByText('Your reply needed').length).toBeGreaterThan(0);
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ activeCount: 1, totalCount: 2, loaded: true }));

    fireEvent.click(screen.getByRole('button', { name: /Resolved 1/i }));
    expect(await screen.findByRole('heading', { name: 'Resolved setup question' })).toBeTruthy();
    expect(screen.queryByText('License will not activate')).toBeNull();
  });

  it.each([
    { target: resolvedTicket, filterName: /Resolved 1/i },
    { target: closedTicket, filterName: /Closed 1/i },
  ])('restores a directly linked older $target.status ticket and selects its matching filter', async ({ target, filterName }) => {
    window.history.replaceState(null, '', `/portal?ticket=${target.id}#support`);
    const firstPage = ticketPayload([waitingTicket, openTicket], {
      hasMore: true,
      nextCursor: 'first-page-cursor',
    });
    const exactPage = ticketPayload([target]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(exactPage));
    vi.stubGlobal('fetch', fetchMock);

    render(<SupportTicketCenter portalEmbedded />);

    expect(await screen.findByRole('heading', { name: target.subject })).toBeTruthy();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/support-tickets?scope=self&limit=12',
      `/api/support-tickets?scope=self&limit=12&ticketId=${target.id}`,
    ]);
    expect(screen.getByRole('button', { name: filterName }).getAttribute('aria-pressed')).toBe('true');
    expect(window.location.pathname).toBe('/portal');
    expect(window.location.search).toBe(`?ticket=${target.id}`);
    expect(window.location.hash).toBe('#support');
  });

  it('stores the selected ticket in the portal address for refresh-safe navigation', async () => {
    window.history.replaceState(null, '', '/portal#support');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ticketPayload([waitingTicket, openTicket]))));
    render(<SupportTicketCenter portalEmbedded />);

    await screen.findByRole('heading', { name: 'License will not activate' });
    fireEvent.click(screen.getByRole('button', { name: /Payment.*New payment question/i }));

    expect(await screen.findByRole('heading', { name: 'New payment question' })).toBeTruthy();
    expect(window.location.pathname).toBe('/portal');
    expect(window.location.search).toBe(`?ticket=${openTicket.id}`);
    expect(window.location.hash).toBe('#support');
  });

  it('appends and de-duplicates older tickets without replacing the selected thread or address', async () => {
    const cursor = 'next/page=2';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ticketPayload([waitingTicket, openTicket], { hasMore: true, nextCursor: cursor })))
      .mockResolvedValueOnce(jsonResponse(ticketPayload([openTicket, olderOpenTicket])));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/portal#support');
    render(<SupportTicketCenter portalEmbedded />);

    await screen.findByRole('heading', { name: 'License will not activate' });
    fireEvent.click(screen.getByRole('button', { name: /Payment.*New payment question/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Load older tickets' }));

    expect(await screen.findByRole('button', { name: /Technical.*Older technical ticket/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'New payment question' })).toBeTruthy();
    expect(window.location.search).toBe(`?ticket=${openTicket.id}`);
    expect(window.location.hash).toBe('#support');
    const ticketList = screen.getByRole('navigation', { name: 'Support tickets' });
    expect(within(ticketList).getAllByRole('button')).toHaveLength(3);
    expect(within(ticketList).getAllByRole('button', { name: /New payment question/i })).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/support-tickets?scope=self&limit=12&cursor=next%2Fpage%3D2');
  });

  it('keeps unread replies untouched while the support workspace is hidden', async () => {
    const markRead = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ticketPayload(
      [waitingTicket],
      undefined,
      { [waitingTicket.id]: ['reply-notification-one'] },
    ))));

    render(<SupportTicketCenter portalEmbedded active={false} onReadNotifications={markRead} />);

    await screen.findByRole('heading', { name: 'License will not activate' });
    expect(screen.getByText('New reply')).toBeTruthy();
    await act(async () => Promise.resolve());
    expect(markRead).not.toHaveBeenCalled();
  });

  it('marks only the selected desktop ticket notification IDs and clears its new-reply badge after success', async () => {
    const readResult = deferred<boolean>();
    const markRead = vi.fn().mockReturnValue(readResult.promise);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ticketPayload(
      [waitingTicket, openTicket],
      undefined,
      {
        [waitingTicket.id]: ['reply-notification-one', 'reply-notification-two', 'reply-notification-one'],
        [openTicket.id]: ['other-ticket-notification'],
      },
    ))));

    render(<SupportTicketCenter portalEmbedded active onReadNotifications={markRead} />);

    expect(await screen.findAllByText('New reply')).toHaveLength(2);
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(['reply-notification-one', 'reply-notification-two']));
    expect(markRead).toHaveBeenCalledTimes(1);
    await act(async () => readResult.resolve(true));
    await waitFor(() => expect(screen.getAllByText('New reply')).toHaveLength(1));
    expect(screen.getByRole('button', { name: /License.*License will not activate/i }).textContent).not.toContain('New reply');
    expect(screen.getByRole('button', { name: /Payment.*New payment question/i }).textContent).toContain('New reply');
  });

  it('creates a secure ticket from the inline drawer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ticketPayload([])))
      .mockResolvedValueOnce(jsonResponse({ ticketId: waitingTicket.id }, 201))
      .mockResolvedValueOnce(jsonResponse(ticketPayload([waitingTicket])));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportTicketCenter portalEmbedded />);

    fireEvent.click(await screen.findByRole('button', { name: /Create your first ticket/i }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'MT5 setup help' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Setup' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'I need help attaching the EA to my chart.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send secure ticket/i }));

    expect(await screen.findByText('Your ticket was sent securely to Orion support.')).toBeTruthy();
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(postCall?.[0]).toBe('/api/support-tickets?scope=self');
    expect(JSON.parse(postCall?.[1].body)).toEqual({ subject: 'MT5 setup help', category: 'Setup', priority: 'High', message: 'I need help attaching the EA to my chart.' });
  });

  it('distinguishes an unavailable ticket history from an empty account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Support tickets are temporarily unavailable' }, 500))
      .mockResolvedValueOnce(jsonResponse(ticketPayload([])));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportTicketCenter portalEmbedded />);

    expect(await screen.findByText('Support tickets are temporarily unavailable')).toBeTruthy();
    expect(screen.queryByText('No support tickets yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No support tickets yet')).toBeTruthy();
  });

  it('sends a client reply without flashing the entire workspace away', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ticketPayload([waitingTicket])))
      .mockResolvedValueOnce(jsonResponse({ ok: true, ticketId: waitingTicket.id, status: 'Open', priority: 'High' }))
      .mockResolvedValueOnce(jsonResponse(ticketPayload([{ ...waitingTicket, status: 'Open' }])));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportTicketCenter portalEmbedded />);

    const reply = await screen.findByLabelText('Reply to this ticket');
    fireEvent.change(reply, { target: { value: 'My account number is 20401988.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send reply/i }));

    expect(await screen.findByText('Reply sent securely.', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'License will not activate' })).toBeTruthy();
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH');
    expect(patchCall?.[0]).toBe('/api/support-tickets?scope=self');
    expect(JSON.parse(patchCall?.[1].body)).toEqual({ ticketId: waitingTicket.id, message: 'My account number is 20401988.' });
  });

  it('preserves the administrator management surface outside the client portal', async () => {
    const adminPayload = { actor: { type: 'admin', canManage: true }, tickets: [{ ...waitingTicket, client: { fullName: 'A. Client', email: 'client@example.com' } }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(adminPayload));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportTicketCenter embedded />);

    expect(await screen.findByText('A. Client')).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/support-tickets');
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByLabelText('Priority')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeTruthy();
    expect(screen.getByText('Client')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New ticket/i })).toBeNull();
  });

  it('prioritizes tickets awaiting Orion above tickets awaiting the client in the administrator desk', async () => {
    const tickets = [waitingTicket, openTicket].map((ticket) => ({ ...ticket, client: { fullName: 'A. Client', email: 'client@example.com' } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ actor: { type: 'admin', canManage: true }, tickets })));
    render(<SupportTicketCenter embedded />);

    expect(await screen.findByRole('heading', { name: 'New payment question' })).toBeTruthy();
    const ticketButtons = within(screen.getByRole('navigation', { name: 'Support tickets' })).getAllByRole('button');
    expect(ticketButtons[0].textContent).toContain('New payment question');
    expect(ticketButtons[1].textContent).toContain('License will not activate');
  });

  it('does not expose client creation controls when the administrator queue fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Support tickets are temporarily unavailable' }, 500)));
    render(<SupportTicketCenter embedded />);

    expect(await screen.findByText('Support tickets are temporarily unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New ticket/i })).toBeNull();
    expect(screen.queryByLabelText('Subject')).toBeNull();
  });

  it('moves and restores focus when a mobile client opens a conversation', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ticketPayload([waitingTicket]))));
    render(<SupportTicketCenter portalEmbedded />);

    await screen.findByRole('heading', { name: 'License will not activate' });
    const ticketButton = screen.getByRole('button', { name: /License.*License will not activate/i });
    fireEvent.click(ticketButton);
    const backButton = screen.getByRole('button', { name: 'Back to tickets' });
    await waitFor(() => expect(document.activeElement).toBe(backButton));

    fireEvent.click(backButton);
    await waitFor(() => expect(document.activeElement).toBe(ticketButton));
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function ticketPayload(
  tickets: TestTicket[],
  pageInfo = { hasMore: false, nextCursor: null as string | null },
  unreadReplyNotifications: Record<string, string[]> = {},
) {
  return { actor: clientActor, tickets, unreadReplyNotifications, pageInfo };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}
