export const TRADING_RELIABILITY_OFFLINE_AFTER_SECONDS = 600;
export const TRADING_RELIABILITY_REJECTION_WINDOW_MINUTES = 15;
export const TRADING_RELIABILITY_REJECTION_SPIKE_THRESHOLD = 25;

export type TradingReliabilityIncidentType = 'offline_with_open_positions' | 'offline_stream' | 'rejection_spike';
export type TradingReliabilitySeverity = 'critical' | 'high' | 'warning';

export type TradingReliabilityClassification = {
  incidentType: TradingReliabilityIncidentType;
  severity: TradingReliabilitySeverity;
};

type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export function classifyTradingReliabilityStream(
  input: { lastSeenAt: string | null; openPositions: number },
  now = new Date(),
): TradingReliabilityClassification | null {
  if (!input.lastSeenAt) return null;
  const lastSeen = Date.parse(input.lastSeenAt);
  if (!Number.isFinite(lastSeen) || !Number.isFinite(now.getTime())) return null;
  const ageSeconds = Math.max(0, (now.getTime() - lastSeen) / 1000);
  if (ageSeconds <= TRADING_RELIABILITY_OFFLINE_AFTER_SECONDS) return null;
  if (Number.isFinite(input.openPositions) && input.openPositions > 0) {
    return { incidentType: 'offline_with_open_positions', severity: 'critical' };
  }
  return { incidentType: 'offline_stream', severity: 'warning' };
}

export function classifyTradingReliabilityRejections(count: number): TradingReliabilityClassification | null {
  if (!Number.isInteger(count) || count < TRADING_RELIABILITY_REJECTION_SPIKE_THRESHOLD) return null;
  return { incidentType: 'rejection_spike', severity: 'high' };
}

export function tradingReliabilityDedupeKey(type: TradingReliabilityIncidentType, streamId?: string) {
  if (type === 'rejection_spike') {
    if (streamId !== undefined) throw new Error('A global rejection incident cannot include a stream identifier.');
    return 'global:telemetry-rejection-spike';
  }
  const normalized = String(streamId || '').trim().toLowerCase();
  if (!isUuid(normalized)) throw new Error('A valid stream identifier is required.');
  return type === 'offline_with_open_positions'
    ? `stream:${normalized}:offline-with-open-positions`
    : `stream:${normalized}:offline`;
}

export type TradingReliabilityEvaluationResult = {
  ok: boolean;
  runId: string;
  evaluatedAt: string;
  code?: string;
  streamsEvaluated?: number;
  offlineWithOpenPositions?: number;
  offlineStreams?: number;
  rejectionsWindow?: number;
  rejectionSpikes?: number;
  incidentsDetected?: number;
  incidentsOpened?: number;
  incidentsRefreshed?: number;
  incidentsResolved?: number;
};

export function isTradingReliabilityEvaluationResult(value: unknown): value is TradingReliabilityEvaluationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.ok !== 'boolean' || !isUuid(row.runId) || !validDate(row.evaluatedAt)) return false;
  if (!row.ok) return row.code === 'EVALUATOR_FAILED';
  return [
    'streamsEvaluated', 'offlineWithOpenPositions', 'offlineStreams', 'rejectionsWindow',
    'rejectionSpikes', 'incidentsDetected', 'incidentsOpened', 'incidentsRefreshed', 'incidentsResolved',
  ].every((key) => nonNegativeInteger(row[key]));
}

export function isMissingTradingReliabilitySchema(error: DatabaseError) {
  const code = String(error?.code || '').toLowerCase();
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (!['42p01', '42703', '42883', 'pgrst202', 'pgrst204', 'pgrst205'].includes(code)) return false;
  return [
    'trading_reliability_incidents',
    'trading_reliability_runs',
    'evaluate_orion_trading_reliability',
  ].some((name) => message.includes(name));
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
