import 'server-only';

import { createHash } from 'node:crypto';
import { isExactSameOrigin } from '@/lib/client-security';
import {
  isSafeReleaseStoragePath,
  releaseAllowedMimeTypes,
  releaseBucket,
  releaseUploadMaxBytes,
} from '@/lib/release-files';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export type ReleaseDatabaseRow = {
  id: string;
  version: string;
  title: string;
  release_notes?: string | null;
  platform: 'MT4' | 'MT5' | 'Both';
  download_url?: string | null;
  published: boolean;
  released_at: string;
  created_at?: string;
  asset_status?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  original_filename?: string | null;
  file_size_bytes?: number | null;
  sha256?: string | null;
  content_type?: string | null;
  uploaded_at?: string | null;
  file_verified_at?: string | null;
  published_at?: string | null;
  promoted_at?: string | null;
  archived_at?: string | null;
  updated_at?: string | null;
  publish_generation?: number | null;
};

export type ReleaseMetric = {
  release_id: string;
  download_count: number | string;
  unique_clients: number | string;
  last_downloaded_at?: string | null;
};

export function releaseMutationPreflight(request: Request) {
  if (!isExactSameOrigin(request)) return jsonError('Origin not allowed', 403);
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') return jsonError('JSON content is required', 415);
  return null;
}

export function releaseIdempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key')?.trim().toLowerCase() || '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : null;
}

export async function readReleaseBody(request: Request, maxBytes = 12_000) {
  try { return await readJson(request, maxBytes); } catch { return null; }
}

export function isMissingReleaseStorageSchema(error: { code?: string; message?: string } | null | undefined) {
  const code = error?.code?.toUpperCase();
  const message = error?.message?.toLowerCase() || '';
  if (code === '42P01' || code === '42703' || code === 'PGRST202' || code === 'PGRST204' || code === 'PGRST205') return true;
  return ['asset_status', 'storage_path', 'release_channels', 'product_release_uploads', 'promote_product_release', 'archive_product_release', 'get_release_delivery_metrics']
    .some((name) => message.includes(name)) && (message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find'));
}

export async function ensurePrivateReleaseBucket(db: ReturnType<typeof createSupabaseAdminClient>) {
  const options = {
    public: false,
    fileSizeLimit: releaseUploadMaxBytes,
    allowedMimeTypes: [...releaseAllowedMimeTypes],
  };
  const existing = await db.storage.getBucket(releaseBucket);
  if (existing.error) {
    const created = await db.storage.createBucket(releaseBucket, options);
    if (created.error) return { ok: false as const, error: created.error };
    return { ok: true as const };
  }
  const updated = await db.storage.updateBucket(releaseBucket, options);
  return updated.error ? { ok: false as const, error: updated.error } : { ok: true as const };
}

export function publicReleaseRow(row: ReleaseDatabaseRow, currentPlatforms: string[] = [], metric?: ReleaseMetric) {
  const source = row.storage_path && row.storage_bucket === releaseBucket
    ? 'private'
    : row.download_url
      ? 'external'
      : 'none';
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    release_notes: row.release_notes || '',
    platform: row.platform,
    published: Boolean(row.published),
    released_at: row.released_at,
    published_at: row.published_at || null,
    promoted_at: row.promoted_at || null,
    archived_at: row.archived_at || null,
    asset_status: row.asset_status || (source === 'external' ? 'ready' : 'none'),
    source,
    file_name: row.original_filename || (source === 'external' ? 'Protected external package' : null),
    file_size: finiteNumber(row.file_size_bytes),
    file_type: row.content_type || null,
    checksum_sha256: row.sha256 || null,
    file_verified_at: row.file_verified_at || null,
    current_platforms: currentPlatforms,
    download_count: finiteNumber(metric?.download_count) || 0,
    unique_clients: finiteNumber(metric?.unique_clients) || 0,
    last_downloaded_at: metric?.last_downloaded_at || null,
  };
}

export async function verifiedStorageObject(
  db: ReturnType<typeof createSupabaseAdminClient>,
  input: { releaseId: string; path: string; expectedSize: number; expectedContentType: string },
) {
  if (!isSafeReleaseStoragePath(input.path, input.releaseId)) return { data: null, error: 'The release storage path is invalid.' };
  const info = await db.storage.from(releaseBucket).info(input.path);
  if (info.error || !info.data) return { data: null, error: 'The uploaded file could not be verified.' };
  const size = Number(info.data.size || 0);
  const contentType = info.data.contentType?.split(';', 1)[0]?.trim().toLowerCase() || input.expectedContentType;
  if (size !== input.expectedSize || size <= 0 || size > releaseUploadMaxBytes) return { data: null, error: 'The uploaded file size does not match the secure upload request.' };
  if (!releaseAllowedMimeTypes.includes(contentType as typeof releaseAllowedMimeTypes[number])) return { data: null, error: 'The uploaded file type could not be verified.' };
  return { data: { size, contentType }, error: null };
}

export async function storageSha256(db: ReturnType<typeof createSupabaseAdminClient>, path: string) {
  const download = await db.storage.from(releaseBucket).download(path, {}, { cache: 'no-store' });
  if (download.error || !download.data) return { sha256: null, error: 'The uploaded file could not be read for integrity verification.' };
  if (download.data.size > releaseUploadMaxBytes) return { sha256: null, error: 'The uploaded file exceeds the integrity verification limit.' };
  const buffer = Buffer.from(await download.data.arrayBuffer());
  return { sha256: createHash('sha256').update(buffer).digest('hex'), error: null };
}

export async function removeReleaseObject(db: ReturnType<typeof createSupabaseAdminClient>, path: string | null | undefined) {
  if (!isSafeReleaseStoragePath(path)) return false;
  const safePath = path as string;
  const result = await db.storage.from(releaseBucket).remove([safePath]);
  return !result.error;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
