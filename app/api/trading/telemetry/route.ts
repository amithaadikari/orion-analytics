import { hashLicenseKey, normalizeLicenseKey } from '@/lib/license-keys';
import { hashInstallationId } from '@/lib/license-runtime-server';
import { getClientIp, hashIp, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  TELEMETRY_BODY_MAX_BYTES,
  tradingTelemetrySchema,
  type TradingTelemetryAck,
} from '@/lib/trading-telemetry';
import {
  hashTradingTelemetryPayload,
  isMissingTradingTelemetrySchema,
  migrationTelemetryAck,
  parseTradingTelemetryResult,
  tradingTelemetryStatus,
  unavailableTelemetryAck,
} from '@/lib/trading-telemetry-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return telemetryJson(invalidAck(), 415);
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > TELEMETRY_BODY_MAX_BYTES) {
    return telemetryJson(invalidAck(), 413);
  }
  if (!rateLimit(request, 'trading-telemetry').allowed) {
    return telemetryJson(rateLimitAck(), 429);
  }

  let body: unknown;
  try {
    body = await readJson(request, TELEMETRY_BODY_MAX_BYTES);
  } catch {
    return telemetryJson(invalidAck(), 400);
  }
  const parsed = tradingTelemetrySchema.safeParse(body);
  if (!parsed.success) return telemetryJson(invalidAck(), 400);
  const input = parsed.data;
  const cursor = input.closedDeals.cursor;
  const normalizedKey = normalizeLicenseKey(input.auth.licenseKey);
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc('ingest_orion_trading_telemetry', {
    p_key_hash: hashLicenseKey(normalizedKey),
    p_account_number: input.auth.accountNumber,
    p_broker_server: input.auth.brokerServer,
    p_platform: input.auth.platform,
    p_account_type: input.auth.accountType,
    p_installation_hash: hashInstallationId(input.auth.installationId),
    p_binding_version: input.auth.bindingVersion,
    p_request_id: input.requestId,
    p_sequence: input.sequence,
    p_sent_at: input.sentAt,
    p_payload_hash: hashTradingTelemetryPayload(input),
    p_request_ip_hash: hashIp(getClientIp(request)),
    p_heartbeat: input.heartbeat,
    p_account_snapshot: input.accountSnapshot,
    p_open_positions: input.openPositions,
    p_closed_deals: input.closedDeals,
  });

  if (error) {
    return telemetryJson(
      isMissingTradingTelemetrySchema(error) ? migrationTelemetryAck(cursor) : unavailableTelemetryAck(cursor),
      503,
    );
  }
  const result = parseTradingTelemetryResult(data);
  if (!result) return telemetryJson(unavailableTelemetryAck(cursor), 503);
  return telemetryJson(result, tradingTelemetryStatus(result));
}

function invalidAck(): TradingTelemetryAck {
  return {
    accepted: false,
    code: 'INVALID_REQUEST',
    serverTime: new Date().toISOString(),
    ackDealTimeMsc: '0',
    ackDealTicket: '0',
    sendAfterSeconds: 300,
  };
}

function rateLimitAck(): TradingTelemetryAck {
  return {
    accepted: false,
    code: 'TELEMETRY_RATE_LIMIT',
    serverTime: new Date().toISOString(),
    ackDealTimeMsc: '0',
    ackDealTicket: '0',
    sendAfterSeconds: 60,
  };
}

function telemetryJson(payload: TradingTelemetryAck, status: number) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
