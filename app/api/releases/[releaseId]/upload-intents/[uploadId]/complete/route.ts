import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit } from '@/lib/client-security';
import { releaseBucket, validateReleaseFileMetadata } from '@/lib/release-files';
import {
  isMissingReleaseStorageSchema,
  publicReleaseRow,
  readReleaseBody,
  releaseIdempotencyKey,
  releaseMutationPreflight,
  removeReleaseObject,
  storageSha256,
  verifiedStorageObject,
  type ReleaseDatabaseRow,
} from '@/lib/release-server';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();
const bodySchema = z.object({}).strict();
const modernSelect = 'id,version,title,release_notes,platform,download_url,published,released_at,created_at,asset_status,storage_bucket,storage_path,original_filename,file_size_bytes,sha256,content_type,uploaded_at,file_verified_at,published_at,promoted_at,archived_at,updated_at,publish_generation';

export async function POST(request: Request, { params }: { params: Promise<{ releaseId: string; uploadId: string }> }) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-upload-complete', limit: 20 })) return jsonError('Too many release verification requests. Please wait before trying again.', 429);
  if (!releaseIdempotencyKey(request)) return jsonError('A valid Idempotency-Key is required', 400);
  const values = await params;
  const releaseId = idSchema.safeParse(values.releaseId);
  const uploadId = idSchema.safeParse(values.uploadId);
  if (!releaseId.success || !uploadId.success) return jsonError('Invalid release upload');
  if (!bodySchema.safeParse(await readReleaseBody(request, 1_000)).success) return jsonError('Invalid release verification request');

  const db = createSupabaseAdminClient();
  const [uploadResult, releaseResult] = await Promise.all([
    db.from('product_release_uploads').select('id,release_id,auth_user_id,storage_bucket,storage_path,original_filename,expected_size_bytes,expected_content_type,status,expires_at').eq('id', uploadId.data).eq('release_id', releaseId.data).maybeSingle(),
    db.from('product_releases').select(modernSelect).eq('id', releaseId.data).maybeSingle(),
  ]);
  if (uploadResult.error || releaseResult.error) return jsonError(isMissingReleaseStorageSchema(uploadResult.error || releaseResult.error) ? 'Apply the Secure EA Release Center migration before verifying files.' : 'Unable to load the release upload', isMissingReleaseStorageSchema(uploadResult.error || releaseResult.error) ? 503 : 500);
  if (!uploadResult.data || !releaseResult.data) return jsonError('Release upload not found', 404);
  if (uploadResult.data.auth_user_id !== session.user.id) return jsonError('This upload belongs to another administrator session.', 403);
  const upload = uploadResult.data;
  const initialRelease = releaseResult.data as ReleaseDatabaseRow;
  const alreadyAttached = upload.status === 'Ready'
    && initialRelease.storage_path === upload.storage_path
    && initialRelease.asset_status === 'ready';
  if (alreadyAttached) return Response.json(publicReleaseRow(initialRelease), { headers: { 'Cache-Control': 'no-store' } });
  if (upload.status === 'Ready') return jsonError('This finalized upload is no longer attached to the draft. Choose the file again.', 409);
  if (upload.status !== 'Pending') return jsonError('This upload cannot be finalized.', 409);
  if (new Date(upload.expires_at).getTime() <= Date.now()) {
    const expired = await db.from('product_release_uploads')
      .update({ status: 'Expired' })
      .eq('id', uploadId.data)
      .eq('status', 'Pending')
      .select('id')
      .maybeSingle();
    if (expired.error) return jsonError('Unable to expire the release upload', 500);
    if (expired.data) await removeReleaseObject(db, upload.storage_path);
    return jsonError(expired.data ? 'This upload request expired before verification completed.' : 'This upload changed while verification was starting. Refresh the Release Center.', expired.data ? 410 : 409);
  }
  if (initialRelease.published_at) {
    await failPendingVerification(db, releaseId.data, uploadId.data, upload.storage_path);
    return jsonError('Published builds are immutable. Create a new version instead.', 409);
  }
  if (upload.storage_bucket !== releaseBucket) return jsonError('The private storage destination could not be verified.', 409);
  const compatibleFile = validateReleaseFileMetadata({
    fileName: upload.original_filename,
    sizeBytes: Number(upload.expected_size_bytes),
    contentType: upload.expected_content_type,
    platform: initialRelease.platform,
  });
  if (!compatibleFile.data) {
    await failPendingVerification(db, releaseId.data, uploadId.data, upload.storage_path);
    return jsonError('The draft platform changed after this upload was prepared. Choose the file again.', 409);
  }

  const verified = await verifiedStorageObject(db, {
    releaseId: releaseId.data,
    path: upload.storage_path,
    expectedSize: Number(upload.expected_size_bytes),
    expectedContentType: upload.expected_content_type,
  });
  if (verified.error || !verified.data) {
    await failPendingVerification(db, releaseId.data, uploadId.data, upload.storage_path);
    return jsonError(verified.error || 'The uploaded file could not be verified.', 409);
  }
  const integrity = await storageSha256(db, upload.storage_path);
  if (integrity.error || !integrity.sha256) {
    await failPendingVerification(db, releaseId.data, uploadId.data, upload.storage_path);
    return jsonError(integrity.error || 'Integrity verification failed.', 409);
  }

  const previousPath = initialRelease.storage_path;
  const now = new Date().toISOString();
  const claimed = await db.from('product_release_uploads')
    .update({ status: 'Ready', finalized_at: now })
    .eq('id', uploadId.data)
    .eq('status', 'Pending')
    .select('id')
    .maybeSingle();
  if (claimed.error) return jsonError('The verified upload could not be finalized securely.', 500);
  if (!claimed.data) return jsonError('This upload changed while verification was finishing. Refresh the Release Center.', 409);

  const updated = await db.from('product_releases').update({
    asset_status: 'ready',
    storage_bucket: releaseBucket,
    storage_path: upload.storage_path,
    original_filename: upload.original_filename,
    file_size_bytes: verified.data.size,
    sha256: integrity.sha256,
    content_type: verified.data.contentType,
    uploaded_at: now,
    file_verified_at: now,
    download_url: null,
    updated_at: now,
  }).eq('id', releaseId.data)
    .eq('platform', initialRelease.platform)
    .eq('version', initialRelease.version)
    .is('published_at', null)
    .select(modernSelect)
    .single();
  if (updated.error || !updated.data) {
    const latest = await db.from('product_releases').select(modernSelect).eq('id', releaseId.data).maybeSingle();
    if (!latest.error && latest.data && latest.data.storage_path === upload.storage_path && latest.data.asset_status === 'ready') {
      return Response.json(publicReleaseRow(latest.data as ReleaseDatabaseRow), { headers: { 'Cache-Control': 'no-store' } });
    }
    await failClaimedUpload(db, releaseId.data, uploadId.data, upload.storage_path);
    return jsonError('The release changed while the file was being verified. Reopen the draft and upload the package again.', 409);
  }

  if (previousPath && previousPath !== upload.storage_path) await removeReleaseObject(db, previousPath);

  return Response.json(publicReleaseRow(updated.data as ReleaseDatabaseRow), { headers: { 'Cache-Control': 'no-store' } });
}

async function failPendingVerification(db: ReturnType<typeof createSupabaseAdminClient>, releaseId: string, uploadId: string, path: string) {
  const failed = await db.from('product_release_uploads')
    .update({ status: 'Failed' })
    .eq('id', uploadId)
    .eq('status', 'Pending')
    .select('id')
    .maybeSingle();
  if (failed.data) await removeIfUnreferenced(db, releaseId, path);
}

async function failClaimedUpload(db: ReturnType<typeof createSupabaseAdminClient>, releaseId: string, uploadId: string, path: string) {
  const failed = await db.from('product_release_uploads')
    .update({ status: 'Failed' })
    .eq('id', uploadId)
    .eq('status', 'Ready')
    .select('id')
    .maybeSingle();
  if (failed.data) await removeIfUnreferenced(db, releaseId, path);
}

async function removeIfUnreferenced(db: ReturnType<typeof createSupabaseAdminClient>, releaseId: string, path: string) {
  const release = await db.from('product_releases').select('storage_path').eq('id', releaseId).maybeSingle();
  if (!release.error && release.data?.storage_path !== path) await removeReleaseObject(db, path);
}
