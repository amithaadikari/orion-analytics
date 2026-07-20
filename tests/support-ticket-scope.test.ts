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

function database(eqCalls: Array<[string, string, string]>) {
  return {
    from(table: string) {
      const result = table === 'support_tickets'
        ? { data: [{ id: 'ticket-1', client_id: 'client-self', subject: 'Help', category: 'Setup', priority: 'Normal', status: 'Open', created_at: '2026-07-20T08:00:00Z', updated_at: '2026-07-20T09:00:00Z', closed_at: null, clients: { full_name: 'Portal Client', email: 'client@example.com' } }], error: null }
        : { data: [{ id: 'message-1', ticket_id: 'ticket-1', client_id: 'client-self', author_type: 'Client', body: 'Please help', created_at: '2026-07-20T08:00:00Z' }], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'limit', 'in']) builder[method] = () => builder;
      builder.eq = (field: string, value: string) => { eqCalls.push([table, field, value]); return builder; };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}
