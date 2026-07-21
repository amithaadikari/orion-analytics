import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  hashInstallationId: vi.fn(),
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('@/lib/license-runtime-server', () => ({ hashInstallationId: mocks.hashInstallationId }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  getClientIp: mocks.getClientIp,
  hashIp: mocks.hashIp,
}));

import { POST } from '@/app/api/trading/telemetry/route';
import { hashLicenseKey } from '@/lib/license-keys';
import { hashTradingTelemetryPayload } from '@/lib/trading-telemetry-server';
import { tradingTelemetrySchema } from '@/lib/trading-telemetry';

describe('EA trading telemetry endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 100 });
    mocks.getClientIp.mockReturnValue('203.0.113.40');
    mocks.hashIp.mockReturnValue('d'.repeat(64));
    mocks.hashInstallationId.mockReturnValue('c'.repeat(64));
  });

  it('sends one strict atomic RPC with hashed license, installation, IP and payload authority', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      accepted: true,
      code: 'ACCEPTED',
      serverTime: '2026-08-04T00:00:01Z',
      ackDealTimeMsc: '1785801599000',
      ackDealTicket: '9001',
      sendAfterSeconds: 60,
    }, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const body = samplePayload();
    const parsed = tradingTelemetrySchema.parse(body);
    const response = await POST(telemetryRequest(body));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      code: 'ACCEPTED',
      serverTime: '2026-08-04T00:00:01Z',
      ackDealTimeMsc: '1785801599000',
      ackDealTicket: '9001',
      sendAfterSeconds: 60,
    });
    expect(rpc).toHaveBeenCalledWith('ingest_orion_trading_telemetry', {
      p_key_hash: hashLicenseKey('ORN-ACDE-FGHJ-KLMN-PQRT'),
      p_account_number: '12345678',
      p_broker_server: 'Broker-Demo',
      p_platform: 'MT5',
      p_account_type: 'Demo',
      p_installation_hash: 'c'.repeat(64),
      p_binding_version: 4,
      p_request_id: 'a'.repeat(64),
      p_sequence: '81',
      p_sent_at: '1785801600',
      p_payload_hash: hashTradingTelemetryPayload(parsed),
      p_request_ip_hash: 'd'.repeat(64),
      p_heartbeat: parsed.heartbeat,
      p_account_snapshot: parsed.accountSnapshot,
      p_open_positions: parsed.openPositions,
      p_closed_deals: parsed.closedDeals,
    });
    const serializedRpc = JSON.stringify(rpc.mock.calls);
    expect(serializedRpc).not.toContain('ORN-ACDE-FGHJ-KLMN-PQRT');
    expect(serializedRpc).not.toContain('ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ');
    expect(serializedRpc).not.toContain('clientId');
    expect(serializedRpc).not.toContain('licenseId');
    expect(serializedRpc).not.toContain('plan');
  });

  it('rejects extra authority fields before database access', async () => {
    const body = { ...samplePayload(), clientId: '11111111-1111-4111-8111-111111111111', plan: 'Lifetime' };
    const response = await POST(telemetryRequest(body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, code: 'INVALID_REQUEST' });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('enforces the 100-position and 40-deal limits before database access', async () => {
    const body = samplePayload();
    body.openPositions.items = Array.from({ length: 101 }, (_, index) => openPosition(String(index + 1)));
    const response = await POST(telemetryRequest(body));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('returns a flat conflict response without exposing database details', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: {
      accepted: false,
      code: 'BINDING_CHANGED',
      serverTime: '2026-08-04T00:00:01Z',
      ackDealTimeMsc: '0',
      ackDealTicket: '0',
      sendAfterSeconds: 300,
      internalLicenseId: 'secret',
    }, error: null }) });
    const response = await POST(telemetryRequest(samplePayload()));
    expect(response.status).toBe(409);
    const result = await response.json();
    expect(result).toEqual({
      accepted: false,
      code: 'BINDING_CHANGED',
      serverTime: '2026-08-04T00:00:01Z',
      ackDealTimeMsc: '0',
      ackDealTicket: '0',
      sendAfterSeconds: 300,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('maps missing telemetry schema to a safe retry response', async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find function public.ingest_orion_trading_telemetry' },
    }) });
    const response = await POST(telemetryRequest(samplePayload()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      code: 'TELEMETRY_MIGRATION_REQUIRED',
      ackDealTimeMsc: '0',
      ackDealTicket: '0',
    });
  });
});

function samplePayload() {
  return {
    schemaVersion: 1 as const,
    requestId: 'a'.repeat(64),
    sequence: '81',
    sentAt: '1785801600',
    auth: {
      licenseKey: ' orn-acde-fghj-klmn-pqrt ',
      accountNumber: '12345678',
      brokerServer: 'Broker-Demo',
      platform: 'MT5' as const,
      accountType: 'Demo' as const,
      installationId: 'orn-inst-abcd-efgh-jklm-npqr-stuv-wxyz',
      bindingVersion: 4,
    },
    heartbeat: {
      eaVersion: '5.2.0', terminalBuild: 5320, terminalConnected: true,
      terminalTradeAllowed: true, mqlTradeAllowed: true,
      chartSymbol: 'XAUUSD', chartPeriodMinutes: 1, licenseState: 'VALID',
    },
    accountSnapshot: {
      observedAt: '1785801600', currency: 'USD', leverage: 500,
      balance: 1000, equity: 1012, credit: 0, margin: 25,
      freeMargin: 987, marginLevel: 4048, floatingProfit: 12,
    },
    openPositions: {
      snapshotId: 'b'.repeat(64), observedAt: '1785801600', complete: true as const,
      items: [] as ReturnType<typeof openPosition>[],
    },
    closedDeals: {
      cursor: { timeMsc: '0', dealTicket: '0' },
      items: [{
        dealTicket: '9001', orderTicket: '8001', positionId: '7001',
        timeMsc: '1785801599000', symbol: 'XAUUSD', side: 'Buy' as const,
        entry: 'Out' as const, reason: 'Expert', magic: '503050', volume: 0.01,
        price: 2401.25, stopLoss: 2390, takeProfit: 2420, commission: -0.2,
        swap: 0, fee: 0, profit: 4.5,
      }],
    },
  };
}

function openPosition(ticket: string) {
  return {
    positionTicket: ticket,
    positionId: ticket,
    symbol: 'XAUUSD',
    side: 'Buy' as const,
    magic: '503050',
    openedAtMsc: '1785801500000',
    volume: 0.01,
    openPrice: 2400,
    currentPrice: 2401,
    stopLoss: 2390,
    takeProfit: 2420,
    swap: 0,
    profit: 1,
  };
}

function telemetryRequest(body: unknown) {
  return new Request('https://app.orionscalper.com/api/trading/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40' },
    body: JSON.stringify(body),
  });
}
