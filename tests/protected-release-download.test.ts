import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  rateLimit: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/portal-session', () => ({ getPortalSession: mocks.getPortalSession }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/download-security', () => ({ approvedProductDownloadUrl: vi.fn(() => null) }));
vi.mock('@/lib/release-server', () => ({ isMissingReleaseStorageSchema: vi.fn(() => false) }));

import { GET } from '@/app/api/downloads/[releaseId]/route';
import { releaseBucket } from '@/lib/release-files';

const releaseId = '11111111-1111-4111-8111-111111111111';
const uploadId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const storagePath = `releases/${releaseId}/${uploadId}.ex5`;
const bytes = new Uint8Array([0x4f, 0x52, 0x49, 0x4f, 0x4e]);

describe('protected private release delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalSession.mockResolvedValue({
      user: { id: 'portal-user' },
      client: { id: clientId, plan: 'Basic', status: 'Active' },
      mfaRequired: false,
    });
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  });

  it('delivers only the current private channel package and records the scoped request', async () => {
    const context = databaseContext();
    mocks.createSupabaseAdminClient.mockReturnValue(context.db);

    const response = await GET(downloadRequest(), routeContext());
    const delivered = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect([...delivered]).toEqual([...bytes]);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="Orion-Gold-Scalper.ex5"');
    expect([...response.headers.values()].join(' ')).not.toContain(storagePath);
    expect(context.storageFrom).toHaveBeenCalledWith(releaseBucket);
    expect(context.storageDownload).toHaveBeenCalledWith(storagePath, {}, { cache: 'no-store' });
    expect(context.insertDownload).toHaveBeenCalledWith(expect.objectContaining({
      client_id: clientId,
      release_id: releaseId,
      version: '6.0',
      platform: 'MT5',
    }));
  });

  it('refuses a published build that is no longer assigned to the licensed platform channel', async () => {
    const context = databaseContext({ channels: [] });
    mocks.createSupabaseAdminClient.mockReturnValue(context.db);

    const response = await GET(downloadRequest(), routeContext());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('newer Orion release');
    expect(JSON.stringify(payload)).not.toContain(storagePath);
    expect(context.storageDownload).not.toHaveBeenCalled();
    expect(context.insertDownload).not.toHaveBeenCalled();
  });

  it('rejects a private object path that belongs to another release without disclosing it', async () => {
    const otherReleaseId = '44444444-4444-4444-8444-444444444444';
    const unsafePath = `releases/${otherReleaseId}/${uploadId}.ex5`;
    const context = databaseContext({ release: { ...releaseRow(), storage_path: unsafePath } });
    mocks.createSupabaseAdminClient.mockReturnValue(context.db);

    const response = await GET(downloadRequest(), routeContext());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('This release does not have a verified private package');
    expect(JSON.stringify(payload)).not.toContain(unsafePath);
    expect(context.storageDownload).not.toHaveBeenCalled();
    expect(context.insertDownload).not.toHaveBeenCalled();
  });
});

function releaseRow() {
  return {
    id: releaseId,
    version: '6.0',
    title: 'Orion Gold Scalper',
    platform: 'MT5' as const,
    download_url: null,
    published: true,
    asset_status: 'ready',
    storage_bucket: releaseBucket,
    storage_path: storagePath,
    original_filename: 'Orion Gold Scalper.ex5',
    file_size_bytes: bytes.byteLength,
    sha256: 'a'.repeat(64),
    content_type: 'application/octet-stream',
    published_at: '2026-07-20T12:00:00.000Z',
    archived_at: null,
  };
}

function databaseContext(options: { release?: ReturnType<typeof releaseRow>; channels?: unknown[] } = {}) {
  const trace: { table: string; method: string; args: unknown[] }[] = [];
  const storageDownload = vi.fn().mockResolvedValue({
    data: new Blob([bytes], { type: 'application/octet-stream' }),
    error: null,
  });
  const storageFrom = vi.fn(() => ({ download: storageDownload }));
  const insertDownload = vi.fn();
  const results: Record<string, unknown> = {
    product_releases: { data: options.release || releaseRow(), error: null },
    licenses: { data: [{ id: 'license-1', platform: 'MT5' }], error: null },
    release_channels: { data: options.channels === undefined ? [{ platform: 'MT5', current_release_id: releaseId }] : options.channels, error: null },
    download_events: { data: null, error: null },
  };

  return {
    trace,
    storageDownload,
    storageFrom,
    insertDownload,
    db: {
      storage: { from: storageFrom },
      from(table: string) {
        const chain: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'in', 'or', 'limit']) {
          chain[method] = (...args: unknown[]) => {
            trace.push({ table, method, args });
            return chain;
          };
        }
        chain.insert = (values: unknown) => {
          insertDownload(values);
          trace.push({ table, method: 'insert', args: [values] });
          return chain;
        };
        chain.maybeSingle = () => Promise.resolve(results[table]);
        chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(results[table]).then(resolve, reject);
        return chain;
      },
    },
  };
}

function downloadRequest() {
  return new Request(`https://app.orionscalper.com/api/downloads/${releaseId}`, {
    headers: { 'user-agent': 'Orion test browser' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ releaseId }) };
}
