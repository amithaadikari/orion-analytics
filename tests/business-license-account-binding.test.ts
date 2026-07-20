import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAdminApi: vi.fn(), createSupabaseAdminClient: vi.fn(), generateLicenseKey: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/receipt-email', () => ({ sendPaymentReceipt: vi.fn() }));
vi.mock('@/lib/license-keys', async (load) => {
  const actual = await load<typeof import('@/lib/license-keys')>();
  return { ...actual, generateLicenseKey: mocks.generateLicenseKey };
});

import { POST } from '@/app/api/business/route';

const clientId = '11111111-1111-4111-8111-111111111111';

describe('generic license management cannot bypass trading-account binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-user' }, admin: { role: 'admin', email: 'owner@example.com' } });
    mocks.generateLicenseKey.mockReturnValue('ORN-ACDE-FGHJ-KLMN-PQRT');
  });

  it('rejects a directly supplied account number', async () => {
    const db = database(null);
    mocks.createSupabaseAdminClient.mockReturnValue(db.client);
    const response = await POST(request({ resource: 'license', data: { ...licenseData(), account_number: '99999999' } }));
    expect(response.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects membership changes through the generic client form', async () => {
    const db = database(null);
    mocks.createSupabaseAdminClient.mockReturnValue(db.client);
    const response = await POST(request({ resource: 'client', data: { full_name: 'Test Client', email: 'client@example.com', plan: 'Basic', status: 'Active', membership_tier: 'Pro' } }));
    expect(response.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });

  it('automatically binds a new matching-platform license to the active real account', async () => {
    const db = database({ id: 'account-1', account_number: '12345678' });
    mocks.createSupabaseAdminClient.mockReturnValue(db.client);
    const response = await POST(request({ resource: 'license', data: licenseData() }));
    expect(response.status).toBe(201);
    expect(db.inserts.find((entry) => entry.table === 'licenses')?.value).toMatchObject({ trading_account_id: 'account-1', account_number: '12345678' });
  });

  it('creates an unbound license when no verified account exists', async () => {
    const db = database(null);
    mocks.createSupabaseAdminClient.mockReturnValue(db.client);
    const response = await POST(request({ resource: 'license', data: licenseData() }));
    expect(response.status).toBe(201);
    expect(db.inserts.find((entry) => entry.table === 'licenses')?.value).toMatchObject({ trading_account_id: null, account_number: null });
  });
});

function licenseData() { return { client_id: clientId, platform: 'MT5', plan: 'Basic', status: 'Active', expires_at: null }; }
function request(body: Record<string, unknown>) { return new Request('https://admin.orionscalper.com/api/business', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

function database(account: { id: string; account_number: string } | null) {
  const inserts: { table: string; value: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not']) chain[method] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: table === 'client_trading_accounts' ? account : null, error: null });
      chain.insert = (value: Record<string, unknown>) => { inserts.push({ table, value }); return chain; };
      chain.single = () => Promise.resolve({ data: table === 'licenses' ? { id: 'license-1', ...inserts.find((entry) => entry.table === 'licenses')?.value } : null, error: null });
      return chain;
    },
  };
  return { client, inserts };
}
