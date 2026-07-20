import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit } from '@/lib/client-security';
import { approvedProductDownloadUrl } from '@/lib/download-security';
import { releaseBucket } from '@/lib/release-files';
import {
  isMissingReleaseStorageSchema,
  readReleaseBody,
  releaseIdempotencyKey,
  releaseMutationPreflight,
  verifiedStorageObject,
} from '@/lib/release-server';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();
const bodySchema = z.object({ notify_clients: z.boolean().optional().default(true) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-publish', limit: 16 })) return jsonError('Too many release publishing requests. Please wait before trying again.', 429);
  if (!releaseIdempotencyKey(request)) return jsonError('A valid Idempotency-Key is required', 400);
  const releaseId = idSchema.safeParse((await params).releaseId);
  const body = bodySchema.safeParse(await readReleaseBody(request, 1_000));
  if (!releaseId.success) return jsonError('Invalid release ID');
  if (!body.success) return jsonError(body.error.issues[0]?.message || 'Invalid publishing request');

  const db = createSupabaseAdminClient();
  const releaseResult = await db.from('product_releases')
    .select('id,asset_status,storage_bucket,storage_path,file_size_bytes,content_type,download_url,archived_at')
    .eq('id', releaseId.data)
    .maybeSingle();
  if (releaseResult.error) return jsonError(isMissingReleaseStorageSchema(releaseResult.error) ? 'Apply the Secure EA Release Center migration before publishing releases.' : 'Unable to load the release', isMissingReleaseStorageSchema(releaseResult.error) ? 503 : 500);
  if (!releaseResult.data) return jsonError('Release not found', 404);

  const release = releaseResult.data;
  if (release.storage_bucket === releaseBucket && release.storage_path) {
    const storedPackageReady = release.asset_status === 'ready' || (release.asset_status === 'withdrawn' && Boolean(release.archived_at));
    if (!storedPackageReady) return jsonError('Verify the private EA package before publishing this release.', 409);
    const verified = await verifiedStorageObject(db, {
      releaseId: releaseId.data,
      path: release.storage_path,
      expectedSize: Number(release.file_size_bytes || 0),
      expectedContentType: release.content_type || 'application/octet-stream',
    });
    if (verified.error) return jsonError('The private package is no longer available or failed verification. Upload it again before publishing.', 409);
  } else if (!approvedProductDownloadUrl(release.download_url || '')) {
    return jsonError('Upload and verify a private EA package before publishing this release.', 409);
  }

  const promoted = await db.rpc('promote_product_release', {
    p_release_id: releaseId.data,
    p_actor: session.user.id,
    p_notify: body.data.notify_clients,
  });
  if (promoted.error) return releaseRpcError(promoted.error, 'publish');
  return Response.json(promoted.data || { ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

function releaseRpcError(error: { code?: string; message?: string }, action: 'publish') {
  if (isMissingReleaseStorageSchema(error)) return jsonError('Apply the Secure EA Release Center migration before publishing releases.', 503);
  const message = error.message?.toLowerCase() || '';
  if (message.includes('not found')) return jsonError('Release not found', 404);
  if (message.includes('source') || message.includes('ready') || message.includes('verified')) return jsonError('Upload and verify the EA package before publishing this release.', 409);
  if (message.includes('archived')) return jsonError('This archived release cannot be published.', 409);
  return jsonError(`Unable to ${action} the release`, 500);
}
