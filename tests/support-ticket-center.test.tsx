// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const clientPayload = { actor: { type: 'client', canManage: false }, tickets: [waitingTicket, resolvedTicket] };

afterEach(() => {
  cleanup();
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
    expect(fetchMock.mock.calls[0][0]).toBe('/api/support-tickets?scope=self');
    expect(screen.getAllByText('Your reply needed').length).toBeGreaterThan(0);
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ activeCount: 1, totalCount: 2, loaded: true }));

    fireEvent.click(screen.getByRole('button', { name: /Resolved 1/i }));
    expect(await screen.findByRole('heading', { name: 'Resolved setup question' })).toBeTruthy();
    expect(screen.queryByText('License will not activate')).toBeNull();
  });

  it('creates a secure ticket from the inline drawer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ actor: clientPayload.actor, tickets: [] }))
      .mockResolvedValueOnce(jsonResponse({ ticketId: waitingTicket.id }, 201))
      .mockResolvedValueOnce(jsonResponse({ actor: clientPayload.actor, tickets: [waitingTicket] }));
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
      .mockResolvedValueOnce(jsonResponse({ actor: clientPayload.actor, tickets: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportTicketCenter portalEmbedded />);

    expect(await screen.findByText('Support tickets are temporarily unavailable')).toBeTruthy();
    expect(screen.queryByText('No support tickets yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No support tickets yet')).toBeTruthy();
  });

  it('sends a client reply without flashing the entire workspace away', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ actor: clientPayload.actor, tickets: [waitingTicket] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, ticketId: waitingTicket.id, status: 'Open', priority: 'High' }))
      .mockResolvedValueOnce(jsonResponse({ actor: clientPayload.actor, tickets: [{ ...waitingTicket, status: 'Open' }] }));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ actor: clientPayload.actor, tickets: [waitingTicket] })));
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
