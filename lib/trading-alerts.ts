import {
  canonicalTradingAnalyticsPlan,
  type TradingAnalyticsPlan,
} from '@/lib/trading-analytics';

export type TradingAlertPreferences = {
  connectionHealth: boolean;
  finalClose: boolean;
  tradeOpened: boolean;
  partialClose: boolean;
  dailyLossEnabled: boolean;
  dailyLossLimit: number | null;
  drawdownEnabled: boolean;
  drawdownPercent: number | null;
  equityFloorEnabled: boolean;
  equityFloor: number | null;
};

export type TradingAlertAccess = {
  plan: TradingAnalyticsPlan;
  connectionHealth: boolean;
  finalClose: boolean;
  advancedEvents: boolean;
  riskGuardrails: boolean;
};

export type TradingAlertSnapshot = {
  generatedAt: string;
  connection: {
    id: string;
    plan: TradingAnalyticsPlan;
    platform: 'MT4' | 'MT5';
    accountType: 'Demo' | 'Real';
    maskedAccountNumber: string;
    brokerServer: string;
    currency: string;
  };
  access: TradingAlertAccess;
  preferences: TradingAlertPreferences;
  monitoring: {
    activeRules: number;
    activeBreaches: number;
    lastEvaluatedAt: string | null;
    lastAlertAt: string | null;
  };
};

export type TradingAlertEvaluationResult = {
  ok: true;
  runId: string;
  evaluatedAt: string;
  scopesEvaluated: number;
  dealsEvaluated: number;
  alertsCreated: number;
  notificationsCreated: number;
  statesOpened: number;
  statesResolved: number;
  eventsDeduplicated: number;
};

const baseAccess: Omit<TradingAlertAccess, 'plan'> = {
  connectionHealth: false,
  finalClose: false,
  advancedEvents: false,
  riskGuardrails: false,
};

export function tradingAlertAccess(plan: unknown): TradingAlertAccess {
  const canonical = canonicalTradingAnalyticsPlan(plan);
  if (canonical === 'Basic') {
    return {
      plan: canonical,
      connectionHealth: true,
      finalClose: true,
      advancedEvents: false,
      riskGuardrails: false,
    };
  }
  if (canonical === 'Premium' || canonical === 'Lifetime') {
    return {
      plan: canonical,
      connectionHealth: true,
      finalClose: true,
      advancedEvents: true,
      riskGuardrails: true,
    };
  }
  return { plan: 'Free', ...baseAccess };
}

export function defaultTradingAlertPreferences(plan: unknown, connectionHealth = true): TradingAlertPreferences {
  const access = tradingAlertAccess(plan);
  return {
    connectionHealth: access.connectionHealth && connectionHealth,
    finalClose: access.finalClose,
    tradeOpened: access.advancedEvents,
    partialClose: access.advancedEvents,
    dailyLossEnabled: false,
    dailyLossLimit: null,
    drawdownEnabled: false,
    drawdownPercent: null,
    equityFloorEnabled: false,
    equityFloor: null,
  };
}

export function activeTradingAlertRuleCount(preferences: TradingAlertPreferences, access: TradingAlertAccess) {
  return [
    access.connectionHealth && preferences.connectionHealth,
    access.finalClose && preferences.finalClose,
    access.advancedEvents && preferences.tradeOpened,
    access.advancedEvents && preferences.partialClose,
    access.riskGuardrails && preferences.dailyLossEnabled,
    access.riskGuardrails && preferences.drawdownEnabled,
    access.riskGuardrails && preferences.equityFloorEnabled,
  ].filter(Boolean).length;
}

export function isTradingAlertSnapshot(value: unknown): value is TradingAlertSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Partial<TradingAlertSnapshot>;
  const connection = snapshot.connection;
  const access = snapshot.access;
  const preferences = snapshot.preferences;
  const monitoring = snapshot.monitoring;
  if (typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt))) return false;
  if (!connection || typeof connection.id !== 'string' || typeof connection.maskedAccountNumber !== 'string'
    || typeof connection.brokerServer !== 'string' || typeof connection.currency !== 'string'
    || !['Free', 'Basic', 'Premium', 'Lifetime'].includes(connection.plan)
    || !['MT4', 'MT5'].includes(connection.platform) || !['Demo', 'Real'].includes(connection.accountType)) return false;
  if (!access || !['Free', 'Basic', 'Premium', 'Lifetime'].includes(access.plan)
    || connection.plan !== access.plan
    || !booleanValues(access, ['connectionHealth', 'finalClose', 'advancedEvents', 'riskGuardrails'])) return false;
  if (!preferences || !booleanValues(preferences, [
    'connectionHealth', 'finalClose', 'tradeOpened', 'partialClose',
    'dailyLossEnabled', 'drawdownEnabled', 'equityFloorEnabled',
  ])) return false;
  if (![preferences.dailyLossLimit, preferences.drawdownPercent, preferences.equityFloor]
    .every((item) => item === null || (typeof item === 'number' && Number.isFinite(item) && item > 0))) return false;
  if (!monitoring) return false;
  return Number.isInteger(monitoring.activeRules) && monitoring.activeRules >= 0
    && Number.isInteger(monitoring.activeBreaches) && monitoring.activeBreaches >= 0
    && nullableTimestamp(monitoring.lastEvaluatedAt)
    && nullableTimestamp(monitoring.lastAlertAt);
}

export function isTradingAlertEvaluationResult(value: unknown): value is TradingAlertEvaluationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.ok !== true || typeof result.runId !== 'string' || !uuid(result.runId)
    || typeof result.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(result.evaluatedAt))) return false;
  return [
    'scopesEvaluated', 'dealsEvaluated', 'alertsCreated', 'notificationsCreated',
    'statesOpened', 'statesResolved', 'eventsDeduplicated',
  ].every((key) => Number.isInteger(result[key]) && Number(result[key]) >= 0);
}

function booleanValues(value: object, keys: string[]) {
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === 'boolean');
}

function nullableTimestamp(value: unknown) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
