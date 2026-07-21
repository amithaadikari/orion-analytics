import { describe, expect, it } from 'vitest';
import { tradingTelemetrySchema } from '@/lib/trading-telemetry';
import {
  hashTradingTelemetryPayload,
  isMissingTradingTelemetrySchema,
  parseTradingTelemetryResult,
} from '@/lib/trading-telemetry-server';

describe('trading telemetry server helpers', () => {
  it('hashes canonical payload content independently of object key order', () => {
    const payload = tradingTelemetrySchema.parse(samplePayload());
    const reordered = Object.fromEntries(Object.entries(payload).reverse()) as typeof payload;
    expect(hashTradingTelemetryPayload(reordered)).toBe(hashTradingTelemetryPayload(payload));
  });

  it('accepts only flat, whitelisted database acknowledgements', () => {
    expect(parseTradingTelemetryResult({
      accepted: true,
      code: 'ACCEPTED',
      serverTime: '2026-08-04T00:00:00Z',
      ackDealTimeMsc: '1720000000000',
      ackDealTicket: '9001',
      sendAfterSeconds: 60,
      internalClientId: 'ignored',
    })).toEqual({
      accepted: true,
      code: 'ACCEPTED',
      serverTime: '2026-08-04T00:00:00Z',
      ackDealTimeMsc: '1720000000000',
      ackDealTicket: '9001',
      sendAfterSeconds: 60,
    });
    expect(parseTradingTelemetryResult({ accepted: false, code: 'SQL_ERROR', serverTime: '2026-08-04T00:00:00Z', ackDealTimeMsc: '0', ackDealTicket: '0', sendAfterSeconds: 60 })).toBeNull();
  });

  it('treats the additive execution-activity RPC as a pending telemetry migration', () => {
    expect(isMissingTradingTelemetrySchema({
      code: 'PGRST202',
      message: 'Could not find the function public.read_orion_trade_execution_activity in the schema cache',
    })).toBe(true);
  });
});

function samplePayload() {
  return {
    schemaVersion: 1,
    requestId: 'a'.repeat(64),
    sequence: '1',
    sentAt: '1785801600',
    auth: {
      licenseKey: 'ORN-ACDE-FGHJ-KLMN-PQRT',
      accountNumber: '12345678',
      brokerServer: 'Broker-Demo',
      platform: 'MT5',
      accountType: 'Demo',
      installationId: 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
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
    openPositions: { snapshotId: 'b'.repeat(64), observedAt: '1785801600', complete: true, items: [] },
    closedDeals: { cursor: { timeMsc: '0', dealTicket: '0' }, items: [] },
  };
}
