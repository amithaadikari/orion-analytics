import 'server-only';

import { Buffer } from 'node:buffer';
import type { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  normalizeTradingAnalyticsRange,
  tradingAnalyticsEntitlement,
  type ClosedTrade,
  type TradingAnalyticsPlan,
  type TradingAnalyticsRange,
  type TradingAnalyticsSnapshot,
  type TradingConnectionSummary,
  type TradingEquityPoint,
  type TradingPosition,
} from '@/lib/trading-analytics';
import { maskLicenseKey } from '@/lib/license-runtime';
import { maskTradingAccount } from '@/lib/trading-accounts';
import { isMissingTradingTelemetrySchema } from '@/lib/trading-telemetry-server';

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;
type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export type TradingAnalyticsQuery = {
  connectionId?: string;
  range?: TradingAnalyticsRange;
  cursor?: string;
};

type LicenseRow = {
  id: string;
  license_key?: string | null;
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
  last_seen_at?: string | null;
};

type StreamRow = {
  id: string;
  account_scope_id: string;
  client_id: string;
  license_id: string;
  installation_id: string;
  binding_version: number;
  status: string;
  last_seen_at: string | null;
  last_captured_at: string | null;
  ea_version?: string | null;
  terminal_build?: number | null;
  currency?: string | null;
  balance?: number | string | null;
  equity?: number | string | null;
  margin?: number | string | null;
  margin_level?: number | string | null;
  floating_profit?: number | string | null;
  open_position_count?: number | null;
};

type DealRow = {
  deal_ticket: string;
  order_ticket: string;
  position_id: string;
  deal_time_msc: number | string;
  deal_time: string;
  symbol: string;
  side: string;
  entry: string;
  volume: number | string;
  price: number | string;
  commission: number | string;
  swap: number | string;
  fee: number | string;
  profit: number | string;
  net_profit: number | string;
};

export async function loadClientTradingAnalytics(
  db: DatabaseClient,
  clientId: string,
  query: TradingAnalyticsQuery,
): Promise<TradingAnalyticsSnapshot> {
  const now = new Date();
  const [clientResult, licenseResult, scopeResult, streamResult, installationResult, demoResult, realResult] = await Promise.all([
    db.from('clients').select('id,status,plan').eq('id', clientId).maybeSingle(),
    db.from('licenses').select('id,license_key,plan,platform,status,expires_at,revoked_at,binding_version,trading_account_id,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
    db.from('orion_telemetry_account_scopes').select('id,client_id,license_id,platform,account_type,account_number,broker_server,last_seen_at').eq('client_id', clientId).order('last_seen_at', { ascending: false }).limit(200),
    db.from('orion_telemetry_streams').select('id,account_scope_id,client_id,license_id,installation_id,binding_version,status,last_seen_at,last_captured_at,ea_version,terminal_build,currency,balance,equity,margin,margin_level,floating_profit,open_position_count').eq('client_id', clientId).order('last_seen_at', { ascending: false }).limit(300),
    db.from('license_installations').select('id,license_id,installation_hint,status').eq('client_id', clientId).eq('status', 'Active').limit(200),
    db.from('license_demo_accounts').select('id,license_id,account_number,broker_server,platform,status').eq('client_id', clientId).eq('status', 'Active').limit(200),
    db.from('client_trading_accounts').select('id,account_number,broker_server,platform,status,verified_at,account_type').eq('client_id', clientId).eq('account_type', 'Real').eq('status', 'Active').limit(20),
  ]);

  const bootstrapError = clientResult.error || licenseResult.error || scopeResult.error || streamResult.error
    || installationResult.error || demoResult.error || realResult.error;
  if (bootstrapError) throw tradingAnalyticsDatabaseError(bootstrapError);
  if (!clientResult.data) throw Object.assign(new Error('Client not found'), { code: 'CLIENT_NOT_FOUND', status: 404 });

  const licenses = (licenseResult.data || []) as LicenseRow[];
  const licenseById = new Map(licenses.map((license) => [license.id, license]));
  const installations = new Map((installationResult.data || []).map((row) => [row.license_id, row]));
  const scopes = (scopeResult.data || []) as ScopeRow[];
  const activeLicenses = licenses.filter((license) => isLicenseActive(license, now));
  const activeStreams = ((streamResult.data || []) as StreamRow[]).filter((stream) => {
    const license = licenseById.get(stream.license_id);
    return stream.status === 'Active' && Boolean(license) && isLicenseActive(license!, now)
      && stream.binding_version === Number(license?.binding_version || 0);
  });
  const latestStreamByScope = new Map<string, StreamRow>();
  for (const stream of activeStreams) if (!latestStreamByScope.has(stream.account_scope_id)) latestStreamByScope.set(stream.account_scope_id, stream);

  const connections = scopes.flatMap((scope): TradingConnectionSummary[] => {
    const stream = latestStreamByScope.get(scope.id);
    const license = licenseById.get(scope.license_id);
    if (!stream || !license) return [];
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
    throw Object.assign(new Error('Trading connection not found'), { code: 'CONNECTION_NOT_FOUND', status: 404 });
  }

  const selectedConnection = query.connectionId
    ? connections.find((connection) => connection.id === query.connectionId)
    : connections[0];
  const selectedScope = selectedConnection ? scopes.find((scope) => scope.id === selectedConnection.id) : undefined;
  const selectedStream = selectedScope ? latestStreamByScope.get(selectedScope.id) : undefined;
  const selectedLicense = selectedScope ? licenseById.get(selectedScope.license_id) : activeLicenses[0];
  const plan = planValue(selectedLicense?.plan || clientResult.data.plan);
  const range = normalizeTradingAnalyticsRange(query.range, plan);
  const entitlement = tradingAnalyticsEntitlement(plan);
  const access = {
    plan,
    allowedRanges: [...entitlement.allowedRanges],
    maxRange: entitlement.maxRange,
    advancedMetrics: entitlement.advancedMetrics,
    historyPagination: entitlement.historyPagination,
    historyPageSize: entitlement.historyPageSize,
    allHistory: entitlement.allHistory,
  };
  const period = { range, label: rangeLabel(range), timeZone: 'UTC' };

  const runtimeReady = activeLicenses.some((license) => {
    const hasInstallation = installations.has(license.id);
    const hasReal = Boolean(license.trading_account_id && (realResult.data || []).some((row) => row.id === license.trading_account_id && row.verified_at));
    const hasDemo = (demoResult.data || []).some((row) => row.license_id === license.id);
    return hasInstallation && (hasReal || hasDemo);
  });

  if (!selectedScope || !selectedStream || !selectedConnection) {
    const availability = clientResult.data.status === 'Active' && runtimeReady ? 'waiting_first_sync' : 'setup_required';
    return emptyTradingSnapshot({
      now,
      plan,
      access,
      period,
      availability,
      connections: waitingConnections(activeLicenses, installations, demoResult.data || [], realResult.data || []),
    });
  }

  const start = rangeStart(range, now);
  const cursor = query.cursor ? decodeHistoryCursor(query.cursor) : null;
  if (query.cursor && (!entitlement.historyPagination || !cursor)) {
    throw Object.assign(new Error('Invalid history cursor'), { code: 'INVALID_CURSOR', status: 400 });
  }
  const [equityResult, positionRowsResult, performanceResult] = await Promise.all([
    db.rpc('read_orion_trading_equity', {
      p_client_id: clientId,
      p_account_scope_id: selectedScope.id,
      p_since: start?.toISOString() || null,
      p_max_points: 240,
    }),
    db.from('orion_open_positions')
      .select('position_ticket,position_id,symbol,side,opened_at,volume,open_price,current_price,stop_loss,take_profit,swap,profit,observed_at')
      .eq('client_id', clientId)
      .eq('account_scope_id', selectedScope.id)
      .order('opened_at', { ascending: false })
      .limit(100),
    db.rpc('read_orion_trading_performance', {
      p_client_id: clientId,
      p_account_scope_id: selectedScope.id,
      p_since: start?.toISOString() || null,
      p_cursor_closed_at: cursor?.closedAt || null,
      p_cursor_position_id: cursor?.id || null,
      p_page_size: entitlement.historyPageSize,
    }),
  ]);
  const detailError = equityResult.error || positionRowsResult.error || performanceResult.error;
  if (detailError) throw tradingAnalyticsDatabaseError(detailError);
  const equityPayload = parseEquityPayload(equityResult.data);
  const performance = parsePerformancePayload(performanceResult.data);
  if (!equityPayload || !performance) throw Object.assign(new Error('Invalid analytics response'), { code: 'DATABASE_ERROR', status: 500 });
  const equity = equityPayload.points;
  const historyItems = performance.items;
  const hasMore = entitlement.historyPagination && performance.hasMore;
  const lastHistory = historyItems[historyItems.length - 1];
  const positions = (positionRowsResult.data || []).map((row): TradingPosition => ({
    id: String(row.position_id || row.position_ticket),
    ticket: String(row.position_ticket || ''),
    symbol: String(row.symbol || ''),
    side: row.side === 'Sell' ? 'Sell' : 'Buy',
    volume: numeric(row.volume),
    openedAt: String(row.opened_at),
    entryPrice: numeric(row.open_price),
    currentPrice: nullableNumeric(row.current_price),
    stopLoss: zeroAsNull(row.stop_loss),
    takeProfit: zeroAsNull(row.take_profit),
    floatingNet: numeric(row.profit) + numeric(row.swap),
  }));
  const currency = String(selectedStream.currency || 'USD');
  const dataAsOf = selectedStream.last_captured_at || selectedStream.last_seen_at || null;
  const state = connectionState(selectedStream.last_seen_at, now);
  const metrics = {
    realizedNet: performance.metrics.realizedNet,
    winRate: performance.metrics.winRate,
    profitFactor: entitlement.advancedMetrics ? performance.metrics.profitFactor : null,
    maxDrawdownMoney: entitlement.advancedMetrics ? equityPayload.maxDrawdownMoney : null,
    maxDrawdownPercent: entitlement.advancedMetrics ? equityPayload.maxDrawdownPercent : null,
    closedTrades: performance.metrics.closedTrades,
  };

  return {
    generatedAt: now.toISOString(),
    dataAsOf,
    access,
    connections,
    selectedConnectionId: selectedScope.id,
    availability: 'ready',
    connection: { state, lastSeenAt: selectedStream.last_seen_at, label: connectionLabel(state) },
    account: {
      currency,
      balance: nullableNumeric(selectedStream.balance),
      equity: nullableNumeric(selectedStream.equity),
      margin: nullableNumeric(selectedStream.margin),
      marginLevel: nullableNumeric(selectedStream.margin_level),
      floatingNet: nullableNumeric(selectedStream.floating_profit),
    },
    period,
    metrics,
    dataQuality: performance.dataQuality,
    summaries: entitlement.advancedMetrics ? performance.summaries : null,
    equity,
    openPositions: positions,
    history: {
      items: historyItems,
      nextCursor: hasMore && lastHistory ? encodeHistoryCursor(lastHistory) : null,
    },
  };
}

function emptyTradingSnapshot({ now, plan, access, period, availability, connections }: {
  now: Date;
  plan: TradingAnalyticsPlan;
  access: TradingAnalyticsSnapshot['access'];
  period: TradingAnalyticsSnapshot['period'];
  availability: 'setup_required' | 'waiting_first_sync';
  connections: TradingConnectionSummary[];
}): TradingAnalyticsSnapshot {
  void plan;
  return {
    generatedAt: now.toISOString(), dataAsOf: null, access, connections, selectedConnectionId: null, availability,
    connection: { state: 'never', lastSeenAt: null, label: 'No successful synchronization received' },
    account: null, period,
    metrics: { realizedNet: null, winRate: null, profitFactor: null, maxDrawdownMoney: null, maxDrawdownPercent: null, closedTrades: 0 },
    dataQuality: { nettingReversalsExcluded: false },
    summaries: null, equity: [], openPositions: [], history: { items: [], nextCursor: null },
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

export function aggregateClosedDeals(rows: DealRow[]): ClosedTrade[] {
  const groups = new Map<string, DealRow[]>();
  for (const row of rows) {
    const current = groups.get(row.position_id) || [];
    current.push(row);
    groups.set(row.position_id, current);
  }
  const trades: ClosedTrade[] = [];
  for (const [positionId, deals] of groups) {
    deals.sort((left, right) => decimalCompare(left.deal_time_msc, right.deal_time_msc));
    if (deals.some((deal) => deal.entry === 'InOut')) continue;
    const entries = deals.filter((deal) => deal.entry === 'In');
    const exits = deals.filter((deal) => ['Out', 'OutBy'].includes(deal.entry));
    if (!exits.length) continue;
    if (!entries.length) continue;
    const entry = entries[0];
    const exit = exits[exits.length - 1];
    const entryVolume = entries.reduce((total, deal) => total + numeric(deal.volume), 0);
    const exitVolume = exits.reduce((total, deal) => total + numeric(deal.volume), 0);
    trades.push({
      id: positionId,
      ticket: exit.order_ticket || exit.deal_ticket,
      symbol: entry.symbol || exit.symbol,
      side: entry.side === 'Sell' ? 'Sell' : 'Buy',
      volume: exitVolume || entryVolume,
      openedAt: entry.deal_time,
      closedAt: exit.deal_time,
      entryPrice: weightedPrice(entries.length ? entries : [entry]),
      exitPrice: weightedPrice(exits),
      profit: deals.reduce((total, deal) => total + numeric(deal.profit), 0),
      swap: deals.reduce((total, deal) => total + numeric(deal.swap), 0),
      commission: deals.reduce((total, deal) => total + numeric(deal.commission) + numeric(deal.fee), 0),
      netProfit: deals.reduce((total, deal) => total + numeric(deal.net_profit), 0),
    });
  }
  return trades.sort((left, right) => Date.parse(right.closedAt) - Date.parse(left.closedAt) || right.id.localeCompare(left.id));
}

function weightedPrice(rows: DealRow[]) {
  const volume = rows.reduce((total, row) => total + numeric(row.volume), 0);
  if (volume <= 0) return numeric(rows.at(-1)?.price);
  return rows.reduce((total, row) => total + numeric(row.price) * numeric(row.volume), 0) / volume;
}

export function parseEquityPayload(value: unknown): {
  points: TradingEquityPoint[];
  maxDrawdownMoney: number | null;
  maxDrawdownPercent: number | null;
} | null {
  const payload = recordValue(value);
  if (!payload || !Array.isArray(payload.points) || payload.points.length > 500) return null;
  const points: TradingEquityPoint[] = [];
  for (const rawPoint of payload.points) {
    const point = recordValue(rawPoint);
    const at = point && validTimestamp(point.at);
    const balance = point && strictNumeric(point.balance);
    const equity = point && strictNumeric(point.equity);
    if (!point || !at || balance === null || equity === null) return null;
    points.push({ at, balance, equity });
  }
  const maxDrawdownMoney = nullableNonNegativeNumeric(payload.maxDrawdownMoney);
  const maxDrawdownPercent = nullableNonNegativeNumeric(payload.maxDrawdownPercent);
  if (maxDrawdownMoney === undefined || maxDrawdownPercent === undefined) return null;
  return { points, maxDrawdownMoney, maxDrawdownPercent };
}

export function parsePerformancePayload(value: unknown): {
  metrics: Pick<TradingAnalyticsSnapshot['metrics'], 'realizedNet' | 'winRate' | 'profitFactor' | 'closedTrades'>;
  dataQuality: TradingAnalyticsSnapshot['dataQuality'];
  summaries: NonNullable<TradingAnalyticsSnapshot['summaries']>;
  items: ClosedTrade[];
  hasMore: boolean;
} | null {
  const payload = recordValue(value);
  const metrics = recordValue(payload?.metrics);
  const limitations = recordValue(payload?.limitations);
  const summaries = recordValue(payload?.summaries);
  if (!payload || !metrics || !limitations || !summaries || !Array.isArray(payload.items) || payload.items.length > 100
    || typeof payload.hasMore !== 'boolean' || typeof limitations.nettingReversalsExcluded !== 'boolean') return null;

  const realizedNet = strictNumeric(metrics.realizedNet);
  const winRate = nullableBoundedNumeric(metrics.winRate, 0, 100);
  const profitFactor = nullableNonNegativeNumeric(metrics.profitFactor);
  const closedTrades = strictInteger(metrics.closedTrades, 0);
  const todayNet = strictNumeric(summaries.todayNet);
  const sevenDayNet = strictNumeric(summaries.sevenDayNet);
  const thirtyDayNet = strictNumeric(summaries.thirtyDayNet);
  if (realizedNet === null || winRate === undefined || profitFactor === undefined || closedTrades === null
    || todayNet === null || sevenDayNet === null || thirtyDayNet === null) return null;

  const items: ClosedTrade[] = [];
  for (const rawItem of payload.items) {
    const item = recordValue(rawItem);
    if (!item || typeof item.id !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(item.id)
      || (item.ticket !== null && item.ticket !== undefined && typeof item.ticket !== 'string')
      || typeof item.symbol !== 'string' || !item.symbol.trim()
      || (item.side !== 'Buy' && item.side !== 'Sell')) return null;
    const openedAt = validTimestamp(item.openedAt);
    const closedAt = validTimestamp(item.closedAt);
    const volume = strictNumeric(item.volume);
    const entryPrice = strictNumeric(item.entryPrice);
    const exitPrice = strictNumeric(item.exitPrice);
    const profit = strictNumeric(item.profit);
    const swap = strictNumeric(item.swap);
    const commission = strictNumeric(item.commission);
    const netProfit = strictNumeric(item.netProfit);
    if (!openedAt || !closedAt || volume === null || volume < 0 || entryPrice === null || exitPrice === null
      || profit === null || swap === null || commission === null || netProfit === null) return null;
    items.push({
      id: item.id,
      ticket: item.ticket == null ? null : item.ticket,
      symbol: item.symbol,
      side: item.side,
      volume,
      openedAt,
      closedAt,
      entryPrice,
      exitPrice,
      profit,
      swap,
      commission,
      netProfit,
    });
  }

  return {
    metrics: { realizedNet, winRate, profitFactor, closedTrades },
    dataQuality: { nettingReversalsExcluded: limitations.nettingReversalsExcluded },
    summaries: { todayNet, sevenDayNet, thirtyDayNet },
    items,
    hasMore: payload.hasMore,
  };
}

function encodeHistoryCursor(trade: ClosedTrade) {
  return Buffer.from(JSON.stringify([trade.closedAt, trade.id]), 'utf8').toString('base64url');
}

function decodeHistoryCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
    if (!Number.isFinite(Date.parse(parsed[0])) || !/^(?:0|[1-9][0-9]{0,19})$/.test(parsed[1])) return null;
    return { closedAt: parsed[0], id: parsed[1] };
  } catch { return null; }
}

function rangeStart(range: TradingAnalyticsRange, now: Date) {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
  return new Date(now.getTime() - days * 86_400_000);
}

function rangeLabel(range: TradingAnalyticsRange) {
  return range === '7d' ? '7 days' : range === '30d' ? '30 days' : range === '90d' ? '90 days' : range === '365d' ? '1 year' : 'All history';
}

function connectionState(lastSeenAt: string | null, now: Date): TradingAnalyticsSnapshot['connection']['state'] {
  if (!lastSeenAt || !Number.isFinite(Date.parse(lastSeenAt))) return 'never';
  const age = Math.max(0, now.getTime() - Date.parse(lastSeenAt));
  if (age <= 180_000) return 'online';
  if (age <= 600_000) return 'delayed';
  return 'offline';
}

function connectionLabel(state: TradingAnalyticsSnapshot['connection']['state']) {
  if (state === 'online') return 'EA connected';
  if (state === 'delayed') return 'EA update delayed';
  if (state === 'offline') return 'EA offline';
  return 'Awaiting first sync';
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

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function zeroAsNull(value: unknown) {
  const parsed = nullableNumeric(value);
  return parsed === 0 ? null : parsed;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validTimestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
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

function nullableNonNegativeNumeric(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = strictNumeric(value);
  return parsed !== null && parsed >= 0 ? parsed : undefined;
}

function nullableBoundedNumeric(value: unknown, minimum: number, maximum: number): number | null | undefined {
  if (value === null) return null;
  const parsed = strictNumeric(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function decimalCompare(left: number | string, right: number | string) {
  const a = BigInt(String(left));
  const b = BigInt(String(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

function tradingAnalyticsDatabaseError(error: DatabaseError) {
  if (isMissingTradingTelemetrySchema(error)) {
    return Object.assign(new Error('Trading analytics migration required'), { code: 'TELEMETRY_MIGRATION_REQUIRED', status: 503 });
  }
  return Object.assign(new Error('Trading analytics database unavailable'), { code: 'DATABASE_ERROR', status: 500 });
}

export function publicTradingAnalyticsError(error: unknown) {
  const known = error as { code?: string; status?: number };
  if (known?.code === 'CONNECTION_NOT_FOUND') return { status: 404, message: 'The selected trading connection was not found.' };
  if (known?.code === 'INVALID_CURSOR') return { status: 400, message: 'The trading-history cursor is invalid.' };
  if (known?.code === 'CLIENT_NOT_FOUND') return { status: 404, message: 'The linked Orion client account was not found.' };
  if (known?.code === 'TELEMETRY_MIGRATION_REQUIRED') return { status: 503, message: 'Live trading analytics are waiting for the latest database migration.' };
  return { status: Number.isInteger(known?.status) ? Number(known.status) : 500, message: 'Trading analytics are temporarily unavailable.' };
}
