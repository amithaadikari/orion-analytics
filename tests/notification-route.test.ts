import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));

import { GET, PATCH } from '@/app/api/notifications/route';

const clientId = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const notificationId = '33333333-3333-4333-8333-333333333333';
const secondNotificationId = '44444444-4444-4444-8444-444444444444';

describe('notification API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'user-1', email: 'client@example.com' },
      client: { id: clientId },
      admin: null,
    });
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  });

  it('maps ticket links and removes unsafe notification destinations', async () => {
    const trace: QueryTrace[] = [];
    mocks.createSupabaseAdminClient.mockReturnValue(notificationDatabase({
      mode: 'get',
      trace,
      rows: [
        notificationRow(notificationId, `/portal?ticket=${ticketId}#support`, ticketId),
        notificationRow(secondNotificationId, 'https://evil.example/steal', null),
      ],
      unreadCount: 2,
    }));

    const response = await GET(new Request('https://app.orionscalper.com/api/notifications?limit=5'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      notifications: [
        expect.objectContaining({
          id: notificationId,
          ticketId,
          href: `/portal?ticket=${ticketId}#support`,
        }),
        expect.objectContaining({
          id: secondNotificationId,
          ticketId: null,
          href: null,
        }),
      ],
      unreadCount: 2,
    });
    expect(trace.filter((entry) => entry.method === 'eq' && entry.args[0] === 'client_id'))
      .toHaveLength(2);
    expect(trace.filter((entry) => entry.method === 'eq' && entry.args[0] === 'client_id'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ args: ['client_id', clientId] }),
      ]));
  });

  it('marks only the bounded id set inside the authenticated client scope', async () => {
    const trace: QueryTrace[] = [];
    mocks.createSupabaseAdminClient.mockReturnValue(notificationDatabase({
      mode: 'patch',
      trace,
      updatedRows: [
        { id: notificationId, read_at: '2026-07-20T12:00:00.000Z' },
        { id: secondNotificationId, read_at: '2026-07-20T12:00:00.000Z' },
      ],
      unreadCount: 3,
    }));

    const response = await PATCH(jsonRequest({
      ids: [notificationId, secondNotificationId, notificationId],
      read: true,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ updated: 2, unreadCount: 3 });
    const updateQuery = trace.filter((entry) => entry.query === 0);
    expect(updateQuery).toContainEqual(expect.objectContaining({
      method: 'eq',
      args: ['client_id', clientId],
    }));
    expect(updateQuery).toContainEqual(expect.objectContaining({
      method: 'in',
      args: ['id', [notificationId, secondNotificationId]],
    }));
    const clientScopeIndex = updateQuery.findIndex((entry) => entry.method === 'eq' && entry.args[0] === 'client_id');
    const idSelectorIndex = updateQuery.findIndex((entry) => entry.method === 'in' && entry.args[0] === 'id');
    expect(clientScopeIndex).toBeGreaterThanOrEqual(0);
    expect(clientScopeIndex).toBeLessThan(idSelectorIndex);
    const update = updateQuery.find((entry) => entry.method === 'update');
    expect(update?.args[0]).toEqual({ read_at: expect.any(String) });
    expect(Number.isNaN(Date.parse((update?.args[0] as { read_at: string }).read_at))).toBe(false);
  });

  it('rejects more than one hundred notification ids before accessing the database', async () => {
    const ids = Array.from({ length: 101 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    const response = await PATCH(jsonRequest({ ids }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('rejects ambiguous notification selectors before accessing the database', async () => {
    const response = await PATCH(jsonRequest({ ids: [notificationId], all: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Use only one notification selector at a time.' });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

type QueryTrace = {
  query: number;
  method: string;
  args: unknown[];
};

type NotificationDatabaseOptions = {
  mode: 'get' | 'patch';
  trace: QueryTrace[];
  rows?: Record<string, unknown>[];
  updatedRows?: Record<string, unknown>[];
  unreadCount: number;
};

function notificationRow(id: string, href: string, linkedTicketId: string | null) {
  return {
    id,
    ticket_id: linkedTicketId,
    kind: 'Support',
    title: 'Support replied',
    message: 'A new reply is waiting in your ticket.',
    href,
    read_at: null,
    created_at: '2026-07-20T12:00:00.000Z',
  };
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request('https://app.orionscalper.com/api/notifications', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function notificationDatabase(options: NotificationDatabaseOptions) {
  let query = 0;
  return {
    from() {
      const currentQuery = query++;
      const result = currentQuery === 0
        ? options.mode === 'get'
          ? { data: options.rows ?? [], error: null }
          : { data: options.updatedRows ?? [], error: null }
        : { data: null, count: options.unreadCount, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'is', 'not', 'update', 'in']) {
        builder[method] = (...args: unknown[]) => {
          options.trace.push({ query: currentQuery, method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}
