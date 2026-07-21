import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { installationHint, installationIdPattern, normalizeInstallationId } from '@/lib/license-runtime';
import { hashInstallationId, loadLicenseRuntimeSnapshot, publicLicenseRuntimeError } from '@/lib/license-runtime-server';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const demoFields = {
  action: z.literal('setDemoAccount'),
  requestId: z.string().uuid(),
  licenseId: z.string().uuid(),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/, 'Enter a 4 to 24 digit Demo account number'),
  brokerServer: z.string().trim().min(2).max(160),
};

const demoIntentSchema = z.object({
  ...demoFields,
  intent: z.enum(['Register', 'Replace']),
}).strict();

const demoLegacySchema = z.object({
  ...demoFields,
  confirmation: z.enum(['REGISTER DEMO', 'CHANGE DEMO']),
}).strict();

const installationFields = {
  action: z.literal('setInstallation'),
  requestId: z.string().uuid(),
  licenseId: z.string().uuid(),
  installationId: z.string().transform(normalizeInstallationId).pipe(z.string().regex(installationIdPattern, 'Enter the complete Installation ID shown by the EA')),
  deviceLabel: z.string().trim().min(2).max(60),
};

const installationIntentSchema = z.object({
  ...installationFields,
  intent: z.enum(['Activate', 'Replace']),
}).strict();

const installationLegacySchema = z.object({
  ...installationFields,
  confirmation: z.enum(['ACTIVATE DEVICE', 'REPLACE DEVICE']),
}).strict();

const resolveInstallationRequestSchema = z.object({
  action: z.literal('resolveInstallationRequest'),
  pairingRequestId: z.string().uuid(),
  decision: z.enum(['Approve', 'Reject']),
}).strict();

const mutationSchema = z.union([
  demoIntentSchema,
  demoLegacySchema,
  installationIntentSchema,
  installationLegacySchema,
  resolveInstallationRequestSchema,
]);

type DemoMutation = z.infer<typeof demoIntentSchema> | z.infer<typeof demoLegacySchema>;
type InstallationMutation = z.infer<typeof installationIntentSchema> | z.infer<typeof installationLegacySchema>;

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
  const input = parsed.data;

  const db = createSupabaseAdminClient();
  if (input.action === 'resolveInstallationRequest') {
    const { data, error } = await db.rpc('resolve_license_installation_approval_client', {
      p_auth_user_id: session.user!.id,
      p_request_id: input.pairingRequestId,
      p_decision: input.decision,
    });
    if (error) {
      const publicError = publicLicenseRuntimeError(error);
      return Response.json({ error: publicError.message, code: publicError.code, nextChangeAt: publicError.nextChangeAt }, {
        status: publicError.status,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.status !== 'string') {
      return jsonError('The installation approval could not be confirmed.', 503);
    }
    const expectedStatus = input.decision === 'Approve' ? 'Approved' : 'Rejected';
    if (data.status !== expectedStatus) {
      const resolutionMessages: Record<string, string> = {
        Expired: 'This installation request expired. Let the EA create a new request.',
        Superseded: 'This installation request is no longer current. Let the EA create a new request.',
      };
      return Response.json({
        error: resolutionMessages[data.status] || 'This installation request can no longer be changed.',
        code: typeof data.code === 'string' ? data.code : `PAIRING_${data.status.toUpperCase()}`,
      }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const mutation = {
      action: input.action,
      decision: input.decision,
      changed: data.changed === true,
      status: data.status,
      code: typeof data.code === 'string' ? data.code : null,
    };
    try {
      return privateJson({ ...await loadLicenseRuntimeSnapshot(db, session.client!.id), mutation });
    } catch {
      return privateJson({ committed: true, refreshRequired: true, mutation }, 202);
    }
  }

  let before;
  try {
    before = await loadLicenseRuntimeSnapshot(db, session.client!.id);
  } catch (error) {
    const known = error as { message?: string; status?: number };
    return jsonError(known.message || 'License pairing is temporarily unavailable.', known.status || 500);
  }
  const license = before.licenses.find((item) => item.id === input.licenseId);
  if (!license) return jsonError('The selected license was not found.', 404);

  let rpcName: 'set_license_demo_account_client' | 'activate_license_installation_client';
  let rpcPayload: Record<string, string>;
  if (input.action === 'setDemoAccount') {
    const expectedIntent = license.demoAccount ? 'Replace' : 'Register';
    if (demoIntent(input) !== expectedIntent) {
      return pairingStateChanged('The Demo account status changed. Review the current details and try again.');
    }
    rpcName = 'set_license_demo_account_client';
    rpcPayload = {
      p_auth_user_id: session.user!.id,
      p_request_id: input.requestId,
      p_license_id: input.licenseId,
      p_account_number: input.accountNumber,
      p_broker_server: input.brokerServer,
    };
  } else {
    const expectedIntent = license.installation ? 'Replace' : 'Activate';
    if (installationIntent(input) !== expectedIntent) {
      return pairingStateChanged('The installation status changed. Review the current device details and try again.');
    }
    rpcName = 'activate_license_installation_client';
    rpcPayload = {
      p_auth_user_id: session.user!.id,
      p_request_id: input.requestId,
      p_license_id: input.licenseId,
      p_installation_hash: hashInstallationId(input.installationId),
      p_installation_hint: installationHint(input.installationId),
      p_device_label: input.deviceLabel,
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
    ? { changed: data.changed === true, changeKind: typeof data.changeKind === 'string' ? data.changeKind : null, action: input.action }
    : { changed: true, changeKind: null, action: input.action };
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

function demoIntent(input: DemoMutation): 'Register' | 'Replace' {
  if ('intent' in input) return input.intent;
  return input.confirmation === 'CHANGE DEMO' ? 'Replace' : 'Register';
}

function installationIntent(input: InstallationMutation): 'Activate' | 'Replace' {
  if ('intent' in input) return input.intent;
  return input.confirmation === 'REPLACE DEVICE' ? 'Replace' : 'Activate';
}

function pairingStateChanged(message: string) {
  return privateJson({ error: message, code: 'PAIRING_STATE_CHANGED' }, 409);
}
