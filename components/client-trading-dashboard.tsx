'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CircleAlert,
  Clock3,
  Gauge,
  History,
  Landmark,
  LineChart as LineChartIcon,
  LoaderCircle,
  LockKeyhole,
  Radio,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards,
  Wifi,
  WifiOff,
} from 'lucide-react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  allowedTradingAnalyticsRanges,
  isTradingAnalyticsRange,
  type ClosedTrade,
  type TradingAnalyticsRange,
  type TradingAnalyticsSnapshot,
  type TradingConnectionState,
  type TradingEquityPoint,
  type TradingPosition,
} from '@/lib/trading-analytics';
import ClientTradingAlertCenter from './client-trading-alert-center';
import styles from './client-trading-dashboard.module.css';

const rangeLabels: Record<TradingAnalyticsRange, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '365d': '1Y',
  all: 'All',
};

type LoadOptions = {
  append?: boolean;
  background?: boolean;
  cursor?: string | null;
  signal?: AbortSignal;
};

type TradingExecutionActivityFeed = TradingAnalyticsSnapshot['activity'];
type TradeHistoryView = 'executions' | 'closed';

const emptyExecutionActivity: TradingExecutionActivityFeed = { items: [], hasMore: false, incompleteHistoryExcluded: false };
const tradeHistoryViews: TradeHistoryView[] = ['executions', 'closed'];

export default function ClientTradingDashboard() {
  const [snapshot, setSnapshot] = useState<TradingAnalyticsSnapshot | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [range, setRange] = useState<TradingAnalyticsRange>('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestRunning = useRef(false);
  const skipBootstrapSelectionReload = useRef(false);
  const snapshotRef = useRef<TradingAnalyticsSnapshot | null>(null);

  snapshotRef.current = snapshot;

  const load = useCallback(async ({ append = false, background = false, cursor, signal }: LoadOptions = {}) => {
    if (requestRunning.current && background) return;
    requestRunning.current = true;
    if (append) setLoadingMore(true);
    else if (background || snapshotRef.current) setRefreshing(true);
    else setLoading(true);
    if (!background) setError('');

    try {
      const params = new URLSearchParams({ range });
      if (connectionId) params.set('connectionId', connectionId);
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/trading-analytics?${params}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTradingAnalyticsSnapshot(payload)) {
        throw new Error(apiError(payload) || 'Your trading dashboard is temporarily unavailable.');
      }

      setSnapshot((current) => append && current
        ? {
            ...payload,
            history: {
              ...payload.history,
              items: mergeTrades(current.history.items, payload.history.items),
            },
          }
        : payload);
      if (!connectionId && payload.selectedConnectionId) {
        skipBootstrapSelectionReload.current = true;
        setConnectionId(payload.selectedConnectionId);
      }
      if (isTradingAnalyticsRange(payload.period.range) && payload.period.range !== range) setRange(payload.period.range);
      setError('');
    } catch (reason) {
      if (isAbortError(reason)) return;
      setError(reason instanceof Error ? reason.message : 'Your trading dashboard is temporarily unavailable.');
    } finally {
      requestRunning.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [connectionId, range]);

  useEffect(() => {
    if (skipBootstrapSelectionReload.current) {
      skipBootstrapSelectionReload.current = false;
      return;
    }

    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (snapshot?.availability !== 'ready') return;
    let controller: AbortController | null = null;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      void load({ background: true, signal: controller.signal });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [load, snapshot?.availability]);

  const status = snapshot?.connection.state || 'never';
  const statusView = connectionStatusView(status);

  function selectConnection(next: string) {
    if (next === connectionId) return;
    setConnectionId(next);
    setRange('7d');
    setSnapshot(null);
    setError('');
  }

  return (
    <section className={styles.shell} aria-labelledby="client-trading-dashboard-title" aria-busy={loading || refreshing}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className="eyebrow">Live trading workspace</p>
          <h1 id="client-trading-dashboard-title">Your Orion trading dashboard</h1>
          <p>Read-only account activity reported by your licensed Orion EA. No broker password or remote trade control is used here.</p>
        </div>
        <div className={styles.heroStatus} data-state={status} role="status">
          <span aria-hidden="true">{statusView.icon}</span>
          <div><small>EA connection</small><strong>{snapshot ? statusView.label : 'Secure sync'}</strong><p>{snapshot ? connectionStatusDetail(snapshot) : 'Checking your licensed installation…'}</p></div>
        </div>
      </header>

      {snapshot && <DashboardControls
        snapshot={snapshot}
        range={range}
        refreshing={refreshing}
        onConnectionChange={selectConnection}
        onRangeChange={setRange}
        onRefresh={() => void load({ background: true })}
      />}

      {error && snapshot && (
        <div className={styles.staleAlert} role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p><strong>Couldn’t refresh trading activity</strong><span>{error} Showing the last successful update{snapshot.dataAsOf ? ` from ${formatDateTime(snapshot.dataAsOf, snapshot.period.timeZone)}` : ''}.</span></p>
          <button type="button" onClick={() => void load({ background: true })}>Retry</button>
        </div>
      )}

      {loading && !snapshot ? <LoadingState /> : null}
      {error && !snapshot && !loading ? <ErrorState message={error} retry={() => void load()} /> : null}
      {snapshot?.availability === 'setup_required' ? <SetupState plan={snapshot.access.plan} /> : null}
      {snapshot?.availability === 'waiting_first_sync' ? <WaitingState snapshot={snapshot} /> : null}
      {snapshot?.availability === 'ready' ? <ReadyDashboard snapshot={snapshot} loadingMore={loadingMore} loadMore={() => void load({ append: true, cursor: snapshot.history.nextCursor })} /> : null}
    </section>
  );
}

function DashboardControls({ snapshot, range, refreshing, onConnectionChange, onRangeChange, onRefresh }: {
  snapshot: TradingAnalyticsSnapshot;
  range: TradingAnalyticsRange;
  refreshing: boolean;
  onConnectionChange: (connectionId: string) => void;
  onRangeChange: (range: TradingAnalyticsRange) => void;
  onRefresh: () => void;
}) {
  const ranges = allowedTradingAnalyticsRanges(snapshot.access);
  const selected = snapshot.connections.find((connection) => connection.id === snapshot.selectedConnectionId) || snapshot.connections[0];
  return (
    <div className={styles.controlBar}>
      <label className={styles.connectionPicker}>
        <span>Trading connection</span>
        <select value={snapshot.selectedConnectionId || selected?.id || ''} onChange={(event) => onConnectionChange(event.target.value)} disabled={snapshot.availability !== 'ready' || snapshot.connections.length < 2}>
          {!snapshot.connections.length && <option value="">No connected EA</option>}
          {snapshot.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.accountType} {connection.maskedAccountNumber} · {connection.platform} · {connection.plan}</option>)}
        </select>
        {selected && <small>{selected.brokerServer} · Device {selected.installationHint}</small>}
      </label>
      {ranges.length > 0 && <div className={styles.rangePicker} role="group" aria-label="Trading analytics period">
        <span>Analytics period</span>
        <div>{ranges.map((option) => <button type="button" key={option} aria-pressed={range === option} onClick={() => onRangeChange(option)}>{rangeLabels[option]}</button>)}</div>
      </div>}
      <div className={styles.dataClock}>
        <span><Clock3 size={15} aria-hidden="true" /><small>Data as of</small></span>
        <strong>{snapshot.dataAsOf ? formatDateTime(snapshot.dataAsOf, snapshot.period.timeZone) : 'No update yet'}</strong>
        <small>{snapshot.period.timeZone} · {snapshot.period.label}</small>
      </div>
      <button className={styles.refreshButton} type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh trading dashboard">
        <RefreshCw size={16} className={refreshing ? styles.spin : undefined} aria-hidden="true" />
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}

function ReadyDashboard({ snapshot, loadingMore, loadMore }: { snapshot: TradingAnalyticsSnapshot; loadingMore: boolean; loadMore: () => void }) {
  const currency = snapshot.account?.currency || 'USD';
  const offline = snapshot.connection.state === 'offline' || snapshot.connection.state === 'delayed';
  const activity = snapshot.activity || emptyExecutionActivity;
  const selectedConnection = snapshot.connections.find((connection) => connection.id === snapshot.selectedConnectionId) || snapshot.connections[0];
  return <div className={styles.dashboard}>
    {offline && <div className={styles.offlineNotice} role="status"><WifiOff size={19} aria-hidden="true" /><p><strong>{snapshot.connection.state === 'offline' ? 'EA offline' : 'EA update delayed'}</strong><span>Positions and account values shown are from {snapshot.dataAsOf ? formatDateTime(snapshot.dataAsOf, snapshot.period.timeZone) : 'the last recorded sync'} and may have changed in MetaTrader.</span></p></div>}
    {snapshot.dataQuality.nettingReversalsExcluded && <div className={styles.offlineNotice} role="status"><CircleAlert size={19} aria-hidden="true" /><p><strong>Netting reversals excluded</strong><span>MT5 InOut reversal cycles are not included in closed-trade totals because they cannot be split reliably from broker deal data. Live account values and open positions remain available.</span></p></div>}

    <div className={styles.accountMetrics} aria-label="Latest account metrics">
      <MetricCard icon={<WalletCards size={19} />} label="Balance" value={formatMoney(snapshot.account?.balance ?? null, currency)} detail="Closed account balance" tone="cyan" />
      <MetricCard icon={<Landmark size={19} />} label="Equity" value={formatMoney(snapshot.account?.equity ?? null, currency)} detail="Balance plus floating P/L" tone="green" />
      <MetricCard icon={<Activity size={19} />} label="Floating P/L" value={formatSignedMoney(snapshot.account?.floatingNet ?? null, currency)} detail={`${snapshot.openPositions.length} open position${snapshot.openPositions.length === 1 ? '' : 's'}`} tone={metricTone(snapshot.account?.floatingNet)} />
      <MetricCard icon={<BarChart3 size={19} />} label={`${snapshot.period.label} net P/L`} value={formatSignedMoney(snapshot.metrics.realizedNet, currency)} detail={`${snapshot.metrics.closedTrades} closed trade${snapshot.metrics.closedTrades === 1 ? '' : 's'}`} tone={metricTone(snapshot.metrics.realizedNet)} />
    </div>

    <div className={styles.analysisGrid}>
      <EquityChart snapshot={snapshot} />
      <ConnectionPanel snapshot={snapshot} />
    </div>

    <div className={styles.performanceMetrics} aria-label="Trading performance metrics">
      <MetricCard icon={<History size={18} />} label="Closed trades" value={snapshot.metrics.closedTrades.toLocaleString()} detail={snapshot.period.label} tone="cyan" compact />
      <MetricCard icon={<TrendingUp size={18} />} label="Win rate" value={formatPercent(snapshot.metrics.winRate)} detail="Winning closed trades" tone="green" compact />
      {snapshot.access.advancedMetrics
        ? <MetricCard icon={<Gauge size={18} />} label="Profit factor" value={formatRatio(snapshot.metrics.profitFactor)} detail={snapshot.metrics.profitFactor === null ? 'Not enough loss data' : 'Gross profit ÷ gross loss'} tone="gold" compact />
        : <LockedMetric title="Profit factor" plan="Premium" />}
      {snapshot.access.advancedMetrics
        ? <MetricCard icon={<TrendingDown size={18} />} label="Maximum drawdown" value={formatDrawdown(snapshot.metrics.maxDrawdownMoney, snapshot.metrics.maxDrawdownPercent, currency)} detail={snapshot.metrics.maxDrawdownPercent === null ? 'Not enough equity samples yet' : 'Peak-to-trough equity decline'} tone="orange" compact />
        : <LockedMetric title="Maximum drawdown" plan="Premium" />}
    </div>

    {snapshot.summaries && <section className={styles.summaryPanel} aria-labelledby="trading-period-summary-title">
      <header className={styles.panelHeading}><div><p className="eyebrow">Performance windows</p><h2 id="trading-period-summary-title">Today, week and month</h2><span>Realized net P/L from closed Orion trades, aggregated in UTC.</span></div></header>
      <div className={styles.summaryMetrics}>
        <MetricCard icon={<Clock3 size={18} />} label="Today net P/L" value={formatSignedMoney(snapshot.summaries.todayNet, currency)} detail="Since 00:00 UTC" tone={metricTone(snapshot.summaries.todayNet)} compact />
        <MetricCard icon={<History size={18} />} label="7-day net P/L" value={formatSignedMoney(snapshot.summaries.sevenDayNet, currency)} detail="Rolling 7 days" tone={metricTone(snapshot.summaries.sevenDayNet)} compact />
        <MetricCard icon={<BarChart3 size={18} />} label="30-day net P/L" value={formatSignedMoney(snapshot.summaries.thirtyDayNet, currency)} detail="Rolling 30 days" tone={metricTone(snapshot.summaries.thirtyDayNet)} compact />
      </div>
    </section>}

    {snapshot.selectedConnectionId && <ClientTradingAlertCenter
      connectionId={snapshot.selectedConnectionId}
      plan={snapshot.access.plan}
      currency={currency}
      connectionLabel={selectedConnection ? `${selectedConnection.platform} ${selectedConnection.accountType} ${selectedConnection.maskedAccountNumber}` : 'Selected Orion connection'}
    />}
    <OpenPositions positions={snapshot.openPositions} currency={currency} timeZone={snapshot.period.timeZone} stale={offline} />
    <TradeHistoryWorkspace
      activity={activity}
      trades={snapshot.history.items}
      currency={currency}
      timeZone={snapshot.period.timeZone}
      nextCursor={snapshot.history.nextCursor}
      canLoadMore={snapshot.access.historyPagination}
      loadingMore={loadingMore}
      loadMore={loadMore}
    />
  </div>;
}

function EquityChart({ snapshot }: { snapshot: TradingAnalyticsSnapshot }) {
  const rawId = useId();
  const gradientId = `orion-equity-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const currency = snapshot.account?.currency || 'USD';
  const points = snapshot.equity;
  const summary = useMemo(() => equitySummary(points), [points]);
  const ariaLabel = points.length
    ? `Account equity chart for ${snapshot.period.label}. Starting equity ${formatMoney(points[0].equity, currency)} and latest equity ${formatMoney(points[points.length - 1].equity, currency)}.`
    : `No equity samples are available for ${snapshot.period.label}.`;

  return <article className={styles.chartPanel}>
    <header className={styles.panelHeading}><div><p className="eyebrow">Verified account curve</p><h2>Balance and equity</h2><span>Reported samples for {snapshot.period.label}. Times shown in {snapshot.period.timeZone}.</span></div><span className={styles.chartLegend}><i data-series="equity" />Equity<i data-series="balance" />Balance</span></header>
    {points.length ? <>
      <div className={styles.chart} role="img" tabIndex={0} aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 18, right: 10, left: 2, bottom: 2 }}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--portal-secondary)" stopOpacity={0.34} /><stop offset="100%" stopColor="var(--portal-secondary)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.055)" strokeDasharray="4 7" />
            <XAxis dataKey="at" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: '#738086', fontSize: 9 }} />
            <YAxis tickFormatter={compactNumber} tickLine={false} axisLine={false} width={54} tick={{ fill: '#738086', fontSize: 9 }} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatDateTime(String(value), snapshot.period.timeZone)} formatter={(value, name) => [formatMoney(Number(value), currency), name === 'equity' ? 'Equity' : 'Balance']} />
            <Area type="linear" dataKey="balance" stroke="var(--portal-accent)" strokeWidth={1.7} fill="transparent" dot={false} activeDot={{ r: 4, fill: '#050808', stroke: 'var(--portal-accent-bright)', strokeWidth: 2 }} />
            <Area type="linear" dataKey="equity" stroke="var(--portal-secondary)" strokeWidth={2.7} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4.5, fill: '#050808', stroke: 'var(--portal-secondary-bright)', strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className={styles.chartData}><summary>View chart data summary</summary><dl>{summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{formatMoney(item.point.equity, currency)}<small>{formatDateTime(item.point.at, snapshot.period.timeZone)}</small></dd></div>)}</dl></details>
    </> : <InlineEmpty icon={<LineChartIcon size={24} />} title="No equity samples yet" detail="The chart will appear after Orion receives account snapshots for this period." />}
  </article>;
}

function ConnectionPanel({ snapshot }: { snapshot: TradingAnalyticsSnapshot }) {
  const selected = snapshot.connections.find((connection) => connection.id === snapshot.selectedConnectionId) || snapshot.connections[0];
  const status = connectionStatusView(snapshot.connection.state);
  return <aside className={styles.connectionPanel} data-state={snapshot.connection.state} aria-labelledby="trading-connection-title">
    <header><span aria-hidden="true">{status.icon}</span><div><p className="eyebrow">EA connection</p><h2 id="trading-connection-title">{status.label}</h2></div></header>
    <p>{connectionStatusDetail(snapshot)}</p>
    <dl>
      <div><dt>Account</dt><dd>{selected?.accountType || '—'} {selected?.maskedAccountNumber || ''}</dd></div>
      <div><dt>Plan</dt><dd>{snapshot.access.plan}</dd></div>
      <div><dt>Platform</dt><dd>{selected?.platform || '—'}</dd></div>
      <div><dt>Broker server</dt><dd>{selected?.brokerServer || '—'}</dd></div>
      <div><dt>Device</dt><dd>{selected?.installationHint || 'Not paired'}</dd></div>
      <div><dt>Last sync</dt><dd>{snapshot.connection.lastSeenAt ? formatDateTime(snapshot.connection.lastSeenAt, snapshot.period.timeZone) : 'Never'}</dd></div>
    </dl>
    <p className={styles.readOnly}><ShieldCheck size={15} aria-hidden="true" />Read-only monitoring. Trade execution remains inside MetaTrader.</p>
  </aside>;
}

function OpenPositions({ positions, currency, timeZone, stale }: { positions: TradingPosition[]; currency: string; timeZone: string; stale: boolean }) {
  return <section className={styles.tablePanel} aria-labelledby="open-positions-title">
    <header className={styles.panelHeading}><div><p className="eyebrow">Current exposure</p><h2 id="open-positions-title">Open positions</h2><span>{stale ? 'Last reported positions; confirm current exposure in MetaTrader.' : 'Latest positions reported by the connected EA.'}</span></div><strong>{positions.length} open</strong></header>
    {positions.length ? <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Latest open trading positions</caption><thead><tr><th>Symbol</th><th>Side</th><th>Volume</th><th>Entry</th><th>Current</th><th>SL / TP</th><th>Floating P/L</th><th>Opened</th></tr></thead><tbody>{positions.map((position) => <PositionRow key={position.id} position={position} currency={currency} timeZone={timeZone} />)}</tbody></table></div> : <InlineEmpty icon={<Radio size={23} />} title="No open positions reported" detail="No open positions were included in the latest EA synchronization." />}
  </section>;
}

function PositionRow({ position, currency, timeZone }: { position: TradingPosition; currency: string; timeZone: string }) {
  return <tr><td><strong>{position.symbol}</strong><small>{position.ticket ? `#${position.ticket}` : 'EA position'}</small></td><td><span className={styles.side} data-side={position.side.toLowerCase()}>{position.side}</span></td><td>{formatVolume(position.volume)}</td><td>{formatPrice(position.entryPrice)}</td><td>{formatPrice(position.currentPrice)}</td><td>{formatPrice(position.stopLoss)} / {formatPrice(position.takeProfit)}</td><td className={profitClass(position.floatingNet)}>{formatSignedMoney(position.floatingNet, currency)}</td><td><time dateTime={position.openedAt}>{formatDateTime(position.openedAt, timeZone)}</time></td></tr>;
}

function TradeHistoryWorkspace({ activity, trades, currency, timeZone, nextCursor, canLoadMore, loadingMore, loadMore }: {
  activity: TradingExecutionActivityFeed;
  trades: ClosedTrade[];
  currency: string;
  timeZone: string;
  nextCursor: string | null;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}) {
  const rawId = useId();
  const id = `trade-history-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [activeView, setActiveView] = useState<TradeHistoryView>('executions');
  const tabRefs = useRef<Record<TradeHistoryView, HTMLButtonElement | null>>({ executions: null, closed: null });
  const executionCount = activity.items.length.toString();
  const closedCount = trades.length.toString();
  const executionCountLabel = `${activity.items.length} shown${activity.hasMore ? ', recent records only' : ''}`;
  const closedCountLabel = `${trades.length} shown${canLoadMore && nextCursor ? ', more available' : ''}`;

  function activateView(view: TradeHistoryView) {
    setActiveView(view);
    tabRefs.current[view]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: TradeHistoryView) {
    const currentIndex = tradeHistoryViews.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tradeHistoryViews.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tradeHistoryViews.length) % tradeHistoryViews.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tradeHistoryViews.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateView(tradeHistoryViews[nextIndex]);
  }

  return <section className={styles.tradeHistoryWorkspace} aria-labelledby={`${id}-title`}>
    <header className={styles.panelHeading}>
      <div>
        <p className="eyebrow">Verified trading record</p>
        <h2 id={`${id}-title`}>Trade history</h2>
        <span>Review individual exit executions or fully closed positions without mixing partial closes into completed-trade results.</span>
      </div>
      <strong>2 record views</strong>
    </header>

    <div className={styles.historyTabs} role="tablist" aria-label="Trade history view">
      <button
        ref={(node) => { tabRefs.current.executions = node; }}
        type="button"
        role="tab"
        id={`${id}-executions-tab`}
        aria-label={`Executions, ${executionCountLabel}`}
        aria-selected={activeView === 'executions'}
        aria-controls={`${id}-executions-panel`}
        tabIndex={activeView === 'executions' ? 0 : -1}
        onClick={() => setActiveView('executions')}
        onKeyDown={(event) => handleTabKeyDown(event, 'executions')}
      >
        <span className={styles.historyTabIcon} aria-hidden="true"><Activity size={18} /></span>
        <span className={styles.historyTabCopy}><strong>Executions</strong><small>Partial &amp; final closes</small></span>
        <span className={styles.historyTabCount} aria-hidden="true">{executionCount}</span>
      </button>
      <button
        ref={(node) => { tabRefs.current.closed = node; }}
        type="button"
        role="tab"
        id={`${id}-closed-tab`}
        aria-label={`Closed trades, ${closedCountLabel}`}
        aria-selected={activeView === 'closed'}
        aria-controls={`${id}-closed-panel`}
        tabIndex={activeView === 'closed' ? 0 : -1}
        onClick={() => setActiveView('closed')}
        onKeyDown={(event) => handleTabKeyDown(event, 'closed')}
      >
        <span className={styles.historyTabIcon} aria-hidden="true"><History size={18} /></span>
        <span className={styles.historyTabCopy}><strong>Closed trades</strong><small>Completed positions</small></span>
        <span className={styles.historyTabCount} aria-hidden="true">{closedCount}</span>
      </button>
    </div>

    <div
      className={styles.historyPanel}
      role="tabpanel"
      id={`${id}-executions-panel`}
      aria-labelledby={`${id}-executions-tab`}
      hidden={activeView !== 'executions'}
      tabIndex={activeView === 'executions' ? 0 : -1}
    >
      <ExecutionActivity activity={activity} currency={currency} timeZone={timeZone} />
    </div>
    <div
      className={styles.historyPanel}
      role="tabpanel"
      id={`${id}-closed-panel`}
      aria-labelledby={`${id}-closed-tab`}
      hidden={activeView !== 'closed'}
      tabIndex={activeView === 'closed' ? 0 : -1}
    >
      <TradeHistory trades={trades} currency={currency} timeZone={timeZone} nextCursor={nextCursor} canLoadMore={canLoadMore} loadingMore={loadingMore} loadMore={loadMore} />
    </div>
  </section>;
}

function ExecutionActivity({ activity, currency, timeZone }: { activity: TradingExecutionActivityFeed; currency: string; timeZone: string }) {
  return <div className={styles.historyView}>
    <header className={styles.panelHeading}>
      <div>
        <p className="eyebrow">Exit-by-exit record</p>
        <h3>Execution activity</h3>
        <span>Each row is one exit reported by the EA. Result includes P/L and charges reported on that exit; completed-trade metrics remain based on fully closed positions and include whole-position costs.</span>
      </div>
      <strong>{activity.items.length} shown</strong>
    </header>
    {activity.incompleteHistoryExcluded && <div className={styles.executionNotice} role="status">
      <CircleAlert size={17} aria-hidden="true" />
      <p><strong>Some older exits are hidden</strong><span>Their opening deal is unavailable, so Orion excludes them instead of inventing position details.</span></p>
    </div>}
    {activity.items.length ? <ul className={styles.executionList}>
      {activity.items.map((item) => {
        const statusLabel = item.status === 'Partial' ? 'Partial close' : 'Final close';
        return <li key={item.id} className={styles.executionCard} data-status={item.status.toLowerCase()}>
          <article aria-label={`${statusLabel} ${item.symbol} execution`}>
            <header className={styles.executionIdentity}>
              <div>
                <span className={styles.executionBadge}>{statusLabel}</span>
                <h3>{item.symbol} <span className={styles.side} data-side={item.side.toLowerCase()}>{item.side}</span></h3>
                <small>{item.ticket ? `#${item.ticket}` : `Execution #${item.id}`} · Position #{item.positionId}</small>
              </div>
              <strong className={profitClass(item.netProfit)} aria-hidden="true">{formatSignedMoney(item.netProfit, currency)}</strong>
            </header>
            <dl className={styles.executionFacts}>
              <div><dt>Closed volume</dt><dd>{formatVolume(item.volume)}</dd></div>
              <div><dt>Exit price</dt><dd>{formatPrice(item.exitPrice)}</dd></div>
              <div><dt>Exit result</dt><dd className={profitClass(item.netProfit)}>{formatSignedMoney(item.netProfit, currency)}</dd></div>
              <div><dt>Executed</dt><dd><time dateTime={item.executedAt}>{formatDateTime(item.executedAt, timeZone)}</time></dd></div>
              <div><dt>After execution</dt><dd>{item.status === 'Partial' ? `${formatVolume(item.remainingVolume)} remained` : 'Position closed by this execution'}</dd></div>
            </dl>
          </article>
        </li>;
      })}
    </ul> : <InlineEmpty
      icon={<Activity size={23} />}
      title={activity.incompleteHistoryExcluded ? 'No verified exit executions shown' : 'No exit executions in this period'}
      detail={activity.incompleteHistoryExcluded ? 'Exits without a verifiable opening deal remain hidden.' : 'Partial and final close executions will appear here after the EA reports them.'}
    />}
    {activity.hasMore && <p className={styles.executionDisclosure}>Showing the most recent executions for this period.</p>}
  </div>;
}

function TradeHistory({ trades, currency, timeZone, nextCursor, canLoadMore, loadingMore, loadMore }: { trades: ClosedTrade[]; currency: string; timeZone: string; nextCursor: string | null; canLoadMore: boolean; loadingMore: boolean; loadMore: () => void }) {
  return <div className={styles.historyView}>
    <header className={styles.panelHeading}><div><p className="eyebrow">Completed-position record</p><h3>Closed trades</h3><span>One row represents one fully closed position. Net P/L includes reported profit, swap and commission.</span></div><strong>{trades.length} shown</strong></header>
    {trades.length ? <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Closed Orion trading history</caption><thead><tr><th>Symbol</th><th>Side</th><th>Volume</th><th>Open → Close</th><th>Entry → Exit</th><th>Net P/L</th></tr></thead><tbody>{trades.map((trade) => <tr key={trade.id}><td><strong>{trade.symbol}</strong><small>{trade.ticket ? `#${trade.ticket}` : 'Closed trade'}</small></td><td><span className={styles.side} data-side={trade.side.toLowerCase()}>{trade.side}</span></td><td>{formatVolume(trade.volume)}</td><td><time dateTime={trade.openedAt}>{formatDateTime(trade.openedAt, timeZone)}</time><small>to {formatDateTime(trade.closedAt, timeZone)}</small></td><td>{formatPrice(trade.entryPrice)}<small>to {formatPrice(trade.exitPrice)}</small></td><td className={profitClass(trade.netProfit)}>{formatSignedMoney(trade.netProfit, currency)}</td></tr>)}</tbody></table></div> : <InlineEmpty icon={<History size={23} />} title="No closed trades in this period" detail="Choose another available period or wait for the EA to report a completed trade." />}
    {canLoadMore && nextCursor ? <button type="button" className={styles.loadMore} onClick={loadMore} disabled={loadingMore}>{loadingMore ? <><LoaderCircle size={15} className={styles.spin} aria-hidden="true" />Loading history…</> : <>Load older trades<ArrowRight size={15} aria-hidden="true" /></>}</button> : null}
  </div>;
}

function MetricCard({ icon, label, value, detail, tone, compact = false }: { icon: ReactNode; label: string; value: string; detail: string; tone: 'gold' | 'cyan' | 'green' | 'red' | 'orange' | 'muted'; compact?: boolean }) {
  return <article className={styles.metricCard} data-tone={tone} data-compact={compact}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function LockedMetric({ title, plan }: { title: string; plan: 'Premium' | 'Lifetime' }) {
  return <article className={styles.lockedMetric}><span aria-hidden="true"><LockKeyhole size={18} /></span><div><small>{title}</small><strong>{plan} analytics</strong><p>Included with {plan} trading insights.</p></div><Link href={`/checkout?plan=${plan.toLowerCase()}`}>Review {plan}</Link></article>;
}

function LoadingState() {
  return <div className={styles.loadingState} role="status" aria-live="polite"><span><LoaderCircle size={21} className={styles.spin} aria-hidden="true" />Loading your latest trading activity…</span><div>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div></div>;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className={styles.fullState} data-tone="error" role="alert"><span aria-hidden="true"><CircleAlert size={27} /></span><div><p className="eyebrow">Secure trading records unavailable</p><h2>Trading dashboard could not load</h2><p>{message} No account value or trade status has been guessed.</p></div><button type="button" onClick={retry}>Try again<RefreshCw size={15} aria-hidden="true" /></button></div>;
}

function SetupState({ plan }: { plan: string }) {
  return <div className={styles.fullState} data-tone="setup"><span aria-hidden="true"><LockKeyhole size={28} /></span><div><p className="eyebrow">Connection required</p><h2>Complete your Orion trading setup</h2><p>{plan === 'Free' ? 'Choose an Orion edition, then activate a license and connect your MetaTrader installation.' : 'Register the account you trade with and approve the licensed EA installation before activity can synchronize.'}</p><div className={styles.stateLinks}><Link href="/portal#trading-accounts">Open account setup<ArrowRight size={15} aria-hidden="true" /></Link><Link href="/portal#license-pairing">Check device pairing</Link></div></div></div>;
}

function WaitingState({ snapshot }: { snapshot: TradingAnalyticsSnapshot }) {
  const selected = snapshot.connections.find((connection) => connection.id === snapshot.selectedConnectionId) || snapshot.connections[0];
  return <div className={styles.fullState} data-tone="waiting"><span aria-hidden="true"><Radio size={28} /></span><div><p className="eyebrow">First synchronization pending</p><h2>Orion is waiting for your EA</h2><p>Your license connection is ready. Keep MetaTrader open with the licensed EA attached; this dashboard will populate after the first secure update.</p>{selected && <dl className={styles.waitingFacts}><div><dt>Account</dt><dd>{selected.accountType} {selected.maskedAccountNumber}</dd></div><div><dt>Platform</dt><dd>{selected.platform}</dd></div><div><dt>Device</dt><dd>{selected.installationHint}</dd></div></dl>}</div></div>;
}

function InlineEmpty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className={styles.inlineEmpty}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function connectionStatusView(state: TradingConnectionState) {
  if (state === 'online') return { label: 'EA connected', icon: <Wifi size={20} /> };
  if (state === 'delayed') return { label: 'Update delayed', icon: <Clock3 size={20} /> };
  if (state === 'offline') return { label: 'EA offline', icon: <WifiOff size={20} /> };
  return { label: 'Awaiting first sync', icon: <Radio size={20} /> };
}

function connectionStatusDetail(snapshot: TradingAnalyticsSnapshot) {
  if (snapshot.connection.state === 'never') return 'No EA update has been received yet.';
  if (!snapshot.connection.lastSeenAt) return snapshot.connection.label;
  return `${snapshot.connection.label} · ${formatDateTime(snapshot.connection.lastSeenAt, snapshot.period.timeZone)}`;
}

function isTradingAnalyticsSnapshot(value: unknown): value is TradingAnalyticsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Boolean(
    row.access && typeof row.access === 'object'
    && Array.isArray(row.connections)
    && ['ready', 'setup_required', 'waiting_first_sync'].includes(String(row.availability))
    && row.connection && typeof row.connection === 'object'
    && row.period && typeof row.period === 'object'
    && row.metrics && typeof row.metrics === 'object'
    && row.dataQuality && typeof row.dataQuality === 'object'
    && Array.isArray(row.equity)
    && Array.isArray(row.openPositions)
    && row.history && typeof row.history === 'object',
  );
}

function mergeTrades(current: ClosedTrade[], incoming: ClosedTrade[]) {
  const rows = new Map(current.map((trade) => [trade.id, trade]));
  incoming.forEach((trade) => rows.set(trade.id, trade));
  return [...rows.values()].sort((left, right) => Date.parse(right.closedAt) - Date.parse(left.closedAt));
}

function equitySummary(points: TradingEquityPoint[]) {
  if (!points.length) return [];
  const first = points[0];
  const last = points[points.length - 1];
  const high = points.reduce((top, point) => point.equity > top.equity ? point : top, first);
  const low = points.reduce((bottom, point) => point.equity < bottom.equity ? point : bottom, first);
  const values = [{ label: 'Start', point: first }, { label: 'High', point: high }, { label: 'Low', point: low }, { label: 'Latest', point: last }];
  return values.filter((item, index) => values.findIndex((candidate) => candidate.label === item.label || candidate.point.at === item.point.at && candidate.point.equity === item.point.equity) === index);
}

function apiError(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { error?: unknown }).error === 'string'
    ? (value as { error: string }).error
    : null;
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError';
}

function formatMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
}

function formatSignedMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = formatMoney(Math.abs(value), currency);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}`;
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function formatRatio(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

function formatDrawdown(money: number | null, percent: number | null, currency: string) {
  if (money === null || percent === null || !Number.isFinite(money) || !Number.isFinite(percent)) return '—';
  return `${formatMoney(money, currency)} · ${percent.toFixed(1)}%`;
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value) || value === 0) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function formatVolume(value: number) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function formatDateTime(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  try { return date.toLocaleString(undefined, { timeZone: timeZone || 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return date.toLocaleString(); }
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function compactNumber(value: number) {
  return Number.isFinite(value) ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value) : '—';
}

function metricTone(value: number | null | undefined): 'green' | 'red' | 'muted' {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'muted';
  return value > 0 ? 'green' : 'red';
}

function profitClass(value: number) {
  return value > 0 ? styles.positive : value < 0 ? styles.negative : styles.neutral;
}

const tooltipStyle = {
  color: '#f6f8f8',
  background: 'rgba(2, 5, 6, .97)',
  border: '1px solid rgba(255, 255, 255, .13)',
  borderRadius: 10,
  boxShadow: '0 20px 60px rgba(0, 0, 0, .55)',
  fontSize: 11,
};
