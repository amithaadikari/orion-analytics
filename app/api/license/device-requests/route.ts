import { z } from 'zod';
import { hashLicenseKey, licenseKeyVersion, normalizeLicenseKey } from '@/lib/license-keys';
import { installationHint, installationIdPattern, normalizeInstallationId } from '@/lib/license-runtime';
import { hashInstallationId, isMissingLicenseRuntimeSchema } from '@/lib/license-runtime-server';
import { generatePairingMatchCode, hashPairingPollProof, pairingPollProof } from '@/lib/license-device-pairing-server';
import { getClientIp, hashIp, rateLimit } from '@/lib/rate-limit';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  action: z.literal('create'),
  licenseKey: z.string().trim().min(8).max(120),
  installationId: z.string().transform(normalizeInstallationId).pipe(z.string().regex(installationIdPattern)),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/),
  brokerServer: z.string().trim().min(2).max(160),
  platform: z.enum(['MT4', 'MT5']),
  accountType: z.enum(['Demo', 'Real']),
  deviceLabel: z.string().trim().min(2).max(60),
}).strict();

const statusSchema = z.object({
  action: z.literal('status'),
  requestId: z.string().uuid(),
  pollProof: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/),
}).strict();

const requestSchema = z.discriminatedUnion('action', [createSchema, statusSchema]);
const terminalStatuses = ['Approved', 'Rejected', 'Expired', 'Superseded'] as const;
type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return jsonError('JSON content is required', 415);
  }
  let body: unknown = null;
  try { body = await readJson(request, 3_000); } catch { return invalidRequest(); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return invalidRequest();
  if (!rateLimit(request, `license-device-${parsed.data.action}`).allowed) {
    return pairingJson({ accepted: false, code: 'PAIRING_REQUEST_RATE_LIMIT' }, 429);
  }
  const db = createSupabaseAdminClient();
  return parsed.data.action === 'create' ? createRequest(request, parsed.data, db) : pollRequest(parsed.data, db);
}

async function createRequest(request: Request, input: z.infer<typeof createSchema>, db: DatabaseClient) {
  const normalizedKey = normalizeLicenseKey(input.licenseKey);
  if (!licenseKeyVersion(normalizedKey)) return pairingJson({ accepted: false, code: 'INVALID_LICENSE' });
  const proof = pairingPollProof(normalizedKey, input.installationId);
  const { data, error } = await db.rpc('request_license_installation_approval', {
    p_key_hash: hashLicenseKey(normalizedKey),
    p_installation_hash: hashInstallationId(input.installationId),
    p_installation_hint: installationHint(input.installationId),
    p_device_label: input.deviceLabel,
    p_account_number: input.accountNumber,
    p_broker_server: input.brokerServer,
    p_platform: input.platform,
    p_account_type: input.accountType,
    p_poll_proof_hash: hashPairingPollProof(proof),
    p_match_code: generatePairingMatchCode(),
    p_request_ip_hash: hashIp(getClientIp(request)),
  });
  if (error) return pairingDatabaseError(error);
  if (!isRecord(data)) return pairingUnavailable();

  if (data.accepted !== true) {
    const code = typeof data.code === 'string' ? data.code : 'PAIRING_UNAVAILABLE';
    const status = code === 'PAIRING_REQUEST_RATE_LIMIT' ? 429
      : code === 'PAIRING_REQUEST_ALREADY_PENDING' ? 409
        : 200;
    return pairingJson({
      accepted: false,
      code,
      retryAt: typeof data.retryAt === 'string' ? data.retryAt : null,
    }, status);
  }
  if (data.status === 'Approved' && data.code === 'INSTALLATION_ALREADY_ACTIVE') {
    await cleanupApprovalState(db);
    return pairingJson({ accepted: true, code: data.code, status: 'Approved', pollAfterSeconds: 0 });
  }
  if (data.status !== 'Pending'
    || data.code !== 'PAIRING_PENDING'
    || typeof data.requestId !== 'string'
    || typeof data.matchCode !== 'string'
    || !/^[0-9]{6}$/.test(data.matchCode)
    || typeof data.expiresAt !== 'string') return pairingUnavailable();
  await cleanupApprovalState(db);
  return pairingJson({
    accepted: true,
    code: 'PAIRING_PENDING',
    status: 'Pending',
    requestId: data.requestId,
    matchCode: data.matchCode,
    expiresAt: data.expiresAt,
    pollAfterSeconds: 15,
    reused: data.reused === true,
  });
}

async function pollRequest(input: z.infer<typeof statusSchema>, db: DatabaseClient) {
  const { data, error } = await db.rpc('poll_license_installation_approval', {
    p_request_id: input.requestId,
    p_poll_proof_hash: hashPairingPollProof(input.pollProof),
  });
  if (error) return pairingDatabaseError(error);
  if (!isRecord(data)) return pairingUnavailable();
  if (data.found !== true) return pairingJson({ found: false, code: 'INVALID_PAIRING_REQUEST' }, 404);
  const status = typeof data.status === 'string' ? data.status : '';
  if (status !== 'Pending' && !terminalStatuses.includes(status as typeof terminalStatuses[number])) return pairingUnavailable();
  const expectedCode: Record<string, string> = {
    Pending: 'PAIRING_PENDING',
    Approved: 'PAIRING_APPROVED',
    Rejected: 'PAIRING_REJECTED',
    Expired: 'PAIRING_EXPIRED',
    Superseded: 'PAIRING_SUPERSEDED',
  };
  if (data.code !== expectedCode[status]) return pairingUnavailable();
  if (status !== 'Pending') await cleanupApprovalState(db);
  return pairingJson({
    found: true,
    code: expectedCode[status],
    status,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    resolvedAt: typeof data.resolvedAt === 'string' ? data.resolvedAt : null,
    pollAfterSeconds: status === 'Pending' ? 15 : 0,
  });
}

function invalidRequest() {
  return pairingJson({ accepted: false, code: 'INVALID_REQUEST' }, 400);
}

function pairingDatabaseError(error: { code?: string; message?: string; details?: string } | null | undefined) {
  if (isMissingLicenseRuntimeSchema(error)) {
    return pairingJson({ accepted: false, code: 'PAIRING_MIGRATION_REQUIRED' }, 503);
  }
  return pairingUnavailable();
}

function pairingUnavailable() {
  return pairingJson({ accepted: false, code: 'PAIRING_UNAVAILABLE' }, 503);
}

async function cleanupApprovalState(db: DatabaseClient) {
  // Supabase RPC calls are separate transactions. Running housekeeping only
  // after an authenticated create/poll keeps its row locks out of the binding
  // transaction and prevents unauthenticated traffic from forcing cleanup work.
  try { await db.rpc('cleanup_license_installation_approval_state'); } catch { /* best-effort retention */ }
}

function pairingJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
