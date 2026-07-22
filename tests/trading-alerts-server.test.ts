import { describe, expect, it, vi } from 'vitest';
import {
  loadClientTradingAlerts,
  updateClientTradingAlerts,
} from '@/lib/trading-alerts-server';
import type { TradingAlertPreferences } from '@/lib/trading-alerts';

describe('trading alert preference caller semantics', () => {
  it('does not mark connection health explicit when a full UI patch changes only final close', async () => {
    const { db, rpc } = alertDatabase();
    const patch: TradingAlertPreferences = {
      ...storedPreferences,
      finalClose: false,
    };

    await updateClientTradingAlerts(db as never, 'client-1', 'scope-1', patch);

    expect(rpc).toHaveBeenCalledWith('set_orion_trading_alert_preferences', expect.objectContaining({
      p_connection_health: true,
      p_connection_health_changed: false,
      p_final_close: false,
    }));
  });

  it('marks connection health explicit only when its effective value changes', async () => {
    const { db, rpc } = alertDatabase();

    await updateClientTradingAlerts(db as never, 'client-1', 'scope-1', {
      connectionHealth: false,
    });

    expect(rpc).toHaveBeenCalledWith('set_orion_trading_alert_preferences', expect.objectContaining({
      p_connection_health: false,
      p_connection_health_changed: true,
    }));
  });

  it('fails closed when the selected scope has no current active stream', async () => {
    const { db, rpc } = alertDatabase({ stream: null });

    await expect(loadClientTradingAlerts(db as never, 'client-1', 'scope-1'))
      .rejects.toMatchObject({ code: 'CONNECTION_NOT_FOUND', status: 404 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

const storedPreferences: TradingAlertPreferences = {
  connectionHealth: true,
  finalClose: true,
  tradeOpened: true,
  partialClose: true,
  dailyLossEnabled: false,
  dailyLossLimit: null,
  drawdownEnabled: false,
  drawdownPercent: null,
  equityFloorEnabled: false,
  equityFloor: null,
};

function alertDatabase(options: { stream?: Record<string, unknown> | null } = {}) {
  const stream = options.stream === undefined ? {
    currency: 'USD',
    binding_version: 2,
    status: 'Active',
    last_seen_at: '2026-07-21T12:00:00Z',
  } : options.stream;
  const responses: Record<string, { data: unknown; error: null; count?: number }> = {
    orion_telemetry_account_scopes: {
      data: {
        id: 'scope-1', client_id: 'client-1', license_id: 'license-1', platform: 'MT5',
        account_type: 'Real', account_number: '12345678', broker_server: 'Broker-Live',
        last_seen_at: '2026-07-21T12:00:00Z', created_at: '2026-07-21T10:00:00Z',
      },
      error: null,
    },
    licenses: {
      data: {
        id: 'license-1', client_id: 'client-1', plan: 'Premium', status: 'Active',
        expires_at: null, revoked_at: null, binding_version: 2,
      },
      error: null,
    },
    orion_telemetry_streams: { data: stream, error: null },
    client_trading_alert_preferences: {
      data: {
        connection_health: true, final_close: true, trade_opened: true, partial_close: true,
        daily_loss_enabled: false, daily_loss_limit: null, drawdown_enabled: false,
        drawdown_percent: null, equity_floor_enabled: false, equity_floor: null,
      },
      error: null,
    },
    client_trading_alert_states: { data: null, error: null, count: 0 },
    client_trading_alert_events: { data: null, error: null },
    client_trading_alert_runs: { data: null, error: null },
  };
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

  return {
    db: {
      from: vi.fn((table: string) => databaseQuery(responses[table])),
      rpc,
    },
    rpc,
  };
}

function databaseQuery(response: { data: unknown; error: null; count?: number } | undefined) {
  if (!response) throw new Error('Unexpected database table');
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order', 'limit']) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve(response));
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(response).then(resolve, reject)
  );
  return query;
}
