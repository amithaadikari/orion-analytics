import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit } from '@/lib/client-security';
import {
  isMissingReleaseStorageSchema,
  readReleaseBody,
  releaseIdempotencyKey,
  releaseMutationPreflight,
} from '@/lib/release-server';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();
const bodySchema = z.object({}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-archive', limit: 16 })) return jsonError('Too many release archive requests. Please wait before trying again.', 429);
  if (!releaseIdempotencyKey(request)) return jsonError('A valid Idempotency-Key is required', 400);
  const releaseId = idSchema.safeParse((await params).releaseId);
  if (!releaseId.success) return jsonError('Invalid release ID');
  if (!bodySchema.safeParse(await readReleaseBody(request, 1_000)).success) return jsonError('Invalid archive request');

  const db = createSupabaseAdminClient();
  const archived = await db.rpc('archive_product_release', {
    p_release_id: releaseId.data,
    p_actor: session.user.id,
  });
  if (archived.error) {
    if (isMissingReleaseStorageSchema(archived.error)) return jsonError('Apply the Secure EA Release Center migration before archiving releases.', 503);
    const message = archived.error.message?.toLowerCase() || '';
    if (message.includes('not found')) return jsonError('Release not found', 404);
    if (message.includes('current') || message.includes('channel')) return jsonError('Publish another version before archiving the current release.', 409);
    return jsonError('Unable to archive the release', 500);
  }
  return Response.json(archived.data || { ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
