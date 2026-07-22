import { z } from 'zod';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { getPortalSession } from '@/lib/portal-session';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  loadClientTradingAlerts,
  publicTradingAlertsError,
  updateClientTradingAlerts,
} from '@/lib/trading-alerts-server';

export const dynamic = 'force-dynamic';

const connectionSchema = z.string().uuid();
const moneyThreshold = z.number().finite().min(0.01).max(1_000_000_000_000).nullable();
const preferencePatchSchema = z.object({
  connectionHealth: z.boolean().optional(),
  finalClose: z.boolean().optional(),
  tradeOpened: z.boolean().optional(),
  partialClose: z.boolean().optional(),
  dailyLossEnabled: z.boolean().optional(),
  dailyLossLimit: moneyThreshold.optional(),
  drawdownEnabled: z.boolean().optional(),
  drawdownPercent: z.number().finite().min(1).max(90).nullable().optional(),
  equityFloorEnabled: z.boolean().optional(),
  equityFloor: moneyThreshold.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Choose at least one alert setting to update.');
const updateSchema = z.object({
  connectionId: connectionSchema,
  preferences: preferencePatchSchema,
}).strict();

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== 'connectionId')) {
    return jsonError('Invalid trading alert request', 400);
  }
  const parsed = connectionSchema.safeParse(url.searchParams.get('connectionId'));
  if (!parsed.success) return jsonError('A valid trading connection is required', 400);

  try {
    const snapshot = await loadClientTradingAlerts(createSupabaseAdminClient(), session.client.id, parsed.data);
    return Response.json(snapshot, { headers: responseHeaders });
  } catch (error) {
    const mapped = publicTradingAlertsError(error);
    return jsonError(mapped.message, mapped.status);
  }
}

export async function PATCH(request: Request) {
  if (!isExactSameOrigin(request)) return jsonError('Origin not allowed', 403);
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return jsonError('JSON content is required', 415);
  }
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);
  if (!accountSecurityRateLimit(request, session.user.id, { scope: 'trading-alerts', limit: 20 })) {
    return jsonError('Too many alert-setting updates. Please wait before trying again.', 429);
  }

  let body: unknown;
  try { body = await readJson(request, 6_000); } catch { return jsonError('Invalid trading alert update'); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid trading alert update');

  try {
    const snapshot = await updateClientTradingAlerts(
      createSupabaseAdminClient(),
      session.client.id,
      parsed.data.connectionId,
      parsed.data.preferences,
    );
    return Response.json(snapshot, { headers: responseHeaders });
  } catch (error) {
    const mapped = publicTradingAlertsError(error);
    return jsonError(mapped.message, mapped.status);
  }
}
