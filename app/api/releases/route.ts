import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit } from '@/lib/client-security';
import {
  isMissingReleaseStorageSchema,
  publicReleaseRow,
  readReleaseBody,
  releaseIdempotencyKey,
  releaseMutationPreflight,
  removeReleaseObject,
  type ReleaseDatabaseRow,
  type ReleaseMetric,
} from '@/lib/release-server';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const platformSchema = z.enum(['MT4', 'MT5', 'Both']);
const draftSchema = z.object({
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(2).max(140),
  release_notes: z.string().trim().max(4000).optional().default(''),
  platform: platformSchema,
}).strict();
const updateSchema = z.object({
  id: z.string().uuid(),
  data: draftSchema.partial().refine((value) => Object.keys(value).length > 0, 'Choose at least one release field to update.'),
}).strict();
const deleteSchema = z.object({ id: z.string().uuid() }).strict();

const modernSelect = 'id,version,title,release_notes,platform,download_url,published,released_at,created_at,asset_status,storage_bucket,storage_path,original_filename,file_size_bytes,sha256,content_type,uploaded_at,file_verified_at,published_at,promoted_at,archived_at,updated_at,publish_generation,created_by_auth_user_id,create_idempotency_key';
const legacySelect = 'id,version,title,release_notes,platform,download_url,published,released_at,created_at';

export async function GET() {
  const session = await requireAdminApi();
  if (!session.user || !session.admin) return jsonError('Unauthorized', 401);

  const db = createSupabaseAdminClient();
  let modern = true;
  const modernReleaseResult = await db.from('product_releases')
    .select(modernSelect)
    .order('promoted_at', { ascending: false, nullsFirst: false })
    .order('released_at', { ascending: false });
  let releaseRows: ReleaseDatabaseRow[] = [];
  if (modernReleaseResult.error && isMissingReleaseStorageSchema(modernReleaseResult.error)) {
    modern = false;
    const legacyReleaseResult = await db.from('product_releases').select(legacySelect).order('released_at', { ascending: false });
    if (legacyReleaseResult.error) return jsonError('Unable to load releases', 500);
    releaseRows = (legacyReleaseResult.data || []) as ReleaseDatabaseRow[];
  } else if (modernReleaseResult.error) {
    return jsonError('Unable to load releases', 500);
  } else {
    releaseRows = (modernReleaseResult.data || []) as ReleaseDatabaseRow[];
  }

  let channelRows: { platform: string; current_release_id: string | null; updated_at?: string | null }[] = [];
  let metrics: ReleaseMetric[] = [];
  let metricsAvailable = false;
  if (modern) {
    const [channelsResult, metricsResult] = await Promise.all([
      db.from('release_channels').select('platform,current_release_id,updated_at').order('platform'),
      db.rpc('get_release_delivery_metrics'),
    ]);
    if (channelsResult.error && !isMissingReleaseStorageSchema(channelsResult.error)) return jsonError('Unable to load release channels', 500);
    if (!channelsResult.error) channelRows = channelsResult.data || [];
    if (!metricsResult.error && Array.isArray(metricsResult.data)) {
      metrics = metricsResult.data as ReleaseMetric[];
      metricsAvailable = true;
    }
  }

  const channelMap = new Map<string, string[]>();
  for (const channel of channelRows) {
    if (!channel.current_release_id) continue;
    const platforms = channelMap.get(channel.current_release_id) || [];
    platforms.push(channel.platform);
    channelMap.set(channel.current_release_id, platforms);
  }
  const metricMap = new Map(metrics.map((metric) => [metric.release_id, metric]));
  const releases = releaseRows.map((row) => publicReleaseRow(row, channelMap.get(row.id) || [], metricMap.get(row.id)));
  const currentIds = new Set(channelRows.map((channel) => channel.current_release_id).filter(Boolean));
  const summary = {
    total_releases: releases.length,
    private_files: releases.filter((release) => release.source === 'private').length,
    current_targets: channelRows.filter((channel) => channel.current_release_id).length,
    delivery_requests: releases.reduce((total, release) => total + release.download_count, 0),
    active_versions: currentIds.size,
  };

  return Response.json({
    releases,
    channels: channelRows.map((channel) => ({ platform: channel.platform, current_release_id: channel.current_release_id, updated_at: channel.updated_at || null })),
    summary,
    storageReady: modern && channelRows.length === 2,
    metricsAvailable,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-create', limit: 20 })) return jsonError('Too many release updates. Please wait before trying again.', 429);
  const idempotencyKey = releaseIdempotencyKey(request);
  if (!idempotencyKey) return jsonError('A valid Idempotency-Key is required', 400);
  const parsed = draftSchema.safeParse(await readReleaseBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid release draft');

  const db = createSupabaseAdminClient();
  const existing = await db.from('product_releases')
    .select(modernSelect)
    .eq('created_by_auth_user_id', session.user.id)
    .eq('create_idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing.error) return jsonError(isMissingReleaseStorageSchema(existing.error) ? 'Apply the Secure EA Release Center migration before creating private releases.' : 'Unable to check the release request', isMissingReleaseStorageSchema(existing.error) ? 503 : 500);
  if (existing.data) {
    if (!sameDraftRequest(existing.data, parsed.data)) return jsonError('This Idempotency-Key was already used for different release details.', 409);
    return Response.json(publicReleaseRow(existing.data as ReleaseDatabaseRow), { headers: { 'Cache-Control': 'no-store' } });
  }

  const insert = await db.from('product_releases').insert({
    ...parsed.data,
    published: false,
    asset_status: 'none',
    created_by_auth_user_id: session.user.id,
    create_idempotency_key: idempotencyKey,
  }).select(modernSelect).single();
  if (insert.error || !insert.data) {
    const duplicate = insert.error?.code === '23505';
    if (duplicate) {
      const concurrent = await db.from('product_releases')
        .select(modernSelect)
        .eq('created_by_auth_user_id', session.user.id)
        .eq('create_idempotency_key', idempotencyKey)
        .maybeSingle();
      if (concurrent.error) return jsonError('Unable to confirm the release request', 500);
      if (concurrent.data) {
        if (!sameDraftRequest(concurrent.data, parsed.data)) return jsonError('This Idempotency-Key was already used for different release details.', 409);
        return Response.json(publicReleaseRow(concurrent.data as ReleaseDatabaseRow), { headers: { 'Cache-Control': 'no-store' } });
      }
    }
    return jsonError(duplicate ? 'This version already exists for the selected platform.' : isMissingReleaseStorageSchema(insert.error) ? 'Apply the Secure EA Release Center migration before creating private releases.' : 'Unable to create the release draft', duplicate ? 409 : isMissingReleaseStorageSchema(insert.error) ? 503 : 500);
  }
  return Response.json(publicReleaseRow(insert.data as ReleaseDatabaseRow), { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

function sameDraftRequest(row: Record<string, unknown>, draft: z.infer<typeof draftSchema>) {
  return row.version === draft.version
    && row.title === draft.title
    && (row.release_notes || '') === draft.release_notes
    && row.platform === draft.platform;
}

export async function PATCH(request: Request) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-edit', limit: 30 })) return jsonError('Too many release updates. Please wait before trying again.', 429);
  const parsed = updateSchema.safeParse(await readReleaseBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid release update');

  const db = createSupabaseAdminClient();
  const current = await db.from('product_releases').select('id,version,platform,asset_status,storage_path,published_at,archived_at').eq('id', parsed.data.id).maybeSingle();
  if (current.error) return jsonError(isMissingReleaseStorageSchema(current.error) ? 'Apply the Secure EA Release Center migration before editing releases.' : 'Unable to load the release', isMissingReleaseStorageSchema(current.error) ? 503 : 500);
  if (!current.data) return jsonError('Release not found', 404);
  if (current.data.archived_at) return jsonError('Restore the archived release before editing it.', 409);
  const identityLocked = Boolean(current.data.published_at || current.data.storage_path || current.data.asset_status === 'ready');
  const identityChanging = (
    (parsed.data.data.version !== undefined && parsed.data.data.version !== current.data.version)
    || (parsed.data.data.platform !== undefined && parsed.data.data.platform !== current.data.platform)
  );
  if (identityLocked && identityChanging) return jsonError('The version and platform are locked after a package is verified. Create a new draft instead.', 409);
  if (identityChanging) {
    const pendingUpload = await db.from('product_release_uploads').select('id').eq('release_id', parsed.data.id).eq('status', 'Pending').limit(1);
    if (pendingUpload.error) return jsonError('Unable to verify the release upload state', 500);
    if (pendingUpload.data?.length) return jsonError('Finish or expire the pending file upload before changing the version or platform.', 409);
  }

  const update = await db.from('product_releases').update({ ...parsed.data.data, updated_at: new Date().toISOString() }).eq('id', parsed.data.id).select(modernSelect).single();
  if (update.error || !update.data) return jsonError(update.error?.code === '23505' ? 'This version already exists for the selected platform.' : 'Unable to update the release', update.error?.code === '23505' ? 409 : 500);
  return Response.json(publicReleaseRow(update.data as ReleaseDatabaseRow), { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request) {
  const preflight = releaseMutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  if (!session.user || !session.admin || session.admin.role !== 'admin') return jsonError('Admin access required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'release-delete', limit: 12 })) return jsonError('Too many release updates. Please wait before trying again.', 429);
  const parsed = deleteSchema.safeParse(await readReleaseBody(request, 2_000));
  if (!parsed.success) return jsonError('Invalid release ID');

  const db = createSupabaseAdminClient();
  const [releaseResult, deliveryResult, channelResult, uploadsResult] = await Promise.all([
    db.from('product_releases').select('id,published_at,storage_path').eq('id', parsed.data.id).maybeSingle(),
    db.from('download_events').select('id', { count: 'exact', head: true }).eq('release_id', parsed.data.id),
    db.from('release_channels').select('platform').eq('current_release_id', parsed.data.id).limit(1),
    db.from('product_release_uploads').select('storage_path').eq('release_id', parsed.data.id),
  ]);
  if (releaseResult.error || deliveryResult.error || channelResult.error || uploadsResult.error) {
    const databaseError = releaseResult.error || channelResult.error || uploadsResult.error;
    return jsonError(isMissingReleaseStorageSchema(databaseError) ? 'Apply the Secure EA Release Center migration before deleting drafts.' : 'Unable to verify the release draft', isMissingReleaseStorageSchema(databaseError) ? 503 : 500);
  }
  if (!releaseResult.data) return jsonError('Release not found', 404);
  if (releaseResult.data.published_at || Number(deliveryResult.count || 0) > 0 || channelResult.data?.length) return jsonError('Only unused drafts that have never been published can be permanently deleted.', 409);

  const deleted = await db.from('product_releases').delete().eq('id', parsed.data.id);
  if (deleted.error) return jsonError('Unable to delete the release draft', 500);
  const storagePaths = [...new Set([
    releaseResult.data.storage_path,
    ...(uploadsResult.data || []).map((upload) => upload.storage_path),
  ].filter((path): path is string => typeof path === 'string' && Boolean(path)))];
  const cleanup = await Promise.all(storagePaths.map((path) => removeReleaseObject(db, path)));
  return Response.json({ ok: true, storageCleaned: cleanup.every(Boolean) }, { headers: { 'Cache-Control': 'no-store' } });
}
