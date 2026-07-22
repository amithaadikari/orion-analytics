import { getEnv } from '@/lib/env';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isTradingAlertEvaluationResult } from '@/lib/trading-alerts';
import { isMissingTradingAlertsSchema } from '@/lib/trading-alerts-server';

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

  const { data, error } = await createSupabaseAdminClient().rpc('evaluate_orion_trading_alerts');
  if (error) {
    return jsonError(
      isMissingTradingAlertsSchema(error)
        ? 'Trading alerts are waiting for the latest database migration.'
        : 'Trading alert evaluation is temporarily unavailable.',
      503,
    );
  }
  if (!isTradingAlertEvaluationResult(data)) {
    return jsonError('Trading alert evaluation is temporarily unavailable.', 503);
  }
  return Response.json(data, { headers: responseHeaders });
}
