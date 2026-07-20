import { z } from 'zod';
import { hashLicenseKey, licenseKeyVersion, normalizeLicenseKey } from '@/lib/license-keys';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isMissingTradingAccountSchema } from '@/lib/trading-accounts-server';

export const dynamic = 'force-dynamic';

const validationSchema = z.object({
  licenseKey: z.string().trim().min(8).max(120),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/),
  brokerServer: z.string().trim().min(2).max(160),
  platform: z.enum(['MT4', 'MT5']),
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

  const { data, error } = await createSupabaseAdminClient().rpc('validate_orion_license_binding', {
    p_key_hash: hashLicenseKey(normalizedKey),
    p_account_number: parsed.data.accountNumber,
    p_broker_server: parsed.data.brokerServer,
    p_platform: parsed.data.platform,
  });
  if (error) {
    return jsonError(
      isMissingTradingAccountSchema(error)
        ? 'License validation is waiting for the latest database migration.'
        : 'License validation is temporarily unavailable.',
      503,
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return jsonError('License validation is temporarily unavailable.', 503);
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
