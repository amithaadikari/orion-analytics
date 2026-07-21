import { getEnv } from '@/lib/env';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isMissingTradingTelemetrySchema } from '@/lib/trading-telemetry-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return jsonError('Unauthorized', 401);
  }
  const { data, error } = await createSupabaseAdminClient().rpc('cleanup_orion_trading_telemetry');
  if (error) {
    return jsonError(
      isMissingTradingTelemetrySchema(error)
        ? 'Trading telemetry retention is waiting for the latest database migration.'
        : 'Trading telemetry retention is temporarily unavailable.',
      503,
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true) {
    return jsonError('Trading telemetry retention is temporarily unavailable.', 503);
  }
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
