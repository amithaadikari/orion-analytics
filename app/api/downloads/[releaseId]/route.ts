import { z } from 'zod';
import { approvedProductDownloadUrl } from '@/lib/download-security';
import { getPortalSession } from '@/lib/portal-session';
import { rateLimit } from '@/lib/rate-limit';
import {
  isSafeReleaseStoragePath,
  releaseBucket,
  releaseUploadMaxBytes,
  safeReleaseFileName,
} from '@/lib/release-files';
import { isMissingReleaseStorageSchema } from '@/lib/release-server';
import { jsonError, sanitizeString } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const releaseIdSchema = z.string().uuid();
const MAX_EXTERNAL_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const modernSelect = 'id,version,title,platform,download_url,published,asset_status,storage_bucket,storage_path,original_filename,file_size_bytes,sha256,content_type,published_at,archived_at';
const legacySelect = 'id,version,title,platform,download_url,published';

type ReleaseDownloadRow = {
  id: string;
  version: string;
  title: string;
  platform: 'MT4' | 'MT5' | 'Both';
  download_url?: string | null;
  published: boolean;
  asset_status?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  original_filename?: string | null;
  file_size_bytes?: number | null;
  sha256?: string | null;
  content_type?: string | null;
  published_at?: string | null;
  archived_at?: string | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const parsedId = releaseIdSchema.safeParse((await params).releaseId);
  if (!parsedId.success) return jsonError('Invalid release', 400);

  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Complete account verification before downloading Orion releases', 403);
  if (!session.client) return jsonError('A linked client account is required', 403);
  if (session.client.status !== 'Active') return jsonError('Your client account must be active before downloading Orion releases', 403);
  if (!rateLimit(request, `protected-download:${session.user.id}`).allowed) return jsonError('Too many download requests', 429);

  const db = createSupabaseAdminClient();
  const modernResult = await db.from('product_releases')
    .select(modernSelect)
    .eq('id', parsedId.data)
    .eq('published', true)
    .maybeSingle();
  let modern = true;
  let release: ReleaseDownloadRow | null = null;
  if (modernResult.error && isMissingReleaseStorageSchema(modernResult.error)) {
    modern = false;
    const legacyResult = await db.from('product_releases')
      .select(legacySelect)
      .eq('id', parsedId.data)
      .eq('published', true)
      .maybeSingle();
    if (legacyResult.error) return jsonError('Unable to verify the release', 500);
    release = legacyResult.data as ReleaseDownloadRow | null;
  } else if (modernResult.error) {
    return jsonError('Unable to verify the release', 500);
  } else {
    release = modernResult.data as ReleaseDownloadRow | null;
  }
  if (!release || (modern && release.archived_at)) return jsonError('Release not found', 404);

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  let licenseQuery = db.from('licenses')
    .select('id,platform')
    .eq('client_id', session.client.id)
    .eq('plan', session.client.plan)
    .eq('status', 'Active')
    .or(`expires_at.is.null,expires_at.gte.${todayUtc}`);
  if (release.platform !== 'Both') licenseQuery = licenseQuery.eq('platform', release.platform);
  const { data: licenses, error: licenseError } = await licenseQuery;
  if (licenseError) return jsonError('Unable to verify download eligibility', 500);
  if (!licenses?.length) return jsonError(`An active ${session.client.plan} matching-platform license is required for this release`, 403);

  if (modern) {
    const licensedPlatforms = release.platform === 'Both'
      ? [...new Set(licenses.map((license) => license.platform).filter((platform) => platform === 'MT4' || platform === 'MT5'))]
      : [release.platform];
    if (!licensedPlatforms.length) return jsonError('A matching-platform license is required for this release', 403);
    const channels = await db.from('release_channels')
      .select('platform,current_release_id')
      .in('platform', licensedPlatforms)
      .eq('current_release_id', release.id);
    if (channels.error) return jsonError(isMissingReleaseStorageSchema(channels.error) ? 'Release delivery is being upgraded. Please try again shortly.' : 'Unable to verify the active release channel', isMissingReleaseStorageSchema(channels.error) ? 503 : 500);
    if (!channels.data?.length) return jsonError('A newer Orion release is assigned to your licensed platform', 409);
  }

  if (isPrivateRelease(release)) {
    return deliverPrivateRelease(request, db, session.client.id, release);
  }
  return deliverLegacyRelease(request, db, session.client.id, release);
}

async function deliverPrivateRelease(
  request: Request,
  db: ReturnType<typeof createSupabaseAdminClient>,
  clientId: string,
  release: ReleaseDownloadRow,
) {
  if (release.asset_status !== 'ready' || !release.published_at || !isSafeReleaseStoragePath(release.storage_path, release.id)) {
    return jsonError('This release does not have a verified private package', 409);
  }
  const downloaded = await db.storage.from(releaseBucket).download(release.storage_path as string, {}, { cache: 'no-store' });
  if (downloaded.error || !downloaded.data) return jsonError('The release file is temporarily unavailable', 502);
  const expectedSize = Number(release.file_size_bytes || 0);
  if (downloaded.data.size <= 0 || downloaded.data.size > releaseUploadMaxBytes || (expectedSize > 0 && downloaded.data.size !== expectedSize)) {
    return jsonError('The private release package failed its delivery check', 502);
  }
  const contentType = normalizedDeliveryType(release.content_type || downloaded.data.type);
  const logError = await recordDownload(db, request, clientId, release);
  if (logError) return jsonError('The download could not be recorded securely', 500);
  const filename = privateReleaseFilename(release);
  const headers = downloadHeaders(filename, contentType);
  return new Response(boundedBody(downloaded.data.stream(), releaseUploadMaxBytes), { status: 200, headers });
}

async function deliverLegacyRelease(
  request: Request,
  db: ReturnType<typeof createSupabaseAdminClient>,
  clientId: string,
  release: ReleaseDownloadRow,
) {
  const sourceUrl = approvedProductDownloadUrl(release.download_url || '');
  if (!sourceUrl) return jsonError('This release does not have a safe download source', 502);
  let upstream: Response;
  try {
    upstream = await fetchDownload(sourceUrl);
  } catch {
    return jsonError('The release file is temporarily unavailable', 502);
  }
  if (!upstream.ok || !upstream.body) return jsonError('The release file is temporarily unavailable', 502);
  const contentLength = Number(upstream.headers.get('content-length') || 0);
  if (contentLength > MAX_EXTERNAL_DOWNLOAD_BYTES) {
    await upstream.body.cancel().catch(() => undefined);
    return jsonError('The release file is too large for protected delivery', 413);
  }
  const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    await upstream.body.cancel().catch(() => undefined);
    return jsonError('The download source returned an unexpected response', 502);
  }
  const logError = await recordDownload(db, request, clientId, release);
  if (logError) {
    await upstream.body.cancel().catch(() => undefined);
    return jsonError('The download could not be recorded securely', 500);
  }
  return new Response(boundedBody(upstream.body, MAX_EXTERNAL_DOWNLOAD_BYTES), {
    status: 200,
    headers: downloadHeaders(legacyReleaseFilename(release, sourceUrl), contentType),
  });
}

async function recordDownload(
  db: ReturnType<typeof createSupabaseAdminClient>,
  request: Request,
  clientId: string,
  release: ReleaseDownloadRow,
) {
  const result = await db.from('download_events').insert({
    client_id: clientId,
    release_id: release.id,
    version: release.version,
    platform: release.platform,
    user_agent: sanitizeString(request.headers.get('user-agent'), 300),
  });
  return result.error;
}

function isPrivateRelease(release: ReleaseDownloadRow) {
  return release.storage_bucket === releaseBucket && Boolean(release.storage_path);
}

async function fetchDownload(url: URL, redirects = 0): Promise<Response> {
  if (redirects > 2) throw new Error('Too many redirects');
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    headers: { Accept: 'application/octet-stream,application/zip,*/*;q=0.5' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!REDIRECT_STATUSES.has(response.status)) return response;
  const location = response.headers.get('location');
  await response.body?.cancel().catch(() => undefined);
  if (!location) throw new Error('Redirect has no destination');
  const next = approvedProductDownloadUrl(new URL(location, url).toString());
  if (!next) throw new Error('Unsafe redirect');
  return fetchDownload(next, redirects + 1);
}

function boundedBody(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  let received = 0;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        controller.error(new Error('Download size limit exceeded'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

function normalizedDeliveryType(value: string | null | undefined) {
  const contentType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return contentType === 'application/zip' || contentType === 'application/x-zip-compressed'
    ? contentType
    : 'application/octet-stream';
}

function downloadHeaders(filename: string, contentType: string) {
  return new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
}

function privateReleaseFilename(release: ReleaseDownloadRow) {
  const safe = safeReleaseFileName(release.original_filename || 'orion-release.bin');
  const ascii = safe.normalize('NFKD').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return (ascii || `orion-${release.version}.bin`).replace(/["\\]/g, '');
}

function legacyReleaseFilename(release: ReleaseDownloadRow, sourceUrl: URL) {
  const extensionMatch = sourceUrl.pathname.match(/\.([a-z0-9]{1,8})$/i);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '.bin';
  const base = `${release.title}-${release.version}-${release.platform}`.normalize('NFKD').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'orion-release';
  return `${base}${extension}`.replace(/["\\]/g, '');
}
