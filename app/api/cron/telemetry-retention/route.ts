import { getEnv } from '@/lib/env';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isMissingTradingTelemetrySchema } from '@/lib/trading-telemetry-server';
import { isMissingTradingReliabilitySchema } from '@/lib/trading-reliability';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return jsonError('Unauthorized', 401);
  }
  const startedAt = new Date().toISOString();
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc('cleanup_orion_trading_telemetry');
  if (error) {
    await recordRetentionRun(db, {
      startedAt,
      status: 'Failed',
      errorCode: String(error.code || 'RETENTION_RPC_FAILED').slice(0, 80),
      errorMessage: 'Telemetry retention RPC failed.',
    });
    return jsonError(
      isMissingTradingTelemetrySchema(error)
        ? 'Trading telemetry retention is waiting for the latest database migration.'
        : 'Trading telemetry retention is temporarily unavailable.',
      503,
    );
  }
  const retentionResult = validateRetentionResult(data);
  if (!retentionResult) {
    await recordRetentionRun(db, {
      startedAt,
      status: 'Failed',
      errorCode: 'RETENTION_RESULT_INVALID',
      errorMessage: 'Telemetry retention returned an invalid result.',
    });
    return jsonError('Trading telemetry retention is temporarily unavailable.', 503);
  }
  const audit = await recordRetentionRun(db, {
    startedAt,
    status: 'Succeeded',
    details: retentionResult,
  });
  if (audit.error && !audit.migrationMissing) {
    return jsonError('Trading telemetry retention completed, but its audit record could not be saved.', 503);
  }
  return Response.json({ ...data, auditRecorded: !audit.error }, { headers: { 'Cache-Control': 'private, no-store' } });
}

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;

async function recordRetentionRun(db: DatabaseClient, input: {
  startedAt: string;
  status: 'Succeeded' | 'Failed';
  errorCode?: string;
  errorMessage?: string;
  details?: Record<string, number>;
}) {
  try {
    const { error } = await db.from('trading_reliability_runs').insert({
      job_name: 'telemetry-retention',
      started_at: input.startedAt,
      completed_at: new Date().toISOString(),
      status: input.status,
      evaluator_version: null,
      error_code: input.status === 'Failed' ? input.errorCode || 'RETENTION_FAILED' : null,
      error_message: input.status === 'Failed' ? input.errorMessage || 'Telemetry retention failed.' : null,
      details: input.details || {},
    });
    return { error, migrationMissing: isMissingTradingReliabilitySchema(error) };
  } catch {
    return { error: { code: 'AUDIT_WRITE_FAILED', message: 'Audit write failed' }, migrationMissing: false };
  }
}

const RETENTION_COUNTER_KEYS = [
  'rejectionsDeleted',
  'rateLimitsDeleted',
  'batchesDeleted',
  'snapshotsDeleted',
  'dealsDeleted',
  'positionsDeleted',
] as const;

function validateRetentionResult(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (candidate.ok !== true) return null;

  const counters: Record<string, number> = {};
  for (const key of RETENTION_COUNTER_KEYS) {
    const counter = candidate[key];
    if (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0) return null;
    counters[key] = counter;
  }

  return counters;
}
