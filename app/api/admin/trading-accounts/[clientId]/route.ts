import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { loadTradingAccountSnapshot, publicTradingAccountError } from '@/lib/trading-accounts-server';

export const dynamic = 'force-dynamic';

const clientIdSchema = z.string().uuid();
const accountSchema = z.object({
  requestId: z.string().uuid(),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/, 'Enter a 4 to 24 digit real account number'),
  broker: z.string().trim().min(2).max(120),
  brokerServer: z.string().trim().min(2).max(160),
  platform: z.enum(['MT4', 'MT5']),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional().or(z.literal('')),
  overrideReason: z.string().trim().min(10).max(500),
}).strict();
const membershipSchema = z.object({
  tier: z.enum(['Standard', 'Pro']),
  status: z.enum(['Active', 'Expired', 'Cancelled', 'Suspended']),
  startedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
}).strict().superRefine((value, context) => {
  if (value.startedAt && value.expiresAt && new Date(value.expiresAt) <= new Date(value.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Membership expiry must be after its start date', path: ['expiresAt'] });
  }
});
type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await requireAdminApi();
  const denied = adminSessionError(auth, false);
  if (denied) return denied;
  const clientId = clientIdSchema.safeParse((await params).clientId);
  if (!clientId.success) return jsonError('Invalid client', 400);
  try {
    const snapshot = await loadTradingAccountSnapshot(createSupabaseAdminClient(), clientId.data, { includeAdminDetails: true });
    return privateJson(snapshot);
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'Trading accounts are temporarily unavailable.', known.status || 500);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const auth = await requireAdminApi();
  const denied = adminSessionError(auth, true);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, auth.user!.id, { scope: 'admin-trading-account', limit: 20 })) {
    return jsonError('Too many administrator account changes. Please wait before trying again.', 429);
  }
  const clientId = clientIdSchema.safeParse((await params).clientId);
  if (!clientId.success) return jsonError('Invalid client', 400);
  const parsed = accountSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid trading account');

  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc('change_registered_real_account_admin', {
    p_admin_user_id: auth.user!.id,
    p_client_id: clientId.data,
    p_request_id: parsed.data.requestId,
    p_account_number: parsed.data.accountNumber,
    p_broker: parsed.data.broker,
    p_broker_server: parsed.data.brokerServer,
    p_platform: parsed.data.platform,
    p_currency: parsed.data.currency || null,
    p_override_reason: parsed.data.overrideReason,
  });
  if (error) {
    const publicError = publicTradingAccountError(error);
    return Response.json({ error: publicError.message, code: publicError.code, nextChangeAt: publicError.nextChangeAt }, {
      status: publicError.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const mutation = data && typeof data === 'object' && !Array.isArray(data)
    ? { changed: data.changed === true, changeKind: typeof data.changeKind === 'string' ? data.changeKind : null }
    : { changed: true, changeKind: null };
  try {
    return privateJson({ ...await loadTradingAccountSnapshot(db, clientId.data, { includeAdminDetails: true }), mutation });
  } catch {
    return privateJson({ committed: true, refreshRequired: true, mutation }, 202);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const auth = await requireAdminApi();
  const denied = adminSessionError(auth, true);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, auth.user!.id, { scope: 'admin-membership', limit: 30 })) {
    return jsonError('Too many membership changes. Please wait before trying again.', 429);
  }
  const clientId = clientIdSchema.safeParse((await params).clientId);
  if (!clientId.success) return jsonError('Invalid client', 400);
  const parsed = membershipSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid membership');

  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc('set_client_membership_admin', {
    p_admin_user_id: auth.user!.id,
    p_client_id: clientId.data,
    p_tier: parsed.data.tier,
    p_status: parsed.data.status,
    p_started_at: parsed.data.tier === 'Pro' ? parsed.data.startedAt : null,
    p_expires_at: parsed.data.tier === 'Pro' ? parsed.data.expiresAt : null,
  });
  if (error) {
    const publicError = publicTradingAccountError(error);
    return jsonError(publicError.message, publicError.status);
  }
  try {
    return privateJson(await loadTradingAccountSnapshot(db, clientId.data, { includeAdminDetails: true }));
  } catch {
    return privateJson({ committed: true, refreshRequired: true, membership: data || null }, 202);
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
