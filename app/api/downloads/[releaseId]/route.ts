import { z } from 'zod';
import { approvedProductDownloadUrl } from '@/lib/download-security';
import { getPortalSession } from '@/lib/portal-session';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, sanitizeString } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const releaseIdSchema = z.string().uuid();
const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  const parsedId = releaseIdSchema.safeParse(releaseId);
  if (!parsedId.success) return jsonError('Invalid release', 400);

  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (!session.client) return jsonError('A linked client account is required', 403);
  if (session.client.status !== 'Active') return jsonError('Your client account must be active before downloading Orion releases', 403);
  if (!rateLimit(request, `protected-download:${session.user.id}`).allowed) return jsonError('Too many download requests', 429);

  const db = createSupabaseAdminClient();
  const { data: release, error: releaseError } = await db.from('product_releases')
    .select('id,version,title,platform,download_url,published')
    .eq('id', parsedId.data)
    .eq('published', true)
    .maybeSingle();
  if (releaseError || !release || !release.download_url) return jsonError('Release not found', 404);

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  let licenseQuery = db.from('licenses')
    .select('id')
    .eq('client_id', session.client.id)
    .eq('status', 'Active')
    .or(`expires_at.is.null,expires_at.gte.${todayUtc}`)
    .limit(1);
  if (release.platform !== 'Both') licenseQuery = licenseQuery.eq('platform', release.platform);
  const { data: licenses, error: licenseError } = await licenseQuery;
  if (licenseError) return jsonError('Unable to verify download eligibility', 500);
  if (!licenses?.length) return jsonError('An active matching-platform license is required for this release', 403);

  const sourceUrl = approvedProductDownloadUrl(release.download_url);
  if (!sourceUrl) return jsonError('This release does not have a safe download source', 502);

  let upstream: Response;
  try {
    upstream = await fetchDownload(sourceUrl);
  } catch {
    return jsonError('The release file is temporarily unavailable', 502);
  }
  if (!upstream.ok || !upstream.body) return jsonError('The release file is temporarily unavailable', 502);
  const contentLength = Number(upstream.headers.get('content-length') || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    await upstream.body.cancel().catch(() => undefined);
    return jsonError('The release file is too large for protected delivery', 413);
  }
  const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    await upstream.body.cancel().catch(() => undefined);
    return jsonError('The download source returned an unexpected response', 502);
  }

  const { error: logError } = await db.from('download_events').insert({
    client_id: session.client.id,
    release_id: release.id,
    version: release.version,
    platform: release.platform,
    user_agent: sanitizeString(request.headers.get('user-agent'), 300),
  });
  if (logError) {
    await upstream.body.cancel().catch(() => undefined);
    return jsonError('The download could not be recorded securely', 500);
  }

  const filename = releaseFilename(release.title, release.version, release.platform, sourceUrl);
  return new Response(boundedBody(upstream.body), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
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

function boundedBody(stream: ReadableStream<Uint8Array>) {
  let received = 0;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_DOWNLOAD_BYTES) {
        controller.error(new Error('Download size limit exceeded'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

function releaseFilename(title: string, version: string, platform: string, sourceUrl: URL) {
  const extensionMatch = sourceUrl.pathname.match(/\.([a-z0-9]{1,8})$/i);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '.bin';
  const base = `${title}-${version}-${platform}`.normalize('NFKD').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'orion-release';
  return `${base}${extension}`.replace(/["\\]/g, '');
}
