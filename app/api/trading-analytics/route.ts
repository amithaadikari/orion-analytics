import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/security';
import { isTradingAnalyticsRange } from '@/lib/trading-analytics';
import { loadClientTradingAnalytics, publicTradingAnalyticsError } from '@/lib/trading-analytics-server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  connectionId: z.string().uuid().optional(),
  range: z.string().refine(isTradingAnalyticsRange).optional(),
  cursor: z.string().min(8).max(240).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();

export async function GET(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);

  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  if ([...url.searchParams.keys()].some((key) => !['connectionId', 'range', 'cursor'].includes(key))) {
    return jsonError('Invalid trading analytics request', 400);
  }
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return jsonError('Invalid trading analytics request', 400);

  try {
    const payload = await loadClientTradingAnalytics(createSupabaseAdminClient(), session.client.id, parsed.data);
    return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const mapped = publicTradingAnalyticsError(error);
    return jsonError(mapped.message, mapped.status);
  }
}
