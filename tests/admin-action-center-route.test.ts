import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

import { GET } from '@/app/api/action-center/route';

describe('administrator action-center header API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({
      user: { id: 'admin-user-1' },
      admin: { id: 'admin-1', role: 'admin' },
    });
  });

  it('returns only exact operational totals for the header view', async () => {
    const selections: Selection[] = [];
    mocks.createSupabaseAdminClient.mockReturnValue(countDatabase(selections));

    const response = await GET(actionCenterRequest('?view=header'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(payload.counts).toEqual({
      registrations: 3,
      payments: 3,
      licenses: 5,
      suspended: 4,
      support: 6,
      total: 21,
    });
    expect(payload.generatedAt).toEqual(expect.any(String));
    expect(Object.keys(payload).sort()).toEqual(['counts', 'generatedAt']);
    expect(selections).toHaveLength(6);
    expect(selections.every((selection) => selection.options?.head === true)).toBe(true);
    expect(selections.every((selection) => selection.columns === 'id')).toBe(true);
  });

  it('keeps an unavailable queue distinct from an all-clear response', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(countDatabase([], 'support_tickets'));

    const response = await GET(actionCenterRequest('?view=header'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(payload).toEqual({ error: 'Unable to load the action center' });
    expect(payload.counts).toBeUndefined();
  });

  it('rejects unknown views and non-administrator sessions', async () => {
    const invalidView = await GET(actionCenterRequest('?view=client-details'));
    expect(invalidView.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();

    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'analyst-user' }, admin: { role: 'analyst' } });
    const forbidden = await GET(actionCenterRequest('?view=header'));
    expect(forbidden.status).toBe(403);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

type Selection = {
  table: string;
  columns: string;
  options?: { count?: string; head?: boolean };
  filters: Array<[string, string, unknown]>;
};

function actionCenterRequest(search = '') {
  return new Request(`https://admin.orionscalper.com/api/action-center${search}`);
}

function countDatabase(selections: Selection[], errorTable?: string) {
  return {
    from(table: string) {
      return queryBuilder(table, selections, errorTable);
    },
  };
}

function queryBuilder(table: string, selections: Selection[], errorTable?: string) {
  const selection: Selection = { table, columns: '', filters: [] };
  const chain: Record<string, unknown> = {};
  chain.select = (columns: string, options?: Selection['options']) => {
    selection.columns = columns;
    selection.options = options;
    selections.push(selection);
    return chain;
  };
  for (const method of ['eq', 'is', 'not', 'neq', 'gte', 'lte', 'in']) {
    chain[method] = (column: string, value: unknown, extra?: unknown) => {
      selection.filters.push([method, column, extra === undefined ? value : [value, extra]]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
    try {
      return Promise.resolve(resolve({
        data: null,
        count: countFor(selection),
        error: table === errorTable ? { message: 'Database unavailable' } : null,
      }));
    } catch (error) {
      return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
    }
  };
  return chain;
}

function countFor(selection: Selection) {
  const has = (method: string, column: string, value?: unknown) => selection.filters.some((filter) => filter[0] === method && filter[1] === column && (value === undefined || filter[2] === value));
  if (selection.table === 'client_payments') return 3;
  if (selection.table === 'licenses') return 5;
  if (selection.table === 'support_tickets') return 6;
  if (has('eq', 'status', 'Pending')) return 2;
  if (has('eq', 'plan', 'Free')) return 1;
  if (has('eq', 'status', 'Suspended')) return 4;
  return 0;
}
