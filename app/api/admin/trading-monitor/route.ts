import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { loadAdminTradingMonitor, publicAdminTradingMonitorError } from '@/lib/admin-trading-monitor-server';
import {
  buildEaVersionAdoption,
  type AdminTradingMonitorItem,
  type AdminTradingReliabilityIncident,
  type AdminTradingReliabilityRun,
  type AdminTradingReliabilitySnapshot,
} from '@/lib/admin-trading-monitor';
import { accountSecurityRateLimit, isExactSameOrigin } from '@/lib/client-security';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isMissingTradingReliabilitySchema } from '@/lib/trading-reliability';

export const dynamic = 'force-dynamic';

const acknowledgementSchema = z.object({
  incidentId: z.string().uuid(),
  action: z.literal('acknowledge'),
}).strict();

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.user) return jsonError('Authentication required', 401);
  if (auth.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!auth.admin) return jsonError('Administrator access required', 403);
  try {
    const db = createSupabaseAdminClient();
    const payload = await loadAdminTradingMonitor(db);
    const reliability = await loadReliability(db, payload.items, auth.admin.role === 'admin');
    return Response.json(
      { ...payload, reliability },
      { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch (error) {
    const mapped = publicAdminTradingMonitorError(error);
    return jsonError(mapped.message, mapped.status);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.user) return jsonError('Authentication required', 401);
  if (auth.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!auth.admin || auth.admin.role !== 'admin') return jsonError('Administrator write access required', 403);
  if (!isExactSameOrigin(request)) return jsonError('Origin not allowed', 403);
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return jsonError('JSON content is required', 415);
  }
  if (!accountSecurityRateLimit(request, auth.user.id, { scope: 'reliability-ack', limit: 30 })) {
    return jsonError('Too many incident updates. Please wait before trying again.', 429);
  }
  let body: unknown;
  try { body = await readJson(request, 2_000); } catch { return jsonError('Invalid acknowledgement request'); }
  const parsed = acknowledgementSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid acknowledgement request');

  const db = createSupabaseAdminClient();
  const acknowledgedAt = new Date().toISOString();
  const { data, error } = await db.from('trading_reliability_incidents')
    .update({
      acknowledged_at: acknowledgedAt,
      acknowledged_by: auth.admin.id,
      acknowledged_by_email: auth.admin.email || auth.user.email || `admin:${auth.admin.id}`,
    })
    .eq('id', parsed.data.incidentId)
    .eq('status', 'Open')
    .is('acknowledged_at', null)
    .select('id,acknowledged_at,acknowledged_by_email')
    .maybeSingle();
  if (error) {
    const migrationMissing = isMissingTradingReliabilitySchema(error);
    return jsonError(
      migrationMissing
        ? 'Reliability incident acknowledgement is waiting for the latest database migration.'
        : 'The reliability incident could not be acknowledged safely.',
      migrationMissing ? 503 : 500,
    );
  }
  if (!data) return jsonError('This incident is already acknowledged or no longer open.', 409);
  return Response.json({
    ok: true,
    incident: {
      id: String(data.id),
      acknowledgedAt: String(data.acknowledged_at),
      acknowledgedByEmail: String(data.acknowledged_by_email),
    },
  }, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function loadReliability(
  db: DatabaseClient,
  items: AdminTradingMonitorItem[],
  canAcknowledge: boolean,
): Promise<AdminTradingReliabilitySnapshot> {
  const versions = buildEaVersionAdoption(items);
  try {
    const [openIncidentResult, resolvedIncidentResult, runResult] = await Promise.all([
      db.from('trading_reliability_incidents')
        .select('id,incident_type,severity,status,account_scope_id,client_id,summary,first_detected_at,last_detected_at,resolved_at,acknowledged_at', { count: 'exact' })
        .eq('status', 'Open')
        .order('severity', { ascending: true })
        .order('last_detected_at', { ascending: false })
        .limit(100),
      db.from('trading_reliability_incidents')
        .select('id,incident_type,severity,status,account_scope_id,client_id,summary,first_detected_at,last_detected_at,resolved_at,acknowledged_at')
        .eq('status', 'Resolved')
        .order('last_detected_at', { ascending: false })
        .limit(8),
      db.from('trading_reliability_runs')
        .select('id,job_name,started_at,completed_at,status,evaluator_version,streams_evaluated,offline_with_open_positions_count,offline_stream_count,rejections_window_count,rejection_spike_count,incidents_detected,incidents_opened,incidents_refreshed,incidents_resolved,error_code,details')
        .order('started_at', { ascending: false })
        .limit(8),
    ]);
    const errors = [openIncidentResult.error, resolvedIncidentResult.error, runResult.error]
      .filter((error): error is NonNullable<typeof error> => Boolean(error));
    if (errors.length) {
      return unavailableReliability(
        versions,
        canAcknowledge,
        errors.every((error) => isMissingTradingReliabilitySchema(error))
          ? 'migration_pending'
          : 'temporarily_unavailable',
      );
    }
    const openRows = openIncidentResult.data || [];
    const resolvedRows = resolvedIncidentResult.data || [];
    const openIncidentCount = typeof openIncidentResult.count === 'number'
      ? Math.max(0, openIncidentResult.count)
      : openRows.length;
    return {
      available: true,
      unavailableReason: null,
      canAcknowledge,
      versions,
      incidents: [...openRows, ...resolvedRows]
        .map((row) => mapIncident(row as Record<string, unknown>, items)),
      openIncidentCount,
      openIncidentOverflow: openIncidentCount > openRows.length,
      runs: (runResult.data || []).map((row) => mapRun(row as Record<string, unknown>)),
    };
  } catch {
    return unavailableReliability(versions, canAcknowledge, 'temporarily_unavailable');
  }
}

function unavailableReliability(
  versions: AdminTradingReliabilitySnapshot['versions'],
  canAcknowledge: boolean,
  unavailableReason: NonNullable<AdminTradingReliabilitySnapshot['unavailableReason']>,
): AdminTradingReliabilitySnapshot {
  return {
    available: false,
    unavailableReason,
    canAcknowledge,
    versions,
    incidents: [],
    openIncidentCount: 0,
    openIncidentOverflow: false,
    runs: [],
  };
}

function mapIncident(row: Record<string, unknown>, items: AdminTradingMonitorItem[]): AdminTradingReliabilityIncident {
  const exactIdentity = items.find((item) => item.connectionId === row.account_scope_id);
  const clientIdentity = exactIdentity || items.find((item) => item.clientId === row.client_id);
  return {
    id: String(row.id || ''),
    incidentType: row.incident_type as AdminTradingReliabilityIncident['incidentType'],
    severity: row.severity as AdminTradingReliabilityIncident['severity'],
    status: row.status === 'Resolved' ? 'Resolved' : 'Open',
    summary: String(row.summary || 'Trading reliability incident'),
    clientId: typeof row.client_id === 'string' ? row.client_id : null,
    clientName: clientIdentity?.clientName || null,
    maskedAccountNumber: exactIdentity?.maskedAccountNumber || null,
    maskedLicenseKey: exactIdentity?.maskedLicenseKey || null,
    firstDetectedAt: String(row.first_detected_at || ''),
    lastDetectedAt: String(row.last_detected_at || ''),
    resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null,
    acknowledgedAt: typeof row.acknowledged_at === 'string' ? row.acknowledged_at : null,
  };
}

function mapRun(row: Record<string, unknown>): AdminTradingReliabilityRun {
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  };
  const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details)
    ? row.details as Record<string, unknown>
    : {};
  const skipped = details.skipped === true;
  return {
    id: String(row.id || ''),
    jobName: row.job_name === 'telemetry-retention' ? 'telemetry-retention' : 'reliability-evaluator',
    status: row.status === 'Failed' ? 'Failed' : row.status === 'Running' ? 'Running' : 'Succeeded',
    evaluatorVersion: typeof row.evaluator_version === 'string' ? row.evaluator_version : null,
    startedAt: String(row.started_at || ''),
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    streamsEvaluated: number(row.streams_evaluated),
    offlineWithOpenPositions: number(row.offline_with_open_positions_count),
    offlineStreams: number(row.offline_stream_count),
    rejectionWindowCount: number(row.rejections_window_count),
    rejectionSpikes: number(row.rejection_spike_count),
    incidentsDetected: number(row.incidents_detected),
    incidentsOpened: number(row.incidents_opened),
    incidentsRefreshed: number(row.incidents_refreshed),
    incidentsResolved: number(row.incidents_resolved),
    errorCode: typeof row.error_code === 'string' ? row.error_code : null,
    skipped,
    skipReason: skipped && details.reason === 'concurrent_evaluation' ? 'concurrent_evaluation' : null,
  };
}
