import { z } from 'zod';
import { hashLicenseKey, licenseKeyVersion, normalizeLicenseKey } from '@/lib/license-keys';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { installationIdPattern, normalizeInstallationId } from '@/lib/license-runtime';
import { hashInstallationId, isMissingLicenseRuntimeSchema } from '@/lib/license-runtime-server';

export const dynamic = 'force-dynamic';

const validationSchema = z.object({
  licenseKey: z.string().trim().min(8).max(120),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/),
  brokerServer: z.string().trim().min(2).max(160),
  platform: z.enum(['MT4', 'MT5']),
  accountType: z.enum(['Demo', 'Real']),
  installationId: z.string().transform(normalizeInstallationId).pipe(z.string().regex(installationIdPattern)),
}).strict();

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return jsonError('JSON content is required', 415);
  }
  if (!rateLimit(request, 'license-binding-validation').allowed) return jsonError('Too many license validation requests', 429);
  let body: unknown = null;
  try { body = await readJson(request, 2_000); } catch { return invalidRequest(); }
  const parsed = validationSchema.safeParse(body);
  if (!parsed.success) return invalidRequest();
  const normalizedKey = normalizeLicenseKey(parsed.data.licenseKey);
  if (!licenseKeyVersion(normalizedKey)) return invalidLicense();

  const { data, error } = await createSupabaseAdminClient().rpc('validate_orion_license_runtime', {
    p_key_hash: hashLicenseKey(normalizedKey),
    p_account_number: parsed.data.accountNumber,
    p_broker_server: parsed.data.brokerServer,
    p_platform: parsed.data.platform,
    p_account_type: parsed.data.accountType,
    p_installation_hash: hashInstallationId(parsed.data.installationId),
  });
  if (error) {
    return jsonError(
      isMissingLicenseRuntimeSchema(error)
        ? 'License validation is waiting for the latest database migration.'
        : 'License validation is temporarily unavailable.',
      503,
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return jsonError('License validation is temporarily unavailable.', 503);
  if (!isExpectedValidationResponse(data as Record<string, unknown>, parsed.data.accountType, parsed.data.platform)) {
    return jsonError('License validation is temporarily unavailable.', 503);
  }
  return Response.json({ ...data, revalidateAfterSeconds: 300 }, { headers: validationHeaders() });
}

function invalidRequest() {
  return Response.json({ valid: false, code: 'INVALID_REQUEST', revalidateAfterSeconds: 300 }, { status: 400, headers: validationHeaders() });
}

function invalidLicense() {
  return Response.json({ valid: false, code: 'INVALID_LICENSE', revalidateAfterSeconds: 300 }, { headers: validationHeaders() });
}

function validationHeaders() {
  return { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
}

function isExpectedValidationResponse(data: Record<string, unknown>, accountType: 'Demo' | 'Real', platform: 'MT4' | 'MT5') {
  if (data.valid === false) return typeof data.code === 'string' && data.code.length > 0;
  return data.valid === true
    && data.code === 'VALID'
    && data.accountType === accountType
    && data.platform === platform
    && ['Basic', 'Premium', 'Lifetime'].includes(String(data.plan || ''))
    && Number.isInteger(data.bindingVersion)
    && Number(data.bindingVersion) >= 0
    && typeof data.validatedAt === 'string'
    && (data.expiresAt === null || typeof data.expiresAt === 'string');
}
