import 'server-only';

import type { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  normalizeTradingAnalyticsRange,
  type TradingAnalyticsPlan,
  type TradingAnalyticsRange,
  type TradingConnectionSummary,
} from '@/lib/trading-analytics';
import {
  tradingPerformanceAccess,
  type TradingPerformanceBreakdownItem,
  type TradingPerformanceDataQuality,
  type TradingPerformanceMetrics,
  type TradingPerformanceReport,
  type TradingPerformanceSnapshot,
} from '@/lib/trading-performance';
import { maskTradingAccount } from '@/lib/trading-accounts';
import { isMissingTradingTelemetrySchema } from '@/lib/trading-telemetry-server';

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;
type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export type TradingPerformanceQuery = {
  connectionId?: string;
  range?: TradingAnalyticsRange;
};

type LicenseRow = {
  id: string;
  plan?: string | null;
  platform?: string | null;
  status?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  binding_version?: number | null;
  trading_account_id?: string | null;
  created_at?: string | null;
};

type ScopeRow = {
  id: string;
  client_id: string;
  license_id: string;
  platform: string;
  account_type: string;
  account_number: string;
  broker_server: string;
};

type StreamRow = {
  account_scope_id: string;
  license_id: string;
  binding_version: number;
  status: string;
  last_seen_at: string | null;
  last_captured_at: string | null;
  currency?: string | null;
};

export async function loadClientTradingPerformance(
  db: DatabaseClient,
  clientId: string,
  query: TradingPerformanceQuery,
): Promise<TradingPerformanceSnapshot> {
  const now = new Date();
  const [clientResult, licenseResult, scopeResult, streamResult, installationResult, demoResult, realResult] = await Promise.all([
    db.from('clients').select('id,status').eq('id', clientId).maybeSingle(),
    db.from('licenses').select('id,plan,platform,status,expires_at,revoked_at,binding_version,trading_account_id,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
    db.from('orion_telemetry_account_scopes').select('id,client_id,license_id,platform,account_type,account_number,broker_server').eq('client_id', clientId).order('last_seen_at', { ascending: false }).limit(200),
    db.from('orion_telemetry_streams').select('account_scope_id,license_id,binding_version,status,last_seen_at,last_captured_at,currency').eq('client_id', clientId).order('last_seen_at', { ascending: false }).limit(300),
    db.from('license_installations').select('id,license_id,installation_hint,status').eq('client_id', clientId).eq('status', 'Active').limit(200),
    db.from('license_demo_accounts').select('id,license_id,account_number,broker_server,platform,status').eq('client_id', clientId).eq('status', 'Active').limit(200),
    db.from('client_trading_accounts').select('id,account_number,broker_server,platform,status,verified_at,account_type').eq('client_id', clientId).eq('account_type', 'Real').eq('status', 'Active').limit(20),
  ]);
  const bootstrapError = clientResult.error || licenseResult.error || scopeResult.error || streamResult.error
    || installationResult.error || demoResult.error || realResult.error;
  if (bootstrapError) throw performanceDatabaseError(bootstrapError);
  if (!clientResult.data) throw publicError('CLIENT_NOT_FOUND', 404);

  const clientActive = clientResult.data.status === 'Active';
  const licenses = (licenseResult.data || []) as LicenseRow[];
  const activeLicenses = clientActive ? licenses.filter((license) => isLicenseActive(license, now)) : [];
  const activeLicenseById = new Map(activeLicenses.map((license) => [license.id, license]));
  const installations = new Map((installationResult.data || []).map((row) => [row.license_id, row]));
  const scopes = (scopeResult.data || []) as ScopeRow[];
  const activeStreams = ((streamResult.data || []) as StreamRow[]).filter((stream) => {
    const license = activeLicenseById.get(stream.license_id);
    return stream.status === 'Active' && Boolean(license)
      && stream.binding_version === Number(license?.binding_version || 0);
  });
  const latestStreamByScope = new Map<string, StreamRow>();
  for (const stream of activeStreams) {
    if (!latestStreamByScope.has(stream.account_scope_id)) latestStreamByScope.set(stream.account_scope_id, stream);
  }

  const connections = scopes.flatMap((scope): TradingConnectionSummary[] => {
    const stream = latestStreamByScope.get(scope.id);
    const license = activeLicenseById.get(scope.license_id);
    if (!stream || !license || stream.license_id !== scope.license_id || scope.client_id !== clientId) return [];
    return [{
      id: scope.id,
      plan: planValue(license.plan),
      platform: scope.platform === 'MT4' ? 'MT4' : 'MT5',
      accountType: scope.account_type === 'Real' ? 'Real' : 'Demo',
      maskedAccountNumber: maskTradingAccount(scope.account_number),
      brokerServer: scope.broker_server,
      installationHint: String(installations.get(scope.license_id)?.installation_hint || 'Paired'),
    }];
  });

  if (query.connectionId && !connections.some((connection) => connection.id === query.connectionId)) {
    throw publicError('CONNECTION_NOT_FOUND', 404);
  }

  const selectedConnection = query.connectionId
    ? connections.find((connection) => connection.id === query.connectionId)
    : connections[0];
  const selectedScope = selectedConnection ? scopes.find((scope) => scope.id === selectedConnection.id) : undefined;
  const selectedStream = selectedScope ? latestStreamByScope.get(selectedScope.id) : undefined;
  const selectedLicense = selectedScope ? activeLicenseById.get(selectedScope.license_id) : activeLicenses[0];
  const plan = planValue(selectedLicense?.plan);
  const access = tradingPerformanceAccess(plan);
  const range = normalizeTradingAnalyticsRange(query.range, plan);
  const start = rangeStart(range, now);
  const period = { range, label: rangeLabel(range), timeZone: 'UTC' as const };

  if (!selectedScope || !selectedStream || !selectedConnection) {
    const runtimeReady = activeLicenses.some((license) => {
      const hasInstallation = installations.has(license.id);
      const hasReal = Boolean(license.trading_account_id && (realResult.data || []).some((row) => (
        row.id === license.trading_account_id && row.verified_at
      )));
      const hasDemo = (demoResult.data || []).some((row) => row.license_id === license.id);
      return hasInstallation && (hasReal || hasDemo);
    });
    return emptyPerformanceSnapshot({
      now,
      access,
      period,
      availability: clientActive && runtimeReady ? 'waiting_first_sync' : 'setup_required',
      connections: waitingConnections(activeLicenses, installations, demoResult.data || [], realResult.data || []),
    });
  }

  const result = await db.rpc('read_orion_performance_intelligence', {
    p_client_id: clientId,
    p_account_scope_id: selectedScope.id,
    p_since: start?.toISOString() || null,
    p_until: now.toISOString(),
  });
  if (result.error) throw performanceDatabaseError(result.error);
  const parsed = parsePerformanceIntelligencePayload(result.data);
  if (!parsed) throw publicError('DATABASE_ERROR', 500);
  if (parsed.dataQuality.mixedHistoricalCurrenciesDetected || !parsed.dataQuality.currencyEvidenceComplete) {
    throw publicError('MIXED_CURRENCY', 409);
  }
  const currency = normalizedCurrency(selectedStream.currency);
  const reportCarriesMoney = parsed.report.overview.closedTrades > 0
    || parsed.report.overview.maxDrawdownMoney !== null;
  if (!currency
    || (reportCarriesMoney && !parsed.reportCurrency)
    || (parsed.reportCurrency && parsed.reportCurrency !== currency)) {
    throw publicError('MIXED_CURRENCY', 409);
  }

  const performance = entitlePerformanceReport(parsed.report, access.advancedMetrics, access.breakdowns);
  return {
    generatedAt: now.toISOString(),
    dataAsOf: selectedStream.last_captured_at || selectedStream.last_seen_at || null,
    access,
    connections,
    selectedConnectionId: selectedScope.id,
    availability: 'ready',
    connection: {
      state: connectionState(selectedStream.last_seen_at, now),
      lastSeenAt: selectedStream.last_seen_at,
      label: connectionLabel(connectionState(selectedStream.last_seen_at, now)),
    },
    account: { currency },
    period,
    dataQuality: parsed.dataQuality,
    performance: {
      ...performance,
      window: { startAt: start?.toISOString() || null, endAt: now.toISOString() },
    },
  };
}

export function parsePerformanceIntelligencePayload(value: unknown): {
  report: Omit<TradingPerformanceReport, 'window'>;
  dataQuality: TradingPerformanceDataQuality;
  reportCurrency: string | null;
} | null {
  const payload = recordValue(value);
  const overview = recordValue(payload?.overview);
  const rawMetrics = recordValue(payload?.metrics);
  const rawBreakdowns = recordValue(payload?.breakdowns);
  const rawQuality = recordValue(payload?.dataQuality);
  if (!payload || !overview || !rawMetrics || !rawBreakdowns || !rawQuality
    || !Array.isArray(payload.calendar) || payload.calendar.length > 2_000) return null;

  const realizedNet = strictNumeric(overview.realizedNet);
  const winRate = nullableBoundedNumeric(overview.winRate, 0, 100);
  const profitFactor = nullableNonNegativeNumeric(overview.profitFactor);
  const maxDrawdownMoney = nullableNonNegativeNumeric(overview.maxDrawdownMoney);
  const maxDrawdownPercent = nullableNonNegativeNumeric(overview.maxDrawdownPercent);
  const closedTrades = strictInteger(overview.closedTrades, 0);
  if (realizedNet === null || winRate === undefined || profitFactor === undefined
    || maxDrawdownMoney === undefined || maxDrawdownPercent === undefined || closedTrades === null) return null;

  const averageWin = nullableNonNegativeNumeric(rawMetrics.averageWin);
  const averageLoss = nullableNonPositiveNumeric(rawMetrics.averageLoss);
  const expectancy = nullableAnyNumeric(rawMetrics.expectancy);
  const bestTrade = nullableAnyNumeric(rawMetrics.bestTrade);
  const worstTrade = nullableAnyNumeric(rawMetrics.worstTrade);
  const maxWinStreak = nullableInteger(rawMetrics.maxWinStreak, 1);
  const maxLossStreak = nullableInteger(rawMetrics.maxLossStreak, 1);
  if (averageWin === undefined || averageLoss === undefined || expectancy === undefined
    || bestTrade === undefined || worstTrade === undefined || maxWinStreak === undefined
    || maxLossStreak === undefined
    || (maxWinStreak !== null && maxWinStreak > closedTrades)
    || (maxLossStreak !== null && maxLossStreak > closedTrades)
    || (bestTrade !== null && worstTrade !== null && bestTrade < worstTrade)) return null;

  const calendar = parseCalendar(payload.calendar);
  const symbols = parseBreakdown(rawBreakdowns.symbols, 200);
  const directions = parseBreakdown(rawBreakdowns.directions, 2);
  const weekdays = parseBreakdown(rawBreakdowns.weekdays, 7);
  const sessions = parseBreakdown(rawBreakdowns.sessions, 4);
  if (!calendar || !symbols || !directions || !weekdays || !sessions) return null;
  const totals = performanceTotals(calendar);
  if (totals.closedTrades !== closedTrades
    || !approximatelyEqual(totals.netProfit, realizedNet)
    || !nullablePercentMatches(winRate, totals.wins, totals.closedTrades)
    || !breakdownCovers(symbols, totals)
    || !breakdownCovers(directions, totals)
    || !breakdownCovers(weekdays, totals)
    || !breakdownCovers(sessions, totals)
    || !hasUniqueAllowedKeys(directions, ['buy', 'sell'])
    || !hasUniqueAllowedKeys(weekdays, ['1', '2', '3', '4', '5', '6', '7'])
    || !hasUniqueAllowedKeys(sessions, ['asia', 'london', 'new-york', 'late-utc'])
    || new Set(symbols.map((item) => item.key)).size !== symbols.length) return null;

  const coverageStart = rawQuality.coverageStart === null ? null : validTimestamp(rawQuality.coverageStart);
  const equityCoverageStart = rawQuality.equityCoverageStart === null ? null : validTimestamp(rawQuality.equityCoverageStart);
  const reportCurrency = rawQuality.reportCurrency === null ? null : normalizedCurrency(rawQuality.reportCurrency);
  if (rawQuality.partialClosesRolledIntoFinalClose !== true
    || typeof rawQuality.incompleteHistoryExcluded !== 'boolean'
    || typeof rawQuality.volumeMismatchExcluded !== 'boolean'
    || typeof rawQuality.nettingReversalsExcluded !== 'boolean'
    || typeof rawQuality.mixedHistoricalCurrenciesDetected !== 'boolean'
    || typeof rawQuality.currencyEvidenceComplete !== 'boolean'
    || coverageStart === undefined
    || equityCoverageStart === undefined
    || typeof rawQuality.equityCoverageComplete !== 'boolean'
    || reportCurrency === undefined
    || rawQuality.calendarBasis !== 'FINAL_CLOSE_UTC'
    || rawQuality.weekdayBasis !== 'FINAL_CLOSE_UTC'
    || rawQuality.sessionBasis !== 'ENTRY_TIME_UTC_FIXED_WINDOWS') return null;

  return {
    report: {
      overview: {
        realizedNet,
        winRate,
        profitFactor,
        maxDrawdownMoney,
        maxDrawdownPercent,
        closedTrades,
      },
      metrics: {
        averageWin,
        averageLoss,
        expectancy,
        bestTrade,
        worstTrade,
        maxWinStreak,
        maxLossStreak,
      },
      calendar,
      breakdowns: { symbols, directions, weekdays, sessions },
    },
    dataQuality: {
      partialClosesRolledIntoFinalClose: rawQuality.partialClosesRolledIntoFinalClose,
      incompleteHistoryExcluded: rawQuality.incompleteHistoryExcluded,
      volumeMismatchExcluded: rawQuality.volumeMismatchExcluded,
      nettingReversalsExcluded: rawQuality.nettingReversalsExcluded,
      mixedHistoricalCurrenciesDetected: rawQuality.mixedHistoricalCurrenciesDetected,
      currencyEvidenceComplete: rawQuality.currencyEvidenceComplete,
      coverageStart,
      equityCoverageStart,
      equityCoverageComplete: rawQuality.equityCoverageComplete,
      calendarBasis: 'FINAL_CLOSE_UTC',
      weekdayBasis: 'FINAL_CLOSE_UTC',
      sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS',
    },
    reportCurrency,
  };
}

function entitlePerformanceReport(
  report: Omit<TradingPerformanceReport, 'window'>,
  advancedMetrics: boolean,
  breakdowns: boolean,
): Omit<TradingPerformanceReport, 'window'> {
  if (advancedMetrics && breakdowns) return report;
  return {
    overview: {
      ...report.overview,
      profitFactor: null,
      maxDrawdownMoney: null,
      maxDrawdownPercent: null,
    },
    metrics: lockedMetrics(),
    calendar: report.calendar,
    breakdowns: { symbols: [], directions: [], weekdays: [], sessions: [] },
  };
}

function emptyPerformanceSnapshot({ now, access, period, availability, connections }: {
  now: Date;
  access: TradingPerformanceSnapshot['access'];
  period: TradingPerformanceSnapshot['period'];
  availability: 'setup_required' | 'waiting_first_sync';
  connections: TradingConnectionSummary[];
}): TradingPerformanceSnapshot {
  return {
    generatedAt: now.toISOString(),
    dataAsOf: null,
    access,
    connections,
    selectedConnectionId: null,
    availability,
    connection: { state: 'never', lastSeenAt: null, label: 'No successful synchronization received' },
    account: null,
    period,
    dataQuality: emptyDataQuality(),
    performance: null,
  };
}

function waitingConnections(
  licenses: LicenseRow[],
  installations: Map<string, { installation_hint?: unknown }>,
  demos: Array<Record<string, unknown>>,
  realAccounts: Array<Record<string, unknown>>,
): TradingConnectionSummary[] {
  return licenses.flatMap((license): TradingConnectionSummary[] => {
    const installation = installations.get(license.id);
    if (!installation) return [];
    const demo = demos.find((row) => row.license_id === license.id);
    const real = realAccounts.find((row) => row.id === license.trading_account_id && row.verified_at);
    const account = real || demo;
    if (!account) return [];
    return [{
      id: license.id,
      plan: planValue(license.plan),
      platform: license.platform === 'MT4' ? 'MT4' : 'MT5',
      accountType: real ? 'Real' : 'Demo',
      maskedAccountNumber: maskTradingAccount(String(account.account_number || '')),
      brokerServer: String(account.broker_server || ''),
      installationHint: String(installation.installation_hint || 'Paired'),
    }];
  });
}

function parseCalendar(value: unknown[]): TradingPerformanceReport['calendar'] | null {
  const calendar: TradingPerformanceReport['calendar'] = [];
  let previous = '';
  for (const rawDay of value) {
    const day = recordValue(rawDay);
    const date = day && validDateKey(day.date);
    const netProfit = day && strictNumeric(day.netProfit);
    const closedTrades = day && strictInteger(day.closedTrades, 1);
    const wins = day && strictInteger(day.wins, 0);
    const losses = day && strictInteger(day.losses, 0);
    const breakeven = day && strictInteger(day.breakeven, 0);
    if (!day || !date || date <= previous || netProfit === null || closedTrades === null
      || wins === null || losses === null || breakeven === null
      || wins + losses + breakeven !== closedTrades) return null;
    previous = date;
    calendar.push({ date, netProfit, closedTrades, wins, losses, breakeven });
  }
  return calendar;
}

function parseBreakdown(value: unknown, maximum: number): TradingPerformanceBreakdownItem[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const items: TradingPerformanceBreakdownItem[] = [];
  for (const rawItem of value) {
    const item = recordValue(rawItem);
    const key = item && safeLabel(item.key);
    const label = item && safeLabel(item.label);
    const netProfit = item && strictNumeric(item.netProfit);
    const closedTrades = item && strictInteger(item.closedTrades, 1);
    const wins = item && strictInteger(item.wins, 0);
    const losses = item && strictInteger(item.losses, 0);
    const breakeven = item && strictInteger(item.breakeven, 0);
    const winRate = item && nullableBoundedNumeric(item.winRate, 0, 100);
    const averageNet = item && strictNumeric(item.averageNet);
    if (!item || !key || !label || netProfit === null || closedTrades === null || wins === null
      || losses === null || breakeven === null || winRate === undefined || averageNet === null
      || wins + losses + breakeven !== closedTrades
      || !nullablePercentMatches(winRate, wins, closedTrades)
      || !approximatelyEqual(averageNet, netProfit / closedTrades)) return null;
    items.push({ key, label, netProfit, closedTrades, wins, losses, breakeven, winRate, averageNet });
  }
  return items;
}

function breakdownCovers(
  items: TradingPerformanceBreakdownItem[],
  expected: { closedTrades: number; wins: number; losses: number; breakeven: number; netProfit: number },
) {
  const actual = performanceTotals(items);
  return actual.closedTrades === expected.closedTrades
    && actual.wins === expected.wins
    && actual.losses === expected.losses
    && actual.breakeven === expected.breakeven
    && approximatelyEqual(actual.netProfit, expected.netProfit);
}

function performanceTotals(items: Array<{
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netProfit: number;
}>) {
  return items.reduce((total, item) => ({
    closedTrades: total.closedTrades + item.closedTrades,
    wins: total.wins + item.wins,
    losses: total.losses + item.losses,
    breakeven: total.breakeven + item.breakeven,
    netProfit: total.netProfit + item.netProfit,
  }), { closedTrades: 0, wins: 0, losses: 0, breakeven: 0, netProfit: 0 });
}

function hasUniqueAllowedKeys(items: TradingPerformanceBreakdownItem[], allowed: string[]) {
  const keys = items.map((item) => item.key);
  return new Set(keys).size === keys.length && keys.every((key) => allowed.includes(key));
}

function nullablePercentMatches(value: number | null, wins: number, closedTrades: number) {
  if (!closedTrades) return value === null;
  return value !== null && approximatelyEqual(value, wins / closedTrades * 100);
}

function approximatelyEqual(left: number, right: number) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
}

function lockedMetrics(): TradingPerformanceMetrics {
  return {
    averageWin: null,
    averageLoss: null,
    expectancy: null,
    bestTrade: null,
    worstTrade: null,
    maxWinStreak: null,
    maxLossStreak: null,
  };
}

function emptyDataQuality(): TradingPerformanceDataQuality {
  return {
    partialClosesRolledIntoFinalClose: true,
    incompleteHistoryExcluded: false,
    volumeMismatchExcluded: false,
    nettingReversalsExcluded: false,
    mixedHistoricalCurrenciesDetected: false,
    currencyEvidenceComplete: true,
    coverageStart: null,
    equityCoverageStart: null,
    equityCoverageComplete: true,
    calendarBasis: 'FINAL_CLOSE_UTC',
    weekdayBasis: 'FINAL_CLOSE_UTC',
    sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS',
  };
}

function planValue(value: unknown): TradingAnalyticsPlan {
  if (value === 'Lifetime') return 'Lifetime';
  if (value === 'Premium') return 'Premium';
  if (value === 'Basic') return 'Basic';
  return 'Free';
}

function isLicenseActive(license: LicenseRow, now: Date) {
  if (license.status !== 'Active' || license.revoked_at) return false;
  if (!license.expires_at) return true;
  const expiry = Date.parse(license.expires_at);
  return Number.isFinite(expiry) && expiry >= now.getTime();
}

function normalizedCurrency(value: unknown) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{3,8}$/.test(currency) ? currency : undefined;
}

function rangeStart(range: TradingAnalyticsRange, now: Date) {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const currentUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(currentUtcDay - (days - 1) * 86_400_000);
}

function rangeLabel(range: TradingAnalyticsRange) {
  return range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : range === '90d' ? 'Last 90 days' : range === '365d' ? 'Last year' : 'All recorded history';
}

function connectionState(lastSeenAt: string | null, now: Date): TradingPerformanceSnapshot['connection']['state'] {
  if (!lastSeenAt || !Number.isFinite(Date.parse(lastSeenAt))) return 'never';
  const age = Math.max(0, now.getTime() - Date.parse(lastSeenAt));
  if (age <= 180_000) return 'online';
  if (age <= 600_000) return 'delayed';
  return 'offline';
}

function connectionLabel(state: TradingPerformanceSnapshot['connection']['state']) {
  if (state === 'online') return 'EA connected';
  if (state === 'delayed') return 'EA update delayed';
  if (state === 'offline') return 'EA offline';
  return 'Awaiting first sync';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strictNumeric(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strictInteger(value: unknown, minimum: number) {
  const parsed = strictNumeric(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function nullableInteger(value: unknown, minimum: number): number | null | undefined {
  if (value === null) return null;
  const parsed = strictInteger(value, minimum);
  return parsed === null ? undefined : parsed;
}

function nullableAnyNumeric(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = strictNumeric(value);
  return parsed === null ? undefined : parsed;
}

function nullableNonNegativeNumeric(value: unknown): number | null | undefined {
  const parsed = nullableAnyNumeric(value);
  return parsed === undefined || parsed === null || parsed >= 0 ? parsed : undefined;
}

function nullableNonPositiveNumeric(value: unknown): number | null | undefined {
  const parsed = nullableAnyNumeric(value);
  return parsed === undefined || parsed === null || parsed <= 0 ? parsed : undefined;
}

function nullableBoundedNumeric(value: unknown, minimum: number, maximum: number): number | null | undefined {
  const parsed = nullableAnyNumeric(value);
  return parsed === undefined || parsed === null || (parsed >= minimum && parsed <= maximum) ? parsed : undefined;
}

function safeLabel(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 80 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

function validDateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function validTimestamp(value: unknown): string | null | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function performanceDatabaseError(error: DatabaseError) {
  if (isMissingTradingTelemetrySchema(error)) return publicError('PERFORMANCE_MIGRATION_REQUIRED', 503);
  return publicError('DATABASE_ERROR', 500);
}

function publicError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}

export function publicTradingPerformanceError(error: unknown) {
  const known = error as { code?: string; status?: number };
  if (known?.code === 'CONNECTION_NOT_FOUND') return { status: 404, message: 'The selected trading connection was not found.' };
  if (known?.code === 'CLIENT_NOT_FOUND') return { status: 404, message: 'The linked Orion client account was not found.' };
  if (known?.code === 'MIXED_CURRENCY') return { status: 409, message: 'Performance reporting is unavailable because multiple account currencies were detected.' };
  if (known?.code === 'PERFORMANCE_MIGRATION_REQUIRED') return { status: 503, message: 'Performance Intelligence is waiting for the latest database migration.' };
  return { status: Number.isInteger(known?.status) ? Number(known.status) : 500, message: 'Performance Intelligence is temporarily unavailable.' };
}
