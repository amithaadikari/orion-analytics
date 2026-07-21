import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { installationHint, installationIdPattern, normalizeInstallationId } from '@/lib/license-runtime';
import { hashInstallationId, loadLicenseRuntimeSnapshot, publicLicenseRuntimeError } from '@/lib/license-runtime-server';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const demoSchema = z.object({
  action: z.literal('setDemoAccount'),
  requestId: z.string().uuid(),
  licenseId: z.string().uuid(),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/, 'Enter a 4 to 24 digit Demo account number'),
  brokerServer: z.string().trim().min(2).max(160),
  confirmation: z.enum(['REGISTER DEMO', 'CHANGE DEMO']),
}).strict();

const installationSchema = z.object({
  action: z.literal('setInstallation'),
  requestId: z.string().uuid(),
  licenseId: z.string().uuid(),
  installationId: z.string().transform(normalizeInstallationId).pipe(z.string().regex(installationIdPattern, 'Enter the complete Installation ID shown by the EA')),
  deviceLabel: z.string().trim().min(2).max(60),
  confirmation: z.enum(['ACTIVATE DEVICE', 'REPLACE DEVICE']),
}).strict();

const mutationSchema = z.discriminatedUnion('action', [demoSchema, installationSchema]);

export async function GET() {
  const session = await getPortalSession();
  const denied = clientSessionError(session);
  if (denied) return denied;
  try {
    return privateJson(await loadLicenseRuntimeSnapshot(createSupabaseAdminClient(), session.client!.id));
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'License pairing is temporarily unavailable.', known.status || 500);
  }
}

export async function POST(request: Request) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const session = await getPortalSession();
  const denied = clientSessionError(session);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, session.user!.id, { scope: 'license-runtime', limit: 12 })) {
    return jsonError('Too many license-pairing requests. Please wait before trying again.', 429);
  }
  const parsed = mutationSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid license pairing');

  const db = createSupabaseAdminClient();
  let before;
  try {
    before = await loadLicenseRuntimeSnapshot(db, session.client!.id);
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'License pairing is temporarily unavailable.', known.status || 500);
  }
  const license = before.licenses.find((item) => item.id === parsed.data.licenseId);
  if (!license) return jsonError('The selected license was not found.', 404);

  let rpcName: 'set_license_demo_account_client' | 'activate_license_installation_client';
  let rpcPayload: Record<string, string>;
  if (parsed.data.action === 'setDemoAccount') {
    const confirmation = license.demoAccount ? 'CHANGE DEMO' : 'REGISTER DEMO';
    if (parsed.data.confirmation !== confirmation) return jsonError(`Type ${confirmation} to confirm this Demo-account binding change.`);
    rpcName = 'set_license_demo_account_client';
    rpcPayload = {
      p_auth_user_id: session.user!.id,
      p_request_id: parsed.data.requestId,
      p_license_id: parsed.data.licenseId,
      p_account_number: parsed.data.accountNumber,
      p_broker_server: parsed.data.brokerServer,
    };
  } else {
    const confirmation = license.installation ? 'REPLACE DEVICE' : 'ACTIVATE DEVICE';
    if (parsed.data.confirmation !== confirmation) return jsonError(`Type ${confirmation} to confirm this installation-seat change.`);
    rpcName = 'activate_license_installation_client';
    rpcPayload = {
      p_auth_user_id: session.user!.id,
      p_request_id: parsed.data.requestId,
      p_license_id: parsed.data.licenseId,
      p_installation_hash: hashInstallationId(parsed.data.installationId),
      p_installation_hint: installationHint(parsed.data.installationId),
      p_device_label: parsed.data.deviceLabel,
    };
  }

  const { data, error } = await db.rpc(rpcName, rpcPayload);
  if (error) {
    const publicError = publicLicenseRuntimeError(error);
    return Response.json({ error: publicError.message, code: publicError.code, nextChangeAt: publicError.nextChangeAt }, {
      status: publicError.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const mutation = data && typeof data === 'object' && !Array.isArray(data)
    ? { changed: data.changed === true, changeKind: typeof data.changeKind === 'string' ? data.changeKind : null, action: parsed.data.action }
    : { changed: true, changeKind: null, action: parsed.data.action };
  try {
    return privateJson({ ...await loadLicenseRuntimeSnapshot(db, session.client!.id), mutation }, 200);
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
  try { return await readJson(request, 4_000); } catch { return null; }
}

function privateJson(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
