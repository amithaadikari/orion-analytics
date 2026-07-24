import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/security';
import { isTradingAnalyticsRange } from '@/lib/trading-analytics';
import {
  loadClientTradingPerformance,
  publicTradingPerformanceError,
} from '@/lib/trading-performance-server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  connectionId: z.string().uuid().optional(),
  range: z.string().refine(isTradingAnalyticsRange).optional(),
}).strict();

export async function GET(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !['connectionId', 'range'].includes(key))) {
    return jsonError('Invalid performance request', 400);
  }
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return jsonError('Invalid performance request', 400);

  try {
    const payload = await loadClientTradingPerformance(
      createSupabaseAdminClient(),
      session.client.id,
      parsed.data,
    );
    return Response.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const mapped = publicTradingPerformanceError(error);
    return jsonError(mapped.message, mapped.status);
  }
}
