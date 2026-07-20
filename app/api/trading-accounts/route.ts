import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError, readJson } from '@/lib/security';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { loadTradingAccountSnapshot, publicTradingAccountError } from '@/lib/trading-accounts-server';

export const dynamic = 'force-dynamic';

const accountSchema = z.object({
  requestId: z.string().uuid(),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/, 'Enter a 4 to 24 digit real account number'),
  broker: z.string().trim().min(2).max(120),
  brokerServer: z.string().trim().min(2).max(160),
  platform: z.enum(['MT4', 'MT5']),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional().or(z.literal('')),
  confirmation: z.enum(['REGISTER ACCOUNT', 'CHANGE ACCOUNT']),
}).strict();

export async function GET() {
  const session = await getPortalSession();
  const denied = clientSessionError(session);
  if (denied) return denied;
  try {
    const snapshot = await loadTradingAccountSnapshot(createSupabaseAdminClient(), session.client!.id);
    return privateJson(snapshot);
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'Trading accounts are temporarily unavailable.', known.status || 500);
  }
}

export async function POST(request: Request) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const session = await getPortalSession();
  const denied = clientSessionError(session);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, session.user!.id, { scope: 'trading-account', limit: 8 })) {
    return jsonError('Too many trading-account requests. Please wait before trying again.', 429);
  }

  const parsed = accountSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid trading account');
  const db = createSupabaseAdminClient();
  let before;
  try {
    before = await loadTradingAccountSnapshot(db, session.client!.id);
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'Trading accounts are temporarily unavailable.', known.status || 500);
  }
  const expectedConfirmation = before.currentAccount ? 'CHANGE ACCOUNT' : 'REGISTER ACCOUNT';
  if (parsed.data.confirmation !== expectedConfirmation) {
    return jsonError(`Type ${expectedConfirmation} to confirm this permanent license-binding change.`);
  }

  const { data, error } = await db.rpc('change_registered_real_account_client', {
    p_auth_user_id: session.user!.id,
    p_request_id: parsed.data.requestId,
    p_account_number: parsed.data.accountNumber,
    p_broker: parsed.data.broker,
    p_broker_server: parsed.data.brokerServer,
    p_platform: parsed.data.platform,
    p_currency: parsed.data.currency || null,
  });
  if (error) {
    const publicError = publicTradingAccountError(error);
    return Response.json({ error: publicError.message, code: publicError.code, nextChangeAt: publicError.nextChangeAt }, {
      status: publicError.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const mutation = data && typeof data === 'object' && !Array.isArray(data)
    ? {
        changed: data.changed === true,
        changeKind: typeof data.changeKind === 'string' ? data.changeKind : null,
        reboundLicenses: typeof data.reboundLicenses === 'number' ? data.reboundLicenses : before.licensesBound,
      }
    : { changed: true, changeKind: before.currentAccount ? 'Replacement' : 'Registration', reboundLicenses: before.licensesBound };
  try {
    const snapshot = await loadTradingAccountSnapshot(db, session.client!.id);
    return privateJson({ ...snapshot, mutation }, before.currentAccount ? 200 : 201);
  } catch {
    return privateJson({ committed: true, refreshRequired: true, mutation }, 202);
  }
}

function clientSessionError(session: Awaited<ReturnType<typeof getPortalSession>>) {
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);
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
  try { return await readJson(request, 3_000); } catch { return null; }
}

function privateJson(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
