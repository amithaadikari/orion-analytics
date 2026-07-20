import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit } from '@/lib/client-security';
import {
  releaseAllowedMimeTypes,
  releaseBucket,
  releaseStoragePath,
  releaseUploadMaxBytes,
  releaseUploadMaxLabel,
  validateReleaseFileMetadata,
} from '@/lib/release-files';
import {
  ensurePrivateReleaseBucket,
  isMissingReleaseStorageSchema,
  readReleaseBody,
  releaseIdempotencyKey,
  releaseMutationPreflight,
  removeReleaseObject,
} from '@/lib/release-server';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const releaseIdSchema = z.string().uuid();
const uploadSchema = z.object({
  file_name: z.string().trim().min(1).max(180),
  file_size: z.number().int().positive().max(releaseUploadMaxBytes),
  file_type: z.string().trim().max(120).optional().default(''),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-upload-intent', limit: 20 })) return jsonError('Too many release upload requests. Please wait before trying again.', 429);
  const idempotencyKey = releaseIdempotencyKey(request);
  if (!idempotencyKey) return jsonError('A valid Idempotency-Key is required', 400);
  const releaseId = releaseIdSchema.safeParse((await params).releaseId);
  const body = uploadSchema.safeParse(await readReleaseBody(request, 4_000));
  if (!releaseId.success) return jsonError('Invalid release ID');
  if (!body.success) return jsonError(body.error.issues[0]?.message || 'Invalid release file');

  const db = createSupabaseAdminClient();
  const releaseResult = await db.from('product_releases').select('id,platform,published_at,archived_at').eq('id', releaseId.data).maybeSingle();
  if (releaseResult.error) return jsonError(isMissingReleaseStorageSchema(releaseResult.error) ? 'Apply the Secure EA Release Center migration before uploading files.' : 'Unable to load the release draft', isMissingReleaseStorageSchema(releaseResult.error) ? 503 : 500);
  if (!releaseResult.data) return jsonError('Release draft not found', 404);
  if (releaseResult.data.published_at) return jsonError('Published builds are immutable. Create a new release version to replace the file.', 409);
  if (releaseResult.data.archived_at) return jsonError('Archived releases cannot accept new files.', 409);

  const file = validateReleaseFileMetadata({
    fileName: body.data.file_name,
    sizeBytes: body.data.file_size,
    contentType: body.data.file_type,
    platform: releaseResult.data.platform,
  });
  if (!file.data) return jsonError(file.error);
  const fileData = file.data;

  const bucket = await ensurePrivateReleaseBucket(db);
  if (!bucket.ok) return jsonError('Private release storage is unavailable. Confirm that Supabase Storage is enabled.', 503);

  const existing = await db.from('product_release_uploads')
    .select('id,release_id,storage_bucket,storage_path,original_filename,expected_size_bytes,expected_content_type,status,expires_at')
    .eq('release_id', releaseId.data)
    .eq('auth_user_id', session.user.id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing.error) return jsonError(isMissingReleaseStorageSchema(existing.error) ? 'Apply the Secure EA Release Center migration before uploading files.' : 'Unable to prepare the release upload', isMissingReleaseStorageSchema(existing.error) ? 503 : 500);
  if (existing.data && existing.data.status !== 'Pending') return jsonError(existing.data.status === 'Ready' ? 'This upload has already been finalized.' : 'This upload request can no longer be used.', 409);
  if (existing.data && new Date(existing.data.expires_at).getTime() <= Date.now()) {
    const expired = await db.from('product_release_uploads')
      .update({ status: 'Expired' })
      .eq('id', existing.data.id)
      .eq('status', 'Pending')
      .select('id,storage_path')
      .maybeSingle();
    if (expired.error) return jsonError('Unable to expire the previous upload request', 500);
    if (expired.data) await removeReleaseObject(db, expired.data.storage_path);
    return jsonError(expired.data ? 'This upload request has expired. Choose the file again.' : 'This upload request changed while it was expiring. Refresh the Release Center.', expired.data ? 410 : 409);
  }
  if (existing.data && (
    existing.data.original_filename !== fileData.fileName
    || Number(existing.data.expected_size_bytes) !== fileData.sizeBytes
    || existing.data.expected_content_type !== fileData.contentType
  )) return jsonError('This upload request was already assigned to a different file. Choose the file again.', 409);

  if (!existing.data) {
    const stale = await db.from('product_release_uploads')
      .select('id,storage_path')
      .eq('release_id', releaseId.data)
      .eq('status', 'Pending')
      .lte('expires_at', new Date().toISOString());
    if (stale.error) return jsonError('Unable to check previous upload requests', 500);
    if (stale.data?.length) {
      const staleIds = stale.data.map((upload) => upload.id);
      const expired = await db.from('product_release_uploads')
        .update({ status: 'Expired' })
        .in('id', staleIds)
        .eq('status', 'Pending')
        .select('id,storage_path');
      if (expired.error) return jsonError('Unable to expire previous upload requests', 500);
      await Promise.all((expired.data || []).map((upload) => removeReleaseObject(db, upload.storage_path)));
    }
  }

  const uploadId = existing.data?.id || randomUUID();
  const path = existing.data?.storage_path || releaseStoragePath(releaseId.data, uploadId, fileData.extension);
  const expiresAt = existing.data?.expires_at || new Date(Date.now() + 2 * 60 * 60_000).toISOString();

  if (!existing.data) {
    const created = await db.from('product_release_uploads').insert({
      id: uploadId,
      release_id: releaseId.data,
      admin_id: session.admin.id,
      auth_user_id: session.user.id,
      idempotency_key: idempotencyKey,
      storage_bucket: releaseBucket,
      storage_path: path,
      original_filename: fileData.fileName,
      expected_size_bytes: fileData.sizeBytes,
      expected_content_type: fileData.contentType,
      status: 'Pending',
      expires_at: expiresAt,
    });
    if (created.error) return jsonError(created.error.code === '23505' ? 'This upload request is already being prepared.' : isMissingReleaseStorageSchema(created.error) ? 'Apply the Secure EA Release Center migration before uploading files.' : 'Unable to prepare the release upload', created.error.code === '23505' ? 409 : isMissingReleaseStorageSchema(created.error) ? 503 : 500);
  }

  const signed = await db.storage.from(releaseBucket).createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data) {
    await db.from('product_release_uploads').update({ status: 'Failed' }).eq('id', uploadId).eq('status', 'Pending');
    return jsonError('Unable to authorize the private file upload', 503);
  }

  return Response.json({
    upload: { id: uploadId, path, token: signed.data.token, bucket: releaseBucket, expires_at: expiresAt },
    constraints: {
      max_bytes: releaseUploadMaxBytes,
      max_label: releaseUploadMaxLabel,
      allowed_mime_types: releaseAllowedMimeTypes,
      accepted_extensions: releaseResult.data.platform === 'MT4' ? ['.ex4', '.zip'] : releaseResult.data.platform === 'MT5' ? ['.ex5', '.zip'] : ['.zip'],
    },
  }, { status: existing.data ? 200 : 201, headers: { 'Cache-Control': 'private, no-store' } });
}
