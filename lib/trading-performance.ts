import {
  isTradingAnalyticsRange,
  tradingAnalyticsEntitlement,
  type TradingAnalyticsPlan,
  type TradingAnalyticsRange,
  type TradingConnectionStatus,
  type TradingConnectionSummary,
} from '@/lib/trading-analytics';

export type TradingPerformanceAccess = {
  plan: TradingAnalyticsPlan;
  allowedRanges: TradingAnalyticsRange[];
  maxRange: TradingAnalyticsRange | null;
  calendar: boolean;
  advancedMetrics: boolean;
  breakdowns: boolean;
  csvExport: boolean;
  allHistory: boolean;
};

export type TradingPerformanceOverview = {
  realizedNet: number | null;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdownMoney: number | null;
  maxDrawdownPercent: number | null;
  closedTrades: number;
};

export type TradingPerformanceMetrics = {
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  maxWinStreak: number | null;
  maxLossStreak: number | null;
};

export type TradingPerformanceDay = {
  date: string;
  netProfit: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
};

export type TradingPerformanceBreakdownItem = {
  key: string;
  label: string;
  netProfit: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  averageNet: number;
};

export type TradingPerformanceReport = {
  window: {
    startAt: string | null;
    endAt: string;
  };
  overview: TradingPerformanceOverview;
  metrics: TradingPerformanceMetrics;
  calendar: TradingPerformanceDay[];
  breakdowns: {
    symbols: TradingPerformanceBreakdownItem[];
    directions: TradingPerformanceBreakdownItem[];
    weekdays: TradingPerformanceBreakdownItem[];
    sessions: TradingPerformanceBreakdownItem[];
  };
};

export type TradingPerformanceDataQuality = {
  partialClosesRolledIntoFinalClose: boolean;
  incompleteHistoryExcluded: boolean;
  volumeMismatchExcluded: boolean;
  nettingReversalsExcluded: boolean;
  mixedHistoricalCurrenciesDetected: boolean;
  currencyEvidenceComplete: boolean;
  coverageStart: string | null;
  equityCoverageStart: string | null;
  equityCoverageComplete: boolean;
  calendarBasis: 'FINAL_CLOSE_UTC';
  weekdayBasis: 'FINAL_CLOSE_UTC';
  sessionBasis: 'ENTRY_TIME_UTC_FIXED_WINDOWS';
};

export type TradingPerformanceSnapshot = {
  generatedAt: string;
  dataAsOf: string | null;
  access: TradingPerformanceAccess;
  connections: TradingConnectionSummary[];
  selectedConnectionId: string | null;
  availability: 'ready' | 'setup_required' | 'waiting_first_sync';
  connection: TradingConnectionStatus;
  account: {
    currency: string;
  } | null;
  period: {
    range: TradingAnalyticsRange;
    label: string;
    timeZone: 'UTC';
  };
  dataQuality: TradingPerformanceDataQuality;
  performance: TradingPerformanceReport | null;
};

export function tradingPerformanceAccess(plan: unknown): TradingPerformanceAccess {
  const entitlement = tradingAnalyticsEntitlement(plan);
  return {
    plan: entitlement.plan,
    allowedRanges: [...entitlement.allowedRanges],
    maxRange: entitlement.maxRange,
    calendar: entitlement.performanceCalendar,
    advancedMetrics: entitlement.advancedMetrics,
    breakdowns: entitlement.performanceBreakdowns,
    csvExport: entitlement.performanceCsvExport,
    allHistory: entitlement.allHistory,
  };
}

export function canExportTradingPerformance(access: Pick<TradingPerformanceAccess, 'plan' | 'csvExport'>) {
  return access.csvExport && (access.plan === 'Premium' || access.plan === 'Lifetime');
}

export function buildTradingPerformanceCsv(snapshot: TradingPerformanceSnapshot) {
  if (!snapshot.performance || !canExportTradingPerformance(snapshot.access)) {
    throw new Error('Performance CSV export is not available for this Orion plan.');
  }

  const columns = [
    'record_type',
    'category',
    'label',
    'date',
    'closed_trades',
    'wins',
    'losses',
    'breakeven',
    'win_rate_percent',
    'average_net',
    'net_profit',
    'average_win',
    'average_loss',
    'expectancy',
    'best_trade',
    'worst_trade',
    'max_win_streak',
    'max_loss_streak',
  ] as const;
  type Column = (typeof columns)[number];
  type CsvRow = Partial<Record<Column, string | number | null>>;
  const report = snapshot.performance;
  const rows: CsvRow[] = [{
    record_type: 'summary',
    category: 'period',
    label: snapshot.period.label,
    closed_trades: report.overview.closedTrades,
    win_rate_percent: report.overview.winRate,
    net_profit: report.overview.realizedNet,
    average_win: report.metrics.averageWin,
    average_loss: report.metrics.averageLoss,
    expectancy: report.metrics.expectancy,
    best_trade: report.metrics.bestTrade,
    worst_trade: report.metrics.worstTrade,
    max_win_streak: report.metrics.maxWinStreak,
    max_loss_streak: report.metrics.maxLossStreak,
  }];

  report.calendar.forEach((day) => rows.push({
    record_type: 'daily',
    category: 'calendar',
    label: day.date,
    date: day.date,
    closed_trades: day.closedTrades,
    wins: day.wins,
    losses: day.losses,
    breakeven: day.breakeven,
    win_rate_percent: day.closedTrades ? day.wins / day.closedTrades * 100 : null,
    average_net: day.closedTrades ? day.netProfit / day.closedTrades : 0,
    net_profit: day.netProfit,
  }));

  ([
    ['symbol', report.breakdowns.symbols],
    ['direction', report.breakdowns.directions],
    ['weekday', report.breakdowns.weekdays],
    ['session_utc', report.breakdowns.sessions],
  ] as const).forEach(([category, items]) => items.forEach((item) => rows.push({
    record_type: 'breakdown',
    category,
    label: item.label,
    closed_trades: item.closedTrades,
    wins: item.wins,
    losses: item.losses,
    breakeven: item.breakeven,
    win_rate_percent: item.winRate,
    average_net: item.averageNet,
    net_profit: item.netProfit,
  })));

  return `\uFEFF${[
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column] ?? '')).join(',')),
  ].join('\r\n')}`;
}

export function tradingPerformanceCsvFilename(snapshot: Pick<TradingPerformanceSnapshot, 'generatedAt' | 'period'>) {
  const candidate = /^\d{4}-\d{2}-\d{2}/.exec(snapshot.generatedAt)?.[0];
  const date = candidate && validDateKey(candidate) ? candidate : 'report';
  return `orion-performance-${snapshot.period.range}-${date}.csv`;
}

export function isTradingPerformanceSnapshot(value: unknown): value is TradingPerformanceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const access = recordValue(row.access);
  const period = recordValue(row.period);
  const connection = recordValue(row.connection);
  const quality = recordValue(row.dataQuality);
  if (!validTimestamp(row.generatedAt)
    || (row.dataAsOf !== null && !validTimestamp(row.dataAsOf))
    || !access
    || !['Free', 'Basic', 'Premium', 'Lifetime'].includes(String(access.plan))
    || !Array.isArray(access.allowedRanges)
    || !access.allowedRanges.every(isTradingAnalyticsRange)
    || typeof access.calendar !== 'boolean'
    || typeof access.advancedMetrics !== 'boolean'
    || typeof access.breakdowns !== 'boolean'
    || typeof access.csvExport !== 'boolean'
    || typeof access.allHistory !== 'boolean'
    || !Array.isArray(row.connections)
    || !row.connections.every(validConnection)
    || !['ready', 'setup_required', 'waiting_first_sync'].includes(String(row.availability))
    || !connection
    || !['online', 'delayed', 'offline', 'never'].includes(String(connection.state))
    || (connection.lastSeenAt !== null && !validTimestamp(connection.lastSeenAt))
    || typeof connection.label !== 'string'
    || !period
    || !isTradingAnalyticsRange(period.range)
    || typeof period.label !== 'string'
    || period.timeZone !== 'UTC'
    || !quality
    || quality.partialClosesRolledIntoFinalClose !== true
    || typeof quality.incompleteHistoryExcluded !== 'boolean'
    || typeof quality.volumeMismatchExcluded !== 'boolean'
    || typeof quality.nettingReversalsExcluded !== 'boolean'
    || typeof quality.mixedHistoricalCurrenciesDetected !== 'boolean'
    || typeof quality.currencyEvidenceComplete !== 'boolean'
    || (quality.coverageStart !== null && !validTimestamp(quality.coverageStart))
    || (quality.equityCoverageStart !== null && !validTimestamp(quality.equityCoverageStart))
    || typeof quality.equityCoverageComplete !== 'boolean'
    || quality.calendarBasis !== 'FINAL_CLOSE_UTC'
    || quality.weekdayBasis !== 'FINAL_CLOSE_UTC'
    || quality.sessionBasis !== 'ENTRY_TIME_UTC_FIXED_WINDOWS') return false;

  const expected = tradingPerformanceAccess(access.plan);
  if (JSON.stringify(access.allowedRanges) !== JSON.stringify(expected.allowedRanges)
    || access.maxRange !== expected.maxRange
    || access.calendar !== expected.calendar
    || access.advancedMetrics !== expected.advancedMetrics
    || access.breakdowns !== expected.breakdowns
    || access.csvExport !== expected.csvExport
    || access.allHistory !== expected.allHistory
    || (expected.allowedRanges.length > 0 && !expected.allowedRanges.includes(period.range as TradingAnalyticsRange))) return false;

  if (row.availability !== 'ready') {
    return row.performance === null && row.selectedConnectionId === null && row.account === null;
  }
  const account = recordValue(row.account);
  return typeof row.selectedConnectionId === 'string'
    && row.connections.some((connection) => recordValue(connection)?.id === row.selectedConnectionId)
    && Boolean(account && typeof account.currency === 'string' && /^[A-Z0-9]{3,8}$/.test(account.currency))
    && validPerformanceReport(row.performance);
}

function csvCell(value: string | number) {
  const raw = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validConnection(value: unknown) {
  const connection = recordValue(value);
  return Boolean(
    connection
    && typeof connection.id === 'string'
    && ['Free', 'Basic', 'Premium', 'Lifetime'].includes(String(connection.plan))
    && (connection.platform === 'MT4' || connection.platform === 'MT5')
    && (connection.accountType === 'Demo' || connection.accountType === 'Real')
    && typeof connection.maskedAccountNumber === 'string'
    && typeof connection.brokerServer === 'string'
    && typeof connection.installationHint === 'string',
  );
}

function validPerformanceReport(value: unknown) {
  const report = recordValue(value);
  const window = recordValue(report?.window);
  const overview = recordValue(report?.overview);
  const metrics = recordValue(report?.metrics);
  const breakdowns = recordValue(report?.breakdowns);
  if (!report || !window || !overview || !metrics || !breakdowns
    || (window.startAt !== null && !validTimestamp(window.startAt))
    || !validTimestamp(window.endAt)
    || !validNumberOrNull(overview.realizedNet)
    || !validNumberOrNull(overview.winRate)
    || !validNumberOrNull(overview.profitFactor)
    || !validNumberOrNull(overview.maxDrawdownMoney)
    || !validNumberOrNull(overview.maxDrawdownPercent)
    || !validNonNegativeInteger(overview.closedTrades)
    || !['averageWin', 'averageLoss', 'expectancy', 'bestTrade', 'worstTrade', 'maxWinStreak', 'maxLossStreak']
      .every((key) => validNumberOrNull(metrics[key]))
    || !Array.isArray(report.calendar)
    || !report.calendar.every(validCalendarDay)
    || !Array.isArray(breakdowns.symbols)
    || !Array.isArray(breakdowns.directions)
    || !Array.isArray(breakdowns.weekdays)
    || !Array.isArray(breakdowns.sessions)) return false;
  return [...breakdowns.symbols, ...breakdowns.directions, ...breakdowns.weekdays, ...breakdowns.sessions]
    .every(validBreakdownItem);
}

function validCalendarDay(value: unknown) {
  const day = recordValue(value);
  if (!day || !validDateKey(day.date) || !validFiniteNumber(day.netProfit)) return false;
  const counts = [day.closedTrades, day.wins, day.losses, day.breakeven];
  return counts.every(validNonNegativeInteger)
    && Number(day.closedTrades) === Number(day.wins) + Number(day.losses) + Number(day.breakeven);
}

function validBreakdownItem(value: unknown) {
  const item = recordValue(value);
  if (!item || typeof item.key !== 'string' || typeof item.label !== 'string'
    || !validFiniteNumber(item.netProfit) || !validFiniteNumber(item.averageNet)
    || !validNumberOrNull(item.winRate)) return false;
  const counts = [item.closedTrades, item.wins, item.losses, item.breakeven];
  return counts.every(validNonNegativeInteger)
    && Number(item.closedTrades) === Number(item.wins) + Number(item.losses) + Number(item.breakeven);
}

function validNumberOrNull(value: unknown) {
  return value === null || validFiniteNumber(value);
}

function validFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validDateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
