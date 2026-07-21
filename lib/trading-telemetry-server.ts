import 'server-only';

import { createHash } from 'node:crypto';
import type { TradingTelemetryAck, TradingTelemetryPayload } from '@/lib/trading-telemetry';

type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

const publicRejectCodes = new Set([
  'INVALID_REQUEST',
  'INVALID_LICENSE',
  'LICENSE_INACTIVE',
  'INSTALLATION_NOT_REGISTERED',
  'INSTALLATION_MISMATCH',
  'ACCOUNT_NOT_REGISTERED',
  'ACCOUNT_MISMATCH',
  'DEMO_ACCOUNT_NOT_REGISTERED',
  'DEMO_ACCOUNT_MISMATCH',
  'BINDING_CHANGED',
  'STALE_SEQUENCE',
  'REQUEST_ID_CONFLICT',
  'PAYLOAD_TIME_INVALID',
  'POSITION_SNAPSHOT_CONFLICT',
  'DEAL_CONFLICT',
  'TELEMETRY_RATE_LIMIT',
]);

export function hashTradingTelemetryPayload(payload: TradingTelemetryPayload) {
  return createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

export function parseTradingTelemetryResult(value: unknown): TradingTelemetryAck | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const accepted = data.accepted;
  const code = data.code;
  const serverTime = data.serverTime;
  const ackDealTimeMsc = data.ackDealTimeMsc;
  const ackDealTicket = data.ackDealTicket;
  const sendAfterSeconds = data.sendAfterSeconds;
  if (typeof accepted !== 'boolean'
    || typeof code !== 'string'
    || typeof serverTime !== 'string'
    || !isDecimal(ackDealTimeMsc)
    || !isDecimal(ackDealTicket)
    || !Number.isInteger(sendAfterSeconds)
    || Number(sendAfterSeconds) < 0
    || Number(sendAfterSeconds) > 86_400) return null;
  if (accepted ? code !== 'ACCEPTED' : !publicRejectCodes.has(code)) return null;
  if (!Number.isFinite(Date.parse(serverTime))) return null;
  return {
    accepted,
    code,
    serverTime,
    ackDealTimeMsc,
    ackDealTicket,
    sendAfterSeconds: Number(sendAfterSeconds),
  };
}

export function tradingTelemetryStatus(result: TradingTelemetryAck) {
  if (result.accepted) return 200;
  if (result.code === 'TELEMETRY_RATE_LIMIT') return 429;
  if (['BINDING_CHANGED', 'STALE_SEQUENCE', 'REQUEST_ID_CONFLICT', 'POSITION_SNAPSHOT_CONFLICT', 'DEAL_CONFLICT'].includes(result.code)) return 409;
  if (result.code === 'INVALID_REQUEST' || result.code === 'PAYLOAD_TIME_INVALID') return 400;
  // Authentication/binding decisions deliberately match the existing license
  // validation endpoint: the EA receives a machine code without an existence-
  // revealing HTTP distinction.
  return 200;
}

export function unavailableTelemetryAck(cursor?: { timeMsc: string; dealTicket: string }): TradingTelemetryAck {
  return {
    accepted: false,
    code: 'TELEMETRY_UNAVAILABLE',
    serverTime: new Date().toISOString(),
    ackDealTimeMsc: cursor?.timeMsc || '0',
    ackDealTicket: cursor?.dealTicket || '0',
    sendAfterSeconds: 60,
  };
}

export function migrationTelemetryAck(cursor?: { timeMsc: string; dealTicket: string }): TradingTelemetryAck {
  return { ...unavailableTelemetryAck(cursor), code: 'TELEMETRY_MIGRATION_REQUIRED', sendAfterSeconds: 300 };
}

export function isMissingTradingTelemetrySchema(error: DatabaseError) {
  const code = String(error?.code || '').toLowerCase();
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (['42p01', '42703', '42883', 'pgrst202', 'pgrst204', 'pgrst205'].includes(code)) {
    return [
      'orion_telemetry_',
      'ingest_orion_trading_telemetry',
      'read_orion_trading_equity',
      'read_orion_trading_performance',
      'cleanup_orion_trading_telemetry',
    ].some((name) => message.includes(name));
  }
  return false;
}

function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  throw new TypeError('Unsupported telemetry value');
}
