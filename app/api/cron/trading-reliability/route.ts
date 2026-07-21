import { getEnv } from '@/lib/env';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  isMissingTradingReliabilitySchema,
  isTradingReliabilityEvaluationResult,
} from '@/lib/trading-reliability';

export const dynamic = 'force-dynamic';

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return jsonError('Unauthorized', 401);
  }

  const { data, error } = await createSupabaseAdminClient().rpc('evaluate_orion_trading_reliability');
  if (error) {
    return jsonError(
      isMissingTradingReliabilitySchema(error)
        ? 'Trading reliability is waiting for the latest database migration.'
        : 'Trading reliability evaluation is temporarily unavailable.',
      503,
    );
  }
  if (!isTradingReliabilityEvaluationResult(data) || !data.ok) {
    return jsonError('Trading reliability evaluation is temporarily unavailable.', 503);
  }
  return Response.json(data, { headers: responseHeaders });
}
