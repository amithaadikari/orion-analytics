import { describe, expect, it } from 'vitest';
import {
  classifyTradingReliabilityRejections,
  classifyTradingReliabilityStream,
  isTradingReliabilityEvaluationResult,
  tradingReliabilityDedupeKey,
} from '@/lib/trading-reliability';

describe('trading reliability helpers', () => {
  const now = new Date('2026-07-21T12:10:00Z');

  it('uses a strict ten-minute offline boundary', () => {
    expect(classifyTradingReliabilityStream({ lastSeenAt: '2026-07-21T12:00:00Z', openPositions: 0 }, now)).toBeNull();
    expect(classifyTradingReliabilityStream({ lastSeenAt: '2026-07-21T11:59:59Z', openPositions: 0 }, now)).toEqual({
      incidentType: 'offline_stream', severity: 'warning',
    });
  });

  it('makes an offline stream with last-reported exposure critical', () => {
    expect(classifyTradingReliabilityStream({ lastSeenAt: '2026-07-21T11:50:00Z', openPositions: 2 }, now)).toEqual({
      incidentType: 'offline_with_open_positions', severity: 'critical',
    });
  });

  it('opens a rejection spike at the inclusive threshold', () => {
    expect(classifyTradingReliabilityRejections(24)).toBeNull();
    expect(classifyTradingReliabilityRejections(25)).toEqual({ incidentType: 'rejection_spike', severity: 'high' });
  });

  it('builds deterministic scoped and global dedupe keys', () => {
    const streamId = 'A41B6C3D-155D-4AB6-9A69-D9C814F82F31';
    expect(tradingReliabilityDedupeKey('offline_with_open_positions', streamId))
      .toBe('stream:a41b6c3d-155d-4ab6-9a69-d9c814f82f31:offline-with-open-positions');
    expect(tradingReliabilityDedupeKey('offline_stream', streamId))
      .toBe('stream:a41b6c3d-155d-4ab6-9a69-d9c814f82f31:offline');
    expect(tradingReliabilityDedupeKey('rejection_spike')).toBe('global:telemetry-rejection-spike');
    expect(() => tradingReliabilityDedupeKey('offline_stream', 'raw-account-number')).toThrow();
    expect(() => tradingReliabilityDedupeKey('rejection_spike', streamId)).toThrow();
  });

  it('accepts only complete sanitized evaluator results', () => {
    expect(isTradingReliabilityEvaluationResult({
      ok: true,
      runId: '2b67576b-e87f-4ab6-b216-cbed291e0c15',
      evaluatedAt: '2026-07-21T12:10:00Z',
      streamsEvaluated: 5,
      offlineWithOpenPositions: 1,
      offlineStreams: 2,
      rejectionsWindow: 3,
      rejectionSpikes: 0,
      incidentsDetected: 3,
      incidentsOpened: 1,
      incidentsRefreshed: 2,
      incidentsResolved: 0,
    })).toBe(true);
    expect(isTradingReliabilityEvaluationResult({ ok: true, runId: 'not-an-id', evaluatedAt: 'now' })).toBe(false);
  });
});
