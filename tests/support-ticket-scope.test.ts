import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));

import { GET, PATCH, POST } from '@/app/api/support-tickets/route';

const ticketId = '11111111-1111-4111-8111-111111111111';
const otherClientId = '22222222-2222-4222-8222-222222222222';
const olderTicketId = '33333333-3333-4333-8333-333333333333';
const oldestTicketId = '44444444-4444-4444-8444-444444444444';

describe('support ticket portal scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  });

  it('forces a dual admin/client identity into its own client queue in portal scope', async () => {
    const eqCalls: Array<[string, string, string]> = [];
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@example.com' },
      admin: { id: 'admin-1', role: 'admin', email: 'owner@example.com' },
      client: { id: 'client-self' },
    });
    mocks.createSupabaseAdminClient.mockReturnValue(database(eqCalls));

    const response = await GET(new Request('https://app.orionscalper.com/api/support-tickets?scope=self'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.actor).toEqual({ type: 'client', canManage: false });
    expect(eqCalls).toContainEqual(['support_tickets', 'client_id', 'client-self']);
    expect(eqCalls).toContainEqual(['support_ticket_messages', 'client_id', 'client-self']);
    expect(payload.tickets[0].client).toBeUndefined();
  });

  it('preserves the administrator queue when portal self scope is absent', async () => {
    const eqCalls: Array<[string, string, string]> = [];
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@example.com' },
      admin: { id: 'admin-1', role: 'admin', email: 'owner@example.com' },
      client: { id: 'client-self' },
    });
    mocks.createSupabaseAdminClient.mockReturnValue(database(eqCalls));

    const response = await GET(new Request('https://admin.orionscalper.com/api/support-tickets'));
    const payload = await response.json();

    expect(payload.actor).toEqual({ type: 'admin', canManage: true });
    expect(eqCalls.filter((call) => call[1] === 'client_id')).toEqual([]);
    expect(payload.tickets[0].client).toEqual({ fullName: 'Portal Client', email: 'client@example.com' });
  });

  it('rejects a malformed history cursor before creating a database client', async () => {
    mocks.getPortalSession.mockResolvedValue(dualSession());

    const response = await GET(new Request('https://app.orionscalper.com/api/support-tickets?scope=self&cursor=not-a-cursor'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid support-ticket cursor' });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('uses a deterministic updated-at and id cursor after enforcing portal ownership', async () => {
    const eqCalls: Array<[string, string, string]> = [];
    const trace: QueryTrace[] = [];
    const cursorUpdatedAt = '2026-07-20T09:00:00.000Z';
    const cursor = Buffer.from(JSON.stringify({ updatedAt: cursorUpdatedAt, id: olderTicketId }), 'utf8').toString('base64url');
    mocks.getPortalSession.mockResolvedValue(dualSession());
    mocks.createSupabaseAdminClient.mockReturnValue(database(eqCalls, {
      trace,
      tickets: [ticketRow(oldestTicketId, '2026-07-19T09:00:00.000Z')],
    }));

    const response = await GET(new Request(`https://app.orionscalper.com/api/support-tickets?scope=self&limit=2&cursor=${cursor}`));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    expect(trace).toContainEqual({ table: 'support_tickets', method: 'order', args: ['updated_at', { ascending: false }] });
    expect(trace).toContainEqual({ table: 'support_tickets', method: 'order', args: ['id', { ascending: false }] });
    expect(trace).toContainEqual({ table: 'support_tickets', method: 'limit', args: [3] });
    expect(trace).toContainEqual({
      table: 'support_tickets',
      method: 'or',
      args: [`updated_at.lt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.lt.${olderTicketId})`],
    });
    const ticketTrace = trace.filter((entry) => entry.table === 'support_tickets');
    expect(ticketTrace.findIndex((entry) => entry.method === 'eq' && entry.args[0] === 'client_id'))
      .toBeLessThan(ticketTrace.findIndex((entry) => entry.method === 'or'));
  });

  it('returns a stable next cursor and limits related data to the visible ticket page', async () => {
    const eqCalls: Array<[string, string, string]> = [];
    const trace: QueryTrace[] = [];
    const sharedUpdatedAt = '2026-07-20T09:00:00.000Z';
    mocks.getPortalSession.mockResolvedValue(dualSession());
    mocks.createSupabaseAdminClient.mockReturnValue(database(eqCalls, {
      trace,
      tickets: [
        ticketRow(ticketId, sharedUpdatedAt),
        ticketRow(olderTicketId, sharedUpdatedAt),
        ticketRow(oldestTicketId, '2026-07-19T09:00:00.000Z'),
      ],
      notifications: [{ id: 'notification-1', ticket_id: olderTicketId }],
    }));

    const response = await GET(new Request('https://app.orionscalper.com/api/support-tickets?scope=self&limit=2'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tickets.map((ticket: { id: string }) => ticket.id)).toEqual([ticketId, olderTicketId]);
    expect(payload.unreadReplyNotifications).toEqual({ [olderTicketId]: ['notification-1'] });
    expect(payload.pageInfo.hasMore).toBe(true);
    expect(JSON.parse(Buffer.from(payload.pageInfo.nextCursor, 'base64url').toString('utf8'))).toEqual({
      updatedAt: sharedUpdatedAt,
      id: olderTicketId,
    });
    expect(trace).toContainEqual({
      table: 'support_ticket_messages',
      method: 'in',
      args: ['ticket_id', [ticketId, olderTicketId]],
    });
  });

  it('keeps an exact ticket lookup inside the authenticated client scope', async () => {
    const eqCalls: Array<[string, string, string]> = [];
    mocks.getPortalSession.mockResolvedValue(dualSession());
    mocks.createSupabaseAdminClient.mockReturnValue(database(eqCalls, { tickets: [] }));

    const response = await GET(new Request(`https://app.orionscalper.com/api/support-tickets?scope=self&ticketId=${otherClientId}`));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tickets).toEqual([]);
    expect(eqCalls).toContainEqual(['support_tickets', 'client_id', 'client-self']);
    expect(eqCalls).toContainEqual(['support_tickets', 'id', otherClientId]);
  });

  it('creates a self-scoped ticket as the linked client for a dual identity', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ticketId, error: null });
    mocks.getPortalSession.mockResolvedValue(dualSession());
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });

    const response = await POST(jsonRequest('POST', {
      subject: 'Setup assistance',
      category: 'Setup',
      priority: 'Normal',
      message: 'Please help with installation.',
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ticketId });
    expect(rpc).toHaveBeenCalledWith('create_support_ticket_atomic', expect.objectContaining({
      p_client_id: 'client-self',
      p_author_type: 'Client',
      p_author_email: 'owner@example.com',
    }));
  });

  it('rejects a self-scoped attempt to create a ticket for another client', async () => {
    mocks.getPortalSession.mockResolvedValue(dualSession());

    const response = await POST(jsonRequest('POST', {
      clientId: otherClientId,
      subject: 'Setup assistance',
      category: 'Setup',
      priority: 'Normal',
      message: 'Please help with installation.',
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Clients cannot create tickets for another account' });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('updates an owned ticket as the linked client for a dual identity', async () => {
    const eqCalls: Array<[string, string]> = [];
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mocks.getPortalSession.mockResolvedValue(dualSession());
    mocks.createSupabaseAdminClient.mockReturnValue(patchDatabase(eqCalls, rpc, ownedTicket()));

    const response = await PATCH(jsonRequest('PATCH', {
      ticketId,
      message: 'Here are the requested setup details.',
    }));

    expect(response.status).toBe(200);
    expect(eqCalls).toContainEqual(['client_id', 'client-self']);
    expect(rpc).toHaveBeenCalledWith('update_support_ticket_atomic', expect.objectContaining({
      p_ticket_id: ticketId,
      p_client_id: 'client-self',
      p_author_type: 'Client',
      p_author_email: 'owner@example.com',
      p_status: 'Open',
      p_priority: 'Normal',
    }));
  });

  it.each([
    ['priority', { priority: 'Urgent' }, 'Ticket priority can be changed only by Orion support'],
    ['internal status', { status: 'In progress' }, 'Clients may close a ticket, but cannot set internal support states'],
  ])('rejects a self-scoped client %s update', async (_label, update, expectedError) => {
    mocks.getPortalSession.mockResolvedValue(dualSession());

    const response = await PATCH(jsonRequest('PATCH', { ticketId, ...update }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: expectedError });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('returns not found when a self-scoped client tries to update an unowned ticket', async () => {
    const eqCalls: Array<[string, string]> = [];
    const rpc = vi.fn();
    mocks.getPortalSession.mockResolvedValue(dualSession());
    mocks.createSupabaseAdminClient.mockReturnValue(patchDatabase(eqCalls, rpc, null));

    const response = await PATCH(jsonRequest('PATCH', {
      ticketId,
      message: 'Attempt to reply to an unowned ticket.',
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Support ticket not found' });
    expect(eqCalls).toContainEqual(['client_id', 'client-self']);
    expect(rpc).not.toHaveBeenCalled();
  });
});

function dualSession() {
  return {
    user: { id: 'user-1', email: 'owner@example.com' },
    admin: { id: 'admin-1', role: 'admin', email: 'admin@example.com' },
    client: { id: 'client-self' },
  };
}

function jsonRequest(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  return new Request(`https://app.orionscalper.com/api/support-tickets?scope=self`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ownedTicket() {
  return {
    id: ticketId,
    client_id: 'client-self',
    subject: 'Setup assistance',
    status: 'Open',
    priority: 'Normal',
  };
}

function patchDatabase(eqCalls: Array<[string, string]>, rpc: ReturnType<typeof vi.fn>, ticket: ReturnType<typeof ownedTicket> | null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: ticket, error: null }),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockImplementation((field: string, value: string) => {
    eqCalls.push([field, value]);
    return builder;
  });
  return {
    from: vi.fn().mockReturnValue(builder),
    rpc,
  };
}

type QueryTrace = { table: string; method: string; args: unknown[] };

type DatabaseOptions = {
  trace?: QueryTrace[];
  tickets?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
  notifications?: Record<string, unknown>[];
};

function ticketRow(id = ticketId, updatedAt = '2026-07-20T09:00:00.000Z') {
  return {
    id,
    client_id: 'client-self',
    subject: 'Help',
    category: 'Setup',
    priority: 'Normal',
    status: 'Open',
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: updatedAt,
    closed_at: null,
    clients: { full_name: 'Portal Client', email: 'client@example.com' },
  };
}

function database(eqCalls: Array<[string, string, string]>, options: DatabaseOptions = {}) {
  return {
    from(table: string) {
      const result = table === 'support_tickets'
        ? { data: options.tickets ?? [ticketRow()], error: null }
        : table === 'support_ticket_messages'
          ? { data: options.messages ?? [{ id: 'message-1', ticket_id: ticketId, client_id: 'client-self', author_type: 'Client', body: 'Please help', created_at: '2026-07-20T08:00:00.000Z' }], error: null }
          : { data: options.notifications ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'limit', 'in', 'is', 'not', 'or']) {
        builder[method] = (...args: unknown[]) => {
          options.trace?.push({ table, method, args });
          return builder;
        };
      }
      builder.eq = (field: string, value: string) => {
        eqCalls.push([table, field, value]);
        options.trace?.push({ table, method: 'eq', args: [field, value] });
        return builder;
      };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}
