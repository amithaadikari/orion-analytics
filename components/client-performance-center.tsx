'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CircleAlert,
  Clock3,
  Download,
  Gauge,
  History,
  LoaderCircle,
  LockKeyhole,
  Radio,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wifi,
  WifiOff,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type {
  TradingAnalyticsRange,
  TradingConnectionState,
} from '@/lib/trading-analytics';
import {
  isTradingPerformanceSnapshot,
  type TradingPerformanceBreakdownItem,
  type TradingPerformanceDay,
  type TradingPerformanceReport,
  type TradingPerformanceSnapshot,
} from '@/lib/trading-performance';
import styles from './client-performance-center.module.css';

const rangeLabels: Record<TradingAnalyticsRange, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '365d': '1Y',
  all: 'All',
};

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const breakdownViews = ['symbols', 'directions', 'weekdays', 'sessions'] as const;
type BreakdownView = (typeof breakdownViews)[number];

const breakdownCopy: Record<BreakdownView, { tab: string; title: string; detail: string }> = {
  symbols: {
    tab: 'Symbol',
    title: 'Performance by symbol',
    detail: 'Fully closed positions grouped by their reported market symbol.',
  },
  directions: {
    tab: 'Direction',
    title: 'Buy and sell direction',
    detail: 'Completed positions grouped by their opening direction.',
  },
  weekdays: {
    tab: 'Weekday',
    title: 'Performance by closing weekday',
    detail: 'Completed positions grouped by their final-close weekday in UTC.',
  },
  sessions: {
    tab: 'Session',
    title: 'Performance by entry-time session',
    detail: 'Completed positions grouped into deterministic entry-time UTC windows.',
  },
};

type LoadOptions = {
  background?: boolean;
};

export default function ClientPerformanceCenter() {
  const [snapshot, setSnapshot] = useState<TradingPerformanceSnapshot | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [range, setRange] = useState<TradingAnalyticsRange>('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const skipNextSelectionLoad = useRef(false);
  const snapshotRef = useRef<TradingPerformanceSnapshot | null>(null);

  snapshotRef.current = snapshot;

  const load = useCallback(async ({ background = false }: LoadOptions = {}) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestId = ++requestSequence.current;
    const requestedConnectionId = connectionId;
    const hasLastGoodSnapshot = Boolean(snapshotRef.current);

    if (background && hasLastGoodSnapshot) setRefreshing(true);
    else setLoading(true);
    if (!background) setError('');

    try {
      const params = new URLSearchParams({ range });
      if (requestedConnectionId) params.set('connectionId', requestedConnectionId);
      const response = await fetch(`/api/trading-performance?${params}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTradingPerformanceSnapshot(payload)) {
        throw new Error(apiError(payload) || 'Your Performance Center is temporarily unavailable.');
      }
      if (controller.signal.aborted || requestId !== requestSequence.current) return;

      setSnapshot(payload);
      let selectionChanged = false;
      if (!requestedConnectionId && payload.selectedConnectionId) {
        selectionChanged = true;
        setConnectionId(payload.selectedConnectionId);
      }
      if (payload.period.range !== range) {
        selectionChanged = true;
        setRange(payload.period.range);
      }
      if (selectionChanged) skipNextSelectionLoad.current = true;
      setError('');
    } catch (reason) {
      if (isAbortError(reason) || requestId !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : 'Your Performance Center is temporarily unavailable.');
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    }
  }, [connectionId, range]);

  useEffect(() => {
    if (skipNextSelectionLoad.current) {
      skipNextSelectionLoad.current = false;
      return () => activeRequest.current?.abort();
    }
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);

  function selectConnection(nextConnectionId: string) {
    if (!nextConnectionId || nextConnectionId === connectionId) return;
    activeRequest.current?.abort();
    requestSequence.current += 1;
    activeRequest.current = null;
    skipNextSelectionLoad.current = false;
    setConnectionId(nextConnectionId);
    setRange('7d');
    setSnapshot(null);
    setError('');
    setRefreshing(false);
    setLoading(true);
  }

  function selectRange(nextRange: TradingAnalyticsRange) {
    if (nextRange === range) return;
    activeRequest.current?.abort();
    requestSequence.current += 1;
    activeRequest.current = null;
    skipNextSelectionLoad.current = false;
    setRange(nextRange);
    setSnapshot(null);
    setError('');
    setRefreshing(false);
    setLoading(true);
  }

  const connectionState = snapshot?.connection.state || 'never';
  const connectionView = connectionStatusView(connectionState);

  return (
    <section
      className={styles.shell}
      aria-labelledby="performance-center-title"
      aria-busy={loading || refreshing}
    >
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className="eyebrow">Verified trading intelligence</p>
          <h1 id="performance-center-title">Performance Center</h1>
          <p>
            Understand completed Orion trading results through a reconciled P&amp;L calendar,
            plan-aware metrics, and transparent breakdowns.
          </p>
        </div>
        <aside className={styles.accessCard} data-state={connectionState} aria-label="Performance access status">
          <span className={styles.accessIcon} aria-hidden="true">{connectionView.icon}</span>
          <div>
            <small>{snapshot ? 'Selected license access' : 'Secure analytics'}</small>
            <strong>{snapshot ? `${snapshot.access.plan} Performance` : 'Checking access…'}</strong>
            <p>{snapshot ? accessSummary(snapshot) : 'Confirming your licensed trading connection.'}</p>
          </div>
          {snapshot ? (
            <span className={styles.planBadge} data-plan={snapshot.access.plan.toLowerCase()}>
              {snapshot.access.plan}
            </span>
          ) : null}
        </aside>
      </header>

      {snapshot ? (
        <PerformanceControls
          snapshot={snapshot}
          range={range}
          refreshing={refreshing}
          onConnectionChange={selectConnection}
          onRangeChange={selectRange}
          onRefresh={() => void load({ background: true })}
        />
      ) : null}

      {error && snapshot ? (
        <div className={styles.staleAlert} role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>
            <strong>Couldn’t refresh performance intelligence</strong>
            <span>
              {error} Showing the last successful report
              {snapshot.dataAsOf ? ` from ${formatDateTime(snapshot.dataAsOf)}` : ''}.
            </span>
          </p>
          <button
            type="button"
            onClick={() => void load({ background: true })}
            disabled={refreshing}
          >
            {refreshing ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}

      {loading && !snapshot ? <LoadingState /> : null}
      {error && !snapshot && !loading ? <ErrorState message={error} retry={() => void load()} /> : null}
      {snapshot?.availability === 'setup_required' ? <SetupState plan={snapshot.access.plan} /> : null}
      {snapshot?.availability === 'waiting_first_sync' ? <WaitingState snapshot={snapshot} /> : null}
      {snapshot?.availability === 'ready' && snapshot.performance ? <ReadyCenter snapshot={snapshot} /> : null}
      {snapshot?.availability === 'ready' && !snapshot.performance ? <UnavailableReportState /> : null}
    </section>
  );
}

function PerformanceControls({
  snapshot,
  range,
  refreshing,
  onConnectionChange,
  onRangeChange,
  onRefresh,
}: {
  snapshot: TradingPerformanceSnapshot;
  range: TradingAnalyticsRange;
  refreshing: boolean;
  onConnectionChange: (connectionId: string) => void;
  onRangeChange: (range: TradingAnalyticsRange) => void;
  onRefresh: () => void;
}) {
  const selected = snapshot.connections.find((connection) => connection.id === snapshot.selectedConnectionId)
    || snapshot.connections[0];
  const canExport = snapshot.availability === 'ready'
    && Boolean(snapshot.performance)
    && snapshot.access.csvExport
    && Boolean(snapshot.selectedConnectionId);
  const exportParams = new URLSearchParams({
    connectionId: snapshot.selectedConnectionId || '',
    range: snapshot.period.range,
  });

  return (
    <div className={styles.controlBar} role="group" aria-label="Performance Center controls">
      <label className={styles.connectionPicker}>
        <span>Trading connection</span>
        <select
          value={snapshot.selectedConnectionId || selected?.id || ''}
          onChange={(event) => onConnectionChange(event.target.value)}
          disabled={snapshot.availability !== 'ready' || snapshot.connections.length < 2}
        >
          {!snapshot.connections.length ? <option value="">No connected EA</option> : null}
          {snapshot.connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.accountType} {connection.maskedAccountNumber} · {connection.platform} · {connection.plan}
            </option>
          ))}
        </select>
        {selected ? <small>{selected.brokerServer} · Device {selected.installationHint}</small> : null}
      </label>

      {snapshot.access.allowedRanges.length ? (
        <div className={styles.rangePicker} role="group" aria-label="Performance reporting period">
          <span>Reporting period</span>
          <div>
            {snapshot.access.allowedRanges.map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={range === option}
                onClick={() => onRangeChange(option)}
              >
                {rangeLabels[option]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.dataClock}>
        <span><Clock3 size={15} aria-hidden="true" /><small>Data as of</small></span>
        <strong>{snapshot.dataAsOf ? formatDateTime(snapshot.dataAsOf) : 'No update yet'}</strong>
        <small>UTC · {snapshot.period.label}</small>
      </div>

      <div className={styles.controlActions}>
        {canExport ? (
          <a
            className={styles.exportButton}
            href={`/api/trading-performance/export?${exportParams}`}
            aria-label={`Export ${snapshot.period.label.toLowerCase()} performance as CSV`}
          >
            <Download size={16} aria-hidden="true" />
            Export CSV
          </a>
        ) : null}
        <button
          className={styles.refreshButton}
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh Performance Center"
        >
          <RefreshCw size={16} className={refreshing ? styles.spin : undefined} aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

function ReadyCenter({ snapshot }: { snapshot: TradingPerformanceSnapshot }) {
  const report = snapshot.performance!;
  const currency = snapshot.account!.currency;
  const hasClosedTrades = report.overview.closedTrades > 0;
  const connectionStale = snapshot.connection.state === 'delayed' || snapshot.connection.state === 'offline';

  return (
    <div className={styles.dashboard}>
      {connectionStale ? (
        <div className={styles.connectionNotice} role="status">
          <WifiOff size={19} aria-hidden="true" />
          <p>
            <strong>{snapshot.connection.state === 'offline' ? 'EA offline' : 'EA update delayed'}</strong>
            <span>
              This historical report remains available, but the latest completed positions may not appear
              until the licensed EA reconnects.
            </span>
          </p>
        </div>
      ) : null}

      <section className={styles.overviewSection} aria-labelledby="performance-overview-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Period result</p>
            <h2 id="performance-overview-title">Performance overview</h2>
            <span>Fully closed positions for {snapshot.period.label.toLowerCase()}.</span>
          </div>
          <strong>{snapshot.access.plan} · {snapshot.period.label}</strong>
        </header>
        <div className={styles.overviewMetrics} aria-label="Performance overview metrics">
          <MetricCard
            icon={<BarChart3 size={19} />}
            label="Net P/L"
            value={formatSignedMoney(report.overview.realizedNet, currency)}
            detail="Realized result after reported costs"
            tone={metricTone(report.overview.realizedNet)}
          />
          <MetricCard
            icon={<History size={19} />}
            label="Closed trades"
            value={report.overview.closedTrades.toLocaleString()}
            detail="Fully completed positions"
            tone="cyan"
          />
          <MetricCard
            icon={<TrendingUp size={19} />}
            label="Win rate"
            value={formatPercent(report.overview.winRate)}
            detail="Winning completed positions"
            tone={report.overview.winRate === null ? 'muted' : 'green'}
          />
        </div>
      </section>

      <PerformanceCalendar
        days={report.calendar}
        range={snapshot.period.range}
        window={report.window}
        coverageStart={snapshot.dataQuality.coverageStart}
        currency={currency}
        hasClosedTrades={hasClosedTrades}
      />

      {snapshot.access.advancedMetrics ? (
        <AdvancedMetrics snapshot={snapshot} />
      ) : (
        <PremiumLock />
      )}

      {snapshot.access.breakdowns ? (
        <BreakdownTabs
          breakdowns={report.breakdowns}
          currency={currency}
        />
      ) : null}

      <Methodology snapshot={snapshot} />
    </div>
  );
}

function PerformanceCalendar({
  days,
  range,
  window,
  coverageStart,
  currency,
  hasClosedTrades,
}: {
  days: TradingPerformanceDay[];
  range: TradingAnalyticsRange;
  window: TradingPerformanceReport['window'];
  coverageStart: string | null;
  currency: string;
  hasClosedTrades: boolean;
}) {
  const months = useMemo(
    () => calendarMonths(range, days, window, coverageStart),
    [coverageStart, days, range, window],
  );

  return (
    <section className={styles.calendarPanel} aria-labelledby="performance-calendar-title">
      <header className={styles.sectionHeading}>
        <div>
          <p className="eyebrow">Daily realized result</p>
          <h2 id="performance-calendar-title">P&amp;L calendar</h2>
          <span>Each result is assigned to the position’s final-close date in UTC.</span>
        </div>
        <strong><CalendarDays size={14} aria-hidden="true" /> UTC calendar</strong>
      </header>

      <div className={styles.calendarLegend} aria-label="Calendar result legend">
        <span data-tone="positive"><i aria-hidden="true" />Profit</span>
        <span data-tone="negative"><i aria-hidden="true" />Loss</span>
        <span data-tone="flat"><i aria-hidden="true" />Flat</span>
        <span data-tone="empty"><i aria-hidden="true" />No trades</span>
      </div>

      {!hasClosedTrades ? (
        <div className={styles.calendarEmpty} role="status">
          <CalendarDays size={24} aria-hidden="true" />
          <div>
            <strong>No closed trades in this period</strong>
            <p>The calendar remains empty until Orion receives a fully closed position in this reporting window.</p>
          </div>
        </div>
      ) : null}

      <div className={styles.monthList}>
        {months.map((month) => (
          <CalendarMonth key={month.key} month={month} currency={currency} />
        ))}
      </div>
    </section>
  );
}

type CalendarSlot = {
  date: string;
  dayNumber: number;
  result: TradingPerformanceDay | null;
};

type CalendarMonthView = {
  key: string;
  label: string;
  leadingBlanks: number;
  slots: CalendarSlot[];
};

function CalendarMonth({ month, currency }: { month: CalendarMonthView; currency: string }) {
  return (
    <section className={styles.calendarMonth} aria-labelledby={`performance-month-${month.key}`}>
      <h3 id={`performance-month-${month.key}`}>{month.label}</h3>
      <div className={styles.weekdayRow} aria-hidden="true">
        {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <ol className={styles.calendarGrid} aria-label={`${month.label} daily trading results`}>
        {Array.from({ length: month.leadingBlanks }, (_, index) => (
          <li className={styles.calendarBlank} aria-hidden="true" key={`blank-${index}`} />
        ))}
        {month.slots.map((slot) => {
          const tone = calendarTone(slot.result);
          const label = calendarAriaLabel(slot, currency);
          return (
            <li className={styles.calendarDay} data-tone={tone} aria-label={label} key={slot.date}>
              <time dateTime={slot.date}>{slot.dayNumber}</time>
              <strong>{slot.result ? formatSignedMoney(slot.result.netProfit, currency) : '—'}</strong>
              <small>
                {slot.result
                  ? `${slot.result.closedTrades} trade${slot.result.closedTrades === 1 ? '' : 's'}`
                  : 'No trades'}
              </small>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AdvancedMetrics({ snapshot }: { snapshot: TradingPerformanceSnapshot }) {
  const overview = snapshot.performance!.overview;
  const metrics = snapshot.performance!.metrics;
  const currency = snapshot.account!.currency;
  return (
    <section className={styles.advancedPanel} aria-labelledby="advanced-performance-title">
      <header className={styles.sectionHeading}>
        <div>
          <p className="eyebrow">Advanced intelligence</p>
          <h2 id="advanced-performance-title">Advanced performance metrics</h2>
          <span>Completed-position statistics for {snapshot.period.label.toLowerCase()}.</span>
        </div>
        <strong>{snapshot.access.plan} analytics</strong>
      </header>
      <div className={styles.advancedMetrics} aria-label="Advanced performance metrics">
        <MetricCard
          icon={<Gauge size={18} />}
          label="Profit factor"
          value={formatFactor(overview.profitFactor)}
          detail="Gross profit divided by gross loss"
          tone={factorTone(overview.profitFactor)}
          compact
        />
        <MetricCard
          icon={<TrendingDown size={18} />}
          label="Maximum drawdown"
          value={formatMoney(overview.maxDrawdownMoney, currency)}
          detail="Largest observed peak-to-trough equity fall"
          tone={drawdownTone(overview.maxDrawdownMoney)}
          compact
        />
        <MetricCard
          icon={<Activity size={18} />}
          label="Drawdown percent"
          value={formatPercent(overview.maxDrawdownPercent)}
          detail="Largest observed equity decline as a percentage"
          tone={drawdownTone(overview.maxDrawdownPercent)}
          compact
        />
        <MetricCard
          icon={<TrendingUp size={18} />}
          label="Average win"
          value={formatSignedMoney(metrics.averageWin, currency)}
          detail="Mean result across winning trades"
          tone={metricTone(metrics.averageWin)}
          compact
        />
        <MetricCard
          icon={<TrendingDown size={18} />}
          label="Average loss"
          value={formatSignedMoney(metrics.averageLoss, currency)}
          detail="Mean result across losing trades"
          tone={metricTone(metrics.averageLoss)}
          compact
        />
        <MetricCard
          icon={<Target size={18} />}
          label="Expectancy"
          value={formatSignedMoney(metrics.expectancy, currency)}
          detail="Average net result per closed trade"
          tone={metricTone(metrics.expectancy)}
          compact
        />
        <MetricCard
          icon={<Trophy size={18} />}
          label="Best trade"
          value={formatSignedMoney(metrics.bestTrade, currency)}
          detail="Strongest completed-position result"
          tone={metricTone(metrics.bestTrade)}
          compact
        />
        <MetricCard
          icon={<CircleAlert size={18} />}
          label="Worst trade"
          value={formatSignedMoney(metrics.worstTrade, currency)}
          detail="Weakest completed-position result"
          tone={metricTone(metrics.worstTrade)}
          compact
        />
        <MetricCard
          icon={<Activity size={18} />}
          label="Longest win streak"
          value={formatStreak(metrics.maxWinStreak)}
          detail="Consecutive winning positions"
          tone={metrics.maxWinStreak === null ? 'muted' : 'green'}
          compact
        />
        <MetricCard
          icon={<Gauge size={18} />}
          label="Longest loss streak"
          value={formatStreak(metrics.maxLossStreak)}
          detail="Consecutive losing positions"
          tone={metrics.maxLossStreak === null ? 'muted' : 'red'}
          compact
        />
      </div>
    </section>
  );
}

function PremiumLock() {
  return (
    <section className={styles.premiumLock} aria-labelledby="performance-premium-lock-title">
      <span className={styles.lockIcon} aria-hidden="true"><LockKeyhole size={23} /></span>
      <div className={styles.lockCopy}>
        <p className="eyebrow">Premium intelligence</p>
        <h2 id="performance-premium-lock-title">Unlock advanced performance intelligence</h2>
        <p>Your Basic access includes the seven-day overview and P&amp;L calendar.</p>
        <ul>
          <li><ShieldCheck size={14} aria-hidden="true" />Average win/loss, expectancy, best/worst trades, and streaks</li>
          <li><ShieldCheck size={14} aria-hidden="true" />Symbol, direction, weekday, and UTC session breakdowns</li>
          <li><ShieldCheck size={14} aria-hidden="true" />Up to 90 days of reporting with secure CSV export</li>
        </ul>
      </div>
      <Link href="/checkout?plan=premium">
        Review Premium
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}

function BreakdownTabs({
  breakdowns,
  currency,
}: {
  breakdowns: NonNullable<TradingPerformanceSnapshot['performance']>['breakdowns'];
  currency: string;
}) {
  const rawId = useId();
  const id = `performance-breakdowns-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [activeView, setActiveView] = useState<BreakdownView>('symbols');
  const tabRefs = useRef<Record<BreakdownView, HTMLButtonElement | null>>({
    symbols: null,
    directions: null,
    weekdays: null,
    sessions: null,
  });

  function activateView(view: BreakdownView) {
    setActiveView(view);
    tabRefs.current[view]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: BreakdownView) {
    const currentIndex = breakdownViews.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % breakdownViews.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + breakdownViews.length) % breakdownViews.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = breakdownViews.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateView(breakdownViews[nextIndex]);
  }

  return (
    <section className={styles.breakdownWorkspace} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHeading}>
        <div>
          <p className="eyebrow">Performance drivers</p>
          <h2 id={`${id}-title`}>Performance breakdowns</h2>
          <span>Compare reconciled closed-position results without counting partial exits twice.</span>
        </div>
        <strong>4 verified views</strong>
      </header>

      <div className={styles.breakdownTabs} role="tablist" aria-label="Performance breakdown view">
        {breakdownViews.map((view) => {
          const rows = breakdowns[view];
          return (
            <button
              ref={(node) => { tabRefs.current[view] = node; }}
              type="button"
              role="tab"
              id={`${id}-${view}-tab`}
              aria-label={`${breakdownCopy[view].tab}, ${rows.length} categories`}
              aria-selected={activeView === view}
              aria-controls={`${id}-${view}-panel`}
              tabIndex={activeView === view ? 0 : -1}
              onClick={() => setActiveView(view)}
              onKeyDown={(event) => handleTabKeyDown(event, view)}
              key={view}
            >
              <span>{breakdownCopy[view].tab}</span>
              <small aria-hidden="true">{rows.length}</small>
            </button>
          );
        })}
      </div>

      {breakdownViews.map((view) => (
        <div
          className={styles.breakdownPanel}
          role="tabpanel"
          id={`${id}-${view}-panel`}
          aria-labelledby={`${id}-${view}-tab`}
          hidden={activeView !== view}
          tabIndex={activeView === view ? 0 : -1}
          key={view}
        >
          <BreakdownPanel
            view={view}
            rows={breakdowns[view]}
            currency={currency}
          />
        </div>
      ))}
    </section>
  );
}

function BreakdownPanel({
  view,
  rows,
  currency,
}: {
  view: BreakdownView;
  rows: TradingPerformanceBreakdownItem[];
  currency: string;
}) {
  const maximum = Math.max(0, ...rows.map((row) => Math.abs(row.netProfit)));
  return (
    <div className={styles.breakdownView}>
      <header>
        <div>
          <h3>{breakdownCopy[view].title}</h3>
          <p>{breakdownCopy[view].detail}</p>
        </div>
        <strong>{rows.length} categor{rows.length === 1 ? 'y' : 'ies'}</strong>
      </header>

      {!rows.length ? (
        <InlineEmpty
          icon={<BarChart3 size={23} />}
          title="No breakdown data in this period"
          detail="Choose another available range or wait for Orion to receive a completed position."
        />
      ) : (
        <>
          <ul className={styles.breakdownChart} aria-label={`${breakdownCopy[view].title} chart`}>
            {rows.map((row) => {
              const width = maximum > 0 ? Math.max(3, Math.abs(row.netProfit) / maximum * 100) : 3;
              const barStyle = { '--bar-size': `${width}%` } as CSSProperties;
              return (
                <li
                  key={row.key}
                  data-tone={metricTone(row.netProfit)}
                  aria-label={`${row.label}: ${formatSignedMoney(row.netProfit, currency)}, ${row.closedTrades} closed trades, ${formatPercent(row.winRate)} win rate`}
                >
                  <div className={styles.breakdownIdentity}>
                    <strong>{row.label}</strong>
                    <small>{row.closedTrades} trade{row.closedTrades === 1 ? '' : 's'}</small>
                  </div>
                  <span className={styles.breakdownTrack} aria-hidden="true">
                    <i style={barStyle} />
                  </span>
                  <div className={styles.breakdownResult}>
                    <strong>{formatSignedMoney(row.netProfit, currency)}</strong>
                    <small>{formatPercent(row.winRate)} win rate</small>
                  </div>
                </li>
              );
            })}
          </ul>
          <details className={styles.breakdownData}>
            <summary>View {breakdownCopy[view].tab.toLowerCase()} data table</summary>
            <div>
              <table>
                <caption className={styles.srOnly}>{breakdownCopy[view].title}</caption>
                <thead>
                  <tr><th>Category</th><th>Net P/L</th><th>Trades</th><th>Win rate</th><th>Average</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{formatSignedMoney(row.netProfit, currency)}</td>
                      <td>{row.closedTrades}</td>
                      <td>{formatPercent(row.winRate)}</td>
                      <td>{formatSignedMoney(row.averageNet, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Methodology({ snapshot }: { snapshot: TradingPerformanceSnapshot }) {
  const quality = snapshot.dataQuality;
  return (
    <aside className={styles.methodology} aria-labelledby="performance-methodology-title">
      <span aria-hidden="true"><ShieldCheck size={21} /></span>
      <div>
        <p className="eyebrow">Transparent methodology</p>
        <h2 id="performance-methodology-title">How Orion assigns performance</h2>
        <ul>
          <li>
            Calendar and weekday results use the final-close date in UTC.
            Partial exits are rolled into the fully closed position and counted once.
          </li>
          <li>
            Session results use deterministic entry-time UTC windows because the EA telemetry
            does not contain a native trading-session field.
          </li>
          {quality.incompleteHistoryExcluded ? (
            <li>Older positions missing a verifiable opening record are excluded rather than estimated.</li>
          ) : null}
          {quality.volumeMismatchExcluded ? (
            <li>Positions whose opening and closing volumes could not be reconciled are excluded rather than estimated.</li>
          ) : null}
          {quality.nettingReversalsExcluded ? (
            <li>MT5 InOut netting reversals that cannot be split reliably are excluded.</li>
          ) : null}
          {!quality.equityCoverageComplete ? (
            <li>
              Maximum drawdown is unavailable because complete equity coverage was not verified
              {quality.equityCoverageStart ? ` before ${formatDate(quality.equityCoverageStart)}` : ''}.
            </li>
          ) : null}
        </ul>
      </div>
    </aside>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'gold' | 'cyan' | 'green' | 'red' | 'orange' | 'muted';
  compact?: boolean;
}) {
  return (
    <article className={styles.metricCard} data-tone={tone} data-compact={compact}>
      <span aria-hidden="true">{icon}</span>
      <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
    </article>
  );
}

function LoadingState() {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <span><LoaderCircle size={21} className={styles.spin} aria-hidden="true" />Loading your performance intelligence…</span>
      <div>{Array.from({ length: 3 }, (_, index) => <i key={index} />)}</div>
    </div>
  );
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className={styles.fullState} data-tone="error" role="alert">
      <span aria-hidden="true"><CircleAlert size={28} /></span>
      <div>
        <p className="eyebrow">Verified report unavailable</p>
        <h2>Performance Center could not load</h2>
        <p>{message} No performance result has been estimated or invented.</p>
      </div>
      <button type="button" onClick={retry}>Try again<RefreshCw size={15} aria-hidden="true" /></button>
    </div>
  );
}

function SetupState({ plan }: { plan: string }) {
  return (
    <div className={styles.fullState} data-tone="setup">
      <span aria-hidden="true"><LockKeyhole size={28} /></span>
      <div>
        <p className="eyebrow">Connection required</p>
        <h2>Complete your Orion trading setup</h2>
        <p>
          {plan === 'Free'
            ? 'Choose an Orion edition, activate its license, and connect your MetaTrader installation before performance can be reported.'
            : 'Register your trading account and approve the licensed EA installation before performance can synchronize.'}
        </p>
        <div className={styles.stateLinks}>
          <Link href="/portal#trading-accounts">Open account setup<ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/portal#license-pairing">Check device pairing</Link>
        </div>
      </div>
    </div>
  );
}

function WaitingState({ snapshot }: { snapshot: TradingPerformanceSnapshot }) {
  const selected = snapshot.connections[0];
  return (
    <div className={styles.fullState} data-tone="waiting">
      <span aria-hidden="true"><Radio size={28} /></span>
      <div>
        <p className="eyebrow">First synchronization pending</p>
        <h2>Orion is waiting for your first sync</h2>
        <p>
          Keep MetaTrader open with the licensed Orion EA attached. Performance will appear after
          Orion receives the first verified account update and a completed position.
        </p>
        {selected ? (
          <dl className={styles.waitingFacts}>
            <div><dt>Account</dt><dd>{selected.accountType} {selected.maskedAccountNumber}</dd></div>
            <div><dt>Platform</dt><dd>{selected.platform}</dd></div>
            <div><dt>Plan</dt><dd>{selected.plan}</dd></div>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

function UnavailableReportState() {
  return (
    <div className={styles.fullState} data-tone="waiting" role="status">
      <span aria-hidden="true"><BarChart3 size={28} /></span>
      <div>
        <p className="eyebrow">Report pending</p>
        <h2>No performance report is available yet</h2>
        <p>Orion received the connection but has not produced a verified completed-position report for this period.</p>
      </div>
    </div>
  );
}

function InlineEmpty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className={styles.inlineEmpty}>
      <span aria-hidden="true">{icon}</span>
      <div><strong>{title}</strong><p>{detail}</p></div>
    </div>
  );
}

function accessSummary(snapshot: TradingPerformanceSnapshot) {
  if (snapshot.access.plan === 'Lifetime') return 'All recorded history and advanced intelligence';
  if (snapshot.access.plan === 'Premium') return 'Up to 90 days, advanced breakdowns, and CSV';
  if (snapshot.access.plan === 'Basic') return 'Seven-day overview and P&L calendar';
  return snapshot.availability === 'setup_required' ? 'Choose a plan to activate performance access' : snapshot.connection.label;
}

function connectionStatusView(state: TradingConnectionState) {
  if (state === 'online') return { icon: <Wifi size={21} /> };
  if (state === 'delayed') return { icon: <Clock3 size={21} /> };
  if (state === 'offline') return { icon: <WifiOff size={21} /> };
  return { icon: <Radio size={21} /> };
}

function calendarMonths(
  range: TradingAnalyticsRange,
  days: TradingPerformanceDay[],
  window: TradingPerformanceReport['window'],
  coverageStart: string | null,
): CalendarMonthView[] {
  const results = new Map(days.map((day) => [day.date, day]));
  const end = utcDay(window.endAt) || new Date();
  let start: Date;
  if (range === 'all') {
    start = utcDay(coverageStart || window.startAt || days[0]?.date)
      || new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  } else {
    const count = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - count + 1));
  }
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  if (start > endDay) start = endDay;
  const byMonth = new Map<string, CalendarSlot[]>();
  for (let cursor = start; cursor <= endDay; cursor = addUtcDays(cursor, 1)) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    const date = cursor.toISOString().slice(0, 10);
    const slots = byMonth.get(key) || [];
    slots.push({
      date,
      dayNumber: cursor.getUTCDate(),
      result: results.get(date) || null,
    });
    byMonth.set(key, slots);
  }

  return [...byMonth.entries()].map(([key, slots]) => {
    const first = utcDay(slots[0]?.date) || endDay;
    return {
      key,
      label: first.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }),
      leadingBlanks: (first.getUTCDay() + 6) % 7,
      slots,
    };
  });
}

function calendarTone(day: TradingPerformanceDay | null): 'positive' | 'negative' | 'flat' | 'empty' {
  if (!day) return 'empty';
  if (day.netProfit > 0) return 'positive';
  if (day.netProfit < 0) return 'negative';
  return 'flat';
}

function calendarAriaLabel(slot: CalendarSlot, currency: string) {
  const date = formatDate(slot.date);
  if (!slot.result) return `${date}: no closed trades`;
  const direction = slot.result.netProfit > 0 ? 'profit' : slot.result.netProfit < 0 ? 'loss' : 'flat result';
  return `${date}: ${direction} ${formatMoney(Math.abs(slot.result.netProfit), currency)}, ${slot.result.closedTrades} closed trade${slot.result.closedTrades === 1 ? '' : 's'}`;
}

function utcDay(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function addUtcDays(value: Date, days: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));
}

function apiError(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { error?: unknown }).error === 'string'
    ? (value as { error: string }).error
    : null;
}

function isAbortError(reason: unknown) {
  return reason instanceof Error && reason.name === 'AbortError';
}

function formatMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function formatSignedMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = formatMoney(Math.abs(value), currency);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}`;
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function formatFactor(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}×`;
}

function formatStreak(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString()} trade${value === 1 ? '' : 's'}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function metricTone(value: number | null | undefined): 'green' | 'red' | 'muted' {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'muted';
  return value > 0 ? 'green' : 'red';
}

function factorTone(value: number | null): 'green' | 'red' | 'muted' {
  if (value === null || !Number.isFinite(value)) return 'muted';
  return value >= 1 ? 'green' : 'red';
}

function drawdownTone(value: number | null): 'orange' | 'muted' {
  return value !== null && Number.isFinite(value) && value > 0 ? 'orange' : 'muted';
}
