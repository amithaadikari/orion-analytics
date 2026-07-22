import 'server-only';

import type { createSupabaseAdminClient } from '@/lib/supabase/server';
import { maskTradingAccount } from '@/lib/trading-accounts';
import {
  activeTradingAlertRuleCount,
  defaultTradingAlertPreferences,
  tradingAlertAccess,
  type TradingAlertPreferences,
  type TradingAlertSnapshot,
} from '@/lib/trading-alerts';

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;
type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export type TradingAlertPreferencePatch = Partial<TradingAlertPreferences>;

type ScopeRow = {
  id: string;
  client_id: string;
  license_id: string;
  platform: string;
  account_type: string;
  account_number: string;
  broker_server: string;
  last_seen_at?: string | null;
  created_at?: string | null;
};

type LicenseRow = {
  id: string;
  client_id: string;
  plan: string;
  status: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  binding_version?: number | null;
};

type PreferenceRow = {
  connection_health: boolean;
  final_close: boolean;
  trade_opened: boolean;
  partial_close: boolean;
  daily_loss_enabled: boolean;
  daily_loss_limit?: number | string | null;
  drawdown_enabled: boolean;
  drawdown_percent?: number | string | null;
  equity_floor_enabled: boolean;
  equity_floor?: number | string | null;
};

export async function loadClientTradingAlerts(
  db: DatabaseClient,
  clientId: string,
  connectionId: string,
): Promise<TradingAlertSnapshot> {
  const now = new Date();
  const scopeResult = await db.from('orion_telemetry_account_scopes')
    .select('id,client_id,license_id,platform,account_type,account_number,broker_server,last_seen_at,created_at')
    .eq('id', connectionId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (scopeResult.error) throw tradingAlertsDatabaseError(scopeResult.error);
  if (!scopeResult.data) throw knownError('CONNECTION_NOT_FOUND', 404);
  const scope = scopeResult.data as ScopeRow;

  const [licenseResult, latestScopeResult, streamResult, preferenceResult, breachResult, eventResult, runResult] = await Promise.all([
    db.from('licenses')
      .select('id,client_id,plan,status,expires_at,revoked_at,binding_version')
      .eq('id', scope.license_id)
      .eq('client_id', clientId)
      .maybeSingle(),
    db.from('orion_telemetry_account_scopes')
      .select('id')
      .eq('client_id', clientId)
      .eq('license_id', scope.license_id)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    db.from('orion_telemetry_streams')
      .select('currency,binding_version,status,last_seen_at')
      .eq('client_id', clientId)
      .eq('license_id', scope.license_id)
      .eq('account_scope_id', scope.id)
      .eq('status', 'Active')
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('client_trading_alert_preferences')
      .select('connection_health,final_close,trade_opened,partial_close,daily_loss_enabled,daily_loss_limit,drawdown_enabled,drawdown_percent,equity_floor_enabled,equity_floor')
      .eq('client_id', clientId)
      .eq('account_scope_id', scope.id)
      .maybeSingle(),
    db.from('client_trading_alert_states')
      .select('alert_type', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('account_scope_id', scope.id)
      .eq('active', true),
    db.from('client_trading_alert_events')
      .select('created_at')
      .eq('client_id', clientId)
      .eq('account_scope_id', scope.id)
      .eq('notification_suppressed', false)
      .not('notification_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('client_trading_alert_runs')
      .select('completed_at,status')
      .eq('status', 'Succeeded')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const error = licenseResult.error || latestScopeResult.error || streamResult.error || preferenceResult.error
    || breachResult.error || eventResult.error || runResult.error;
  if (error) throw tradingAlertsDatabaseError(error);
  if (!licenseResult.data || !licenseActive(licenseResult.data as LicenseRow, now)) {
    throw knownError('LICENSE_NOT_ACTIVE', 403);
  }
  const license = licenseResult.data as LicenseRow;
  const stream = streamResult.data;
  if (!stream || Number(stream.binding_version) !== Number(license.binding_version || 0)) {
    throw knownError('CONNECTION_NOT_FOUND', 404);
  }

  const access = tradingAlertAccess(license.plan);
  const isLatestScope = latestScopeResult.data?.id === scope.id;
  const preferences = preferenceResult.data
    ? mapPreferences(preferenceResult.data as PreferenceRow)
    : defaultTradingAlertPreferences(access.plan, isLatestScope);
  const currency = normalizedCurrency(stream?.currency);

  return {
    generatedAt: now.toISOString(),
    connection: {
      id: scope.id,
      plan: access.plan,
      platform: scope.platform === 'MT4' ? 'MT4' : 'MT5',
      accountType: scope.account_type === 'Real' ? 'Real' : 'Demo',
      maskedAccountNumber: maskTradingAccount(scope.account_number),
      brokerServer: scope.broker_server,
      currency,
    },
    access,
    preferences,
    monitoring: {
      activeRules: activeTradingAlertRuleCount(preferences, access),
      activeBreaches: Math.max(0, Number(breachResult.count || 0)),
      lastEvaluatedAt: timestampOrNull(runResult.data?.completed_at),
      lastAlertAt: timestampOrNull(eventResult.data?.created_at),
    },
  };
}

export async function updateClientTradingAlerts(
  db: DatabaseClient,
  clientId: string,
  connectionId: string,
  patch: TradingAlertPreferencePatch,
): Promise<TradingAlertSnapshot> {
  const current = await loadClientTradingAlerts(db, clientId, connectionId);
  const advancedKeys: Array<keyof TradingAlertPreferences> = [
    'tradeOpened', 'partialClose', 'dailyLossEnabled', 'dailyLossLimit',
    'drawdownEnabled', 'drawdownPercent', 'equityFloorEnabled', 'equityFloor',
  ];
  if (!current.access.advancedEvents && advancedKeys.some((key) => Object.hasOwn(patch, key))) {
    throw knownError('PREMIUM_REQUIRED', 403);
  }

  const preferences = { ...current.preferences, ...patch };
  validateThresholds(preferences);
  const connectionHealthChanged = Object.hasOwn(patch, 'connectionHealth')
    && patch.connectionHealth !== current.preferences.connectionHealth;
  const { data, error } = await db.rpc('set_orion_trading_alert_preferences', {
    p_client_id: clientId,
    p_account_scope_id: connectionId,
    p_connection_health: preferences.connectionHealth,
    p_connection_health_changed: connectionHealthChanged,
    p_final_close: preferences.finalClose,
    p_trade_opened: preferences.tradeOpened,
    p_partial_close: preferences.partialClose,
    p_daily_loss_enabled: preferences.dailyLossEnabled,
    p_daily_loss_limit: preferences.dailyLossLimit,
    p_drawdown_enabled: preferences.drawdownEnabled,
    p_drawdown_percent: preferences.drawdownPercent,
    p_equity_floor_enabled: preferences.equityFloorEnabled,
    p_equity_floor: preferences.equityFloor,
    p_risk_currency: current.connection.currency,
  });
  if (error) throw tradingAlertsDatabaseError(error);
  if (!isPreferenceMutationResult(data)) throw knownError('DATABASE_ERROR', 500);
  return loadClientTradingAlerts(db, clientId, connectionId);
}

function mapPreferences(row: PreferenceRow): TradingAlertPreferences {
  return {
    connectionHealth: row.connection_health === true,
    finalClose: row.final_close === true,
    tradeOpened: row.trade_opened === true,
    partialClose: row.partial_close === true,
    dailyLossEnabled: row.daily_loss_enabled === true,
    dailyLossLimit: positiveNumeric(row.daily_loss_limit),
    drawdownEnabled: row.drawdown_enabled === true,
    drawdownPercent: positiveNumeric(row.drawdown_percent),
    equityFloorEnabled: row.equity_floor_enabled === true,
    equityFloor: positiveNumeric(row.equity_floor),
  };
}

function validateThresholds(preferences: TradingAlertPreferences) {
  if (preferences.dailyLossEnabled && !preferences.dailyLossLimit) throw knownError('INVALID_PREFERENCES', 400);
  if (preferences.drawdownEnabled && !preferences.drawdownPercent) throw knownError('INVALID_PREFERENCES', 400);
  if (preferences.equityFloorEnabled && !preferences.equityFloor) throw knownError('INVALID_PREFERENCES', 400);
  if (preferences.drawdownPercent !== null && (preferences.drawdownPercent < 1 || preferences.drawdownPercent > 90)) {
    throw knownError('INVALID_PREFERENCES', 400);
  }
}

function licenseActive(license: LicenseRow, now: Date) {
  if (license.status !== 'Active' || license.revoked_at) return false;
  if (!license.expires_at) return true;
  const expiry = Date.parse(license.expires_at);
  return Number.isFinite(expiry) && expiry >= now.getTime();
}

function positiveNumeric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizedCurrency(value: unknown) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9]{3,8}$/.test(currency) ? currency : 'USD';
}

function timestampOrNull(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function isPreferenceMutationResult(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).ok === true);
}

function knownError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}

function tradingAlertsDatabaseError(error: DatabaseError) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toUpperCase();
  if (isMissingTradingAlertsSchema(error)) return knownError('ALERTS_MIGRATION_REQUIRED', 503);
  if (message.includes('TRADING_ALERT_SCOPE_NOT_FOUND')) return knownError('CONNECTION_NOT_FOUND', 404);
  if (message.includes('TRADING_ALERT_CONNECTION_NOT_ACTIVE')) return knownError('CONNECTION_NOT_FOUND', 404);
  if (message.includes('TRADING_ALERT_LICENSE_NOT_ACTIVE')) return knownError('LICENSE_NOT_ACTIVE', 403);
  if (message.includes('INVALID_TRADING_ALERT_PREFERENCES')) return knownError('INVALID_PREFERENCES', 400);
  return knownError('DATABASE_ERROR', 500);
}

export function isMissingTradingAlertsSchema(error: DatabaseError) {
  const code = String(error?.code || '').toUpperCase();
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (!['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)) return false;
  return [
    'client_trading_alert_preferences',
    'client_trading_alert_states',
    'client_trading_alert_events',
    'client_trading_alert_runs',
    'set_orion_trading_alert_preferences',
    'evaluate_orion_trading_alerts',
  ].some((name) => message.includes(name));
}

export function publicTradingAlertsError(error: unknown) {
  const known = error as { code?: string; status?: number };
  if (known?.code === 'CONNECTION_NOT_FOUND') return { status: 404, message: 'The selected trading connection was not found.' };
  if (known?.code === 'LICENSE_NOT_ACTIVE') return { status: 403, message: 'This trading connection does not have an active Orion license.' };
  if (known?.code === 'PREMIUM_REQUIRED') return { status: 403, message: 'Premium or Lifetime is required for advanced trading alerts.' };
  if (known?.code === 'INVALID_PREFERENCES') return { status: 400, message: 'Review the enabled alert thresholds and try again.' };
  if (known?.code === 'ALERTS_MIGRATION_REQUIRED') return { status: 503, message: 'Trading alerts are waiting for the latest database migration.' };
  return { status: Number.isInteger(known?.status) ? Number(known.status) : 500, message: 'Trading alerts are temporarily unavailable.' };
}
