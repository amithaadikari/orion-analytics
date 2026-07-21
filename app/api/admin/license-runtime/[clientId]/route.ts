import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { loadLicenseRuntimeSnapshot, publicLicenseRuntimeError } from '@/lib/license-runtime-server';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const clientIdSchema = z.string().uuid();
const resetSchema = z.object({
  action: z.literal('resetInstallation'),
  requestId: z.string().uuid(),
  licenseId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
}).strict();
type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await requireAdminApi();
  const denied = adminSessionError(auth, false);
  if (denied) return denied;
  const clientId = clientIdSchema.safeParse((await params).clientId);
  if (!clientId.success) return jsonError('Invalid client', 400);
  try {
    return privateJson(await loadLicenseRuntimeSnapshot(createSupabaseAdminClient(), clientId.data));
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'License pairing is temporarily unavailable.', known.status || 500);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const auth = await requireAdminApi();
  const denied = adminSessionError(auth, true);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, auth.user!.id, { scope: 'admin-license-runtime', limit: 20 })) {
    return jsonError('Too many installation resets. Please wait before trying again.', 429);
  }
  const clientId = clientIdSchema.safeParse((await params).clientId);
  if (!clientId.success) return jsonError('Invalid client', 400);
  const parsed = resetSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid installation reset');

  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc('reset_license_installation_admin', {
    p_admin_user_id: auth.user!.id,
    p_client_id: clientId.data,
    p_request_id: parsed.data.requestId,
    p_license_id: parsed.data.licenseId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const publicError = publicLicenseRuntimeError(error);
    return Response.json({ error: publicError.message, code: publicError.code, nextChangeAt: publicError.nextChangeAt }, {
      status: publicError.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const mutation = data && typeof data === 'object' && !Array.isArray(data)
    ? { changed: data.changed === true, action: 'resetInstallation' as const }
    : { changed: true, action: 'resetInstallation' as const };
  try {
    return privateJson({ ...await loadLicenseRuntimeSnapshot(db, clientId.data), mutation });
  } catch {
    return privateJson({ committed: true, refreshRequired: true, mutation }, 202);
  }
}

function adminSessionError(session: Awaited<ReturnType<typeof requireAdminApi>>, write: boolean) {
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.admin) return jsonError('Administrator access is required', 403);
  if (write && session.admin.role !== 'admin') return jsonError('Administrator write access is required', 403);
  return null;
}

function mutationPreflight(request: Request) {
  if (!isExactSameOrigin(request)) return jsonError('Origin not allowed', 403);
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return jsonError('JSON content is required', 415);
  }
  return null;
}

async function safeBody(request: Request) {
  try { return await readJson(request, 4_000); } catch { return null; }
}

function privateJson(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
