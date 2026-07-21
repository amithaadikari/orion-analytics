export type TradingAnalyticsPlan = 'Free' | 'Basic' | 'Premium' | 'Lifetime';

export const tradingAnalyticsRanges = ['7d', '30d', '90d', '365d', 'all'] as const;
export type TradingAnalyticsRange = (typeof tradingAnalyticsRanges)[number];

export type TradingAnalyticsEntitlement = {
  plan: TradingAnalyticsPlan;
  allowedRanges: readonly TradingAnalyticsRange[];
  maxRange: TradingAnalyticsRange | null;
  advancedMetrics: boolean;
  historyPagination: boolean;
  historyPageSize: number;
  allHistory: boolean;
};

export type TradingAnalyticsAccess = {
  plan: TradingAnalyticsPlan;
  allowedRanges?: TradingAnalyticsRange[];
  maxRange: TradingAnalyticsRange | null;
  advancedMetrics: boolean;
  historyPagination: boolean;
  historyPageSize?: number;
  allHistory?: boolean;
};

export type TradingConnectionSummary = {
  id: string;
  plan: TradingAnalyticsPlan;
  platform: 'MT4' | 'MT5';
  accountType: 'Demo' | 'Real';
  maskedAccountNumber: string;
  brokerServer: string;
  installationHint: string;
};

export type TradingConnectionState = 'online' | 'delayed' | 'offline' | 'never';

export type TradingConnectionStatus = {
  state: TradingConnectionState;
  lastSeenAt: string | null;
  label: string;
};

export type TradingAccountMetrics = {
  currency: string;
  balance: number | null;
  equity: number | null;
  margin: number | null;
  marginLevel: number | null;
  floatingNet: number | null;
};

export type TradingMetricSet = {
  realizedNet: number | null;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdownMoney: number | null;
  maxDrawdownPercent: number | null;
  closedTrades: number;
};

export type TradingEquityPoint = {
  at: string;
  balance: number;
  equity: number;
};

export type TradingDirection = 'Buy' | 'Sell';

export type TradingPosition = {
  id: string;
  ticket?: string | null;
  symbol: string;
  side: TradingDirection;
  volume: number;
  openedAt: string;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  floatingNet: number;
};

export type ClosedTrade = {
  id: string;
  ticket?: string | null;
  symbol: string;
  side: TradingDirection;
  volume: number;
  openedAt: string;
  closedAt: string;
  entryPrice: number;
  exitPrice: number;
  profit: number;
  swap: number;
  commission: number;
  netProfit: number;
};

export type TradingAnalyticsSnapshot = {
  generatedAt: string;
  dataAsOf: string | null;
  access: TradingAnalyticsAccess;
  connections: TradingConnectionSummary[];
  selectedConnectionId: string | null;
  availability: 'ready' | 'setup_required' | 'waiting_first_sync';
  connection: TradingConnectionStatus;
  account: TradingAccountMetrics | null;
  period: {
    range: TradingAnalyticsRange;
    label: string;
    timeZone: string;
  };
  metrics: TradingMetricSet;
  dataQuality: {
    nettingReversalsExcluded: boolean;
  };
  summaries: {
    todayNet: number;
    sevenDayNet: number;
    thirtyDayNet: number;
  } | null;
  equity: TradingEquityPoint[];
  openPositions: TradingPosition[];
  history: {
    items: ClosedTrade[];
    nextCursor: string | null;
  };
};

export type ClosedTradeMetricInput = {
  profit?: number | null;
  swap?: number | null;
  commission?: number | null;
  netProfit?: number | null;
};

const entitlementByPlan: Record<TradingAnalyticsPlan, TradingAnalyticsEntitlement> = {
  Free: {
    plan: 'Free',
    allowedRanges: [],
    maxRange: null,
    advancedMetrics: false,
    historyPagination: false,
    historyPageSize: 0,
    allHistory: false,
  },
  Basic: {
    plan: 'Basic',
    allowedRanges: ['7d'],
    maxRange: '7d',
    advancedMetrics: false,
    historyPagination: false,
    historyPageSize: 20,
    allHistory: false,
  },
  Premium: {
    plan: 'Premium',
    allowedRanges: ['7d', '30d', '90d'],
    maxRange: '90d',
    advancedMetrics: true,
    historyPagination: true,
    historyPageSize: 50,
    allHistory: false,
  },
  Lifetime: {
    plan: 'Lifetime',
    allowedRanges: tradingAnalyticsRanges,
    maxRange: 'all',
    advancedMetrics: true,
    historyPagination: true,
    historyPageSize: 50,
    allHistory: true,
  },
};

export function canonicalTradingAnalyticsPlan(value: unknown): TradingAnalyticsPlan {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'basic') return 'Basic';
  if (normalized === 'premium') return 'Premium';
  if (normalized === 'lifetime') return 'Lifetime';
  return 'Free';
}

export function tradingAnalyticsEntitlement(plan: unknown): TradingAnalyticsEntitlement {
  return entitlementByPlan[canonicalTradingAnalyticsPlan(plan)];
}

export function allowedTradingAnalyticsRanges(access: Pick<TradingAnalyticsAccess, 'plan' | 'allowedRanges'>) {
  const supplied = access.allowedRanges?.filter(isTradingAnalyticsRange);
  return supplied?.length ? supplied : [...tradingAnalyticsEntitlement(access.plan).allowedRanges];
}

export function isTradingAnalyticsRange(value: unknown): value is TradingAnalyticsRange {
  return typeof value === 'string' && tradingAnalyticsRanges.includes(value as TradingAnalyticsRange);
}

export function normalizeTradingAnalyticsRange(value: unknown, plan: unknown): TradingAnalyticsRange {
  const entitlement = tradingAnalyticsEntitlement(plan);
  if (isTradingAnalyticsRange(value) && entitlement.allowedRanges.includes(value)) return value;
  return entitlement.allowedRanges[0] || '7d';
}

export function tradeNetProfit(trade: ClosedTradeMetricInput) {
  if (isFiniteNumber(trade.netProfit)) return trade.netProfit;
  return finiteValue(trade.profit) + finiteValue(trade.swap) + finiteValue(trade.commission);
}

export function calculateTradingMetrics(
  trades: ClosedTradeMetricInput[],
  equity: Pick<TradingEquityPoint, 'at' | 'equity'>[] = [],
): TradingMetricSet {
  const netValues = trades.map(tradeNetProfit);
  const grossProfit = netValues.filter((value) => value > 0).reduce((total, value) => total + value, 0);
  const grossLoss = Math.abs(netValues.filter((value) => value < 0).reduce((total, value) => total + value, 0));
  const drawdown = calculateMaximumDrawdown(equity);

  return {
    realizedNet: netValues.length ? netValues.reduce((total, value) => total + value, 0) : 0,
    winRate: netValues.length ? netValues.filter((value) => value > 0).length / netValues.length * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownMoney: drawdown.money,
    maxDrawdownPercent: drawdown.percent,
    closedTrades: netValues.length,
  };
}

export function calculateMaximumDrawdown(points: Pick<TradingEquityPoint, 'at' | 'equity'>[]) {
  const ordered = points
    .filter((point) => isFiniteNumber(point.equity))
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  if (ordered.length < 2) return { money: null, percent: null };

  let peak = ordered[0].equity;
  let maxMoney = 0;
  let maxPercent = 0;
  for (const point of ordered) {
    peak = Math.max(peak, point.equity);
    const money = Math.max(0, peak - point.equity);
    const percent = peak > 0 ? money / peak * 100 : 0;
    maxMoney = Math.max(maxMoney, money);
    maxPercent = Math.max(maxPercent, percent);
  }
  return { money: maxMoney, percent: maxPercent };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteValue(value: unknown) {
  return isFiniteNumber(value) ? value : 0;
}
