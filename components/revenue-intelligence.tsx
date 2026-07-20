'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { formatMoneyWithCode as formatAmount } from '@/lib/money';
import { buildRenewalCalendar, type RevenueIntelligenceSnapshot } from '@/lib/revenue-intelligence';
import styles from './revenue-intelligence.module.css';

type RevenueIntelligenceResponse = RevenueIntelligenceSnapshot & {
  canEditGoals: boolean;
};

type GoalBarStyle = CSSProperties & { '--goal-progress': string };
type BarStyle = CSSProperties & { '--trend-height': string };
type GoalFeedback = { kind: 'success' | 'error'; message: string };

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RevenueIntelligence() {
  const [data, setData] = useState<RevenueIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingCurrency, setSavingCurrency] = useState('');
  const [goalFeedback, setGoalFeedback] = useState<GoalFeedback | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/revenue-intelligence', { cache: 'no-store', credentials: 'same-origin', signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Unable to load revenue intelligence.');
      setData(payload as RevenueIntelligenceResponse);
      return true;
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return false;
      setError(reason instanceof Error ? reason.message : 'Unable to load revenue intelligence.');
      return false;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const calendar = useMemo(() => data ? buildRenewalCalendar(data.renewals) : [], [data]);

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canEditGoals) return;
    const form = event.currentTarget;
    const isNewGoal = form.dataset.newGoal === 'true';
    const values = new FormData(form);
    const currency = String(values.get('currency') || '').trim().toUpperCase();
    const targetAmount = String(values.get('target_amount') || '').trim();
    setSavingCurrency(currency);
    setGoalFeedback(null);
    try {
      if (isNewGoal && data.goals.some((goal) => goal.currency === currency)) throw new Error(`${currency} already appears above. Use its Edit target control instead.`);
      const response = await fetch('/api/revenue-intelligence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ period_month: data.periodMonth, currency, target_amount: targetAmount }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Unable to save the revenue goal.');
      const refreshed = await load();
      if (!refreshed) throw new Error(`${currency} was saved, but the refreshed target could not be confirmed. Refresh the page before editing it again.`);
      setGoalFeedback({ kind: 'success', message: `${currency} target saved for ${data.monthLabel}.` });
      if (isNewGoal) form.reset();
    } catch (reason) {
      setGoalFeedback({ kind: 'error', message: reason instanceof Error ? reason.message : 'Unable to save the revenue goal.' });
    } finally {
      setSavingCurrency('');
    }
  }

  if (loading && !data) return <RevenueLoading />;

  if (error && !data) {
    return (
      <section className={`${styles.shell} ${styles.stateShell}`} aria-labelledby="revenue-intelligence-title">
        <RevenueHeader refreshing={false} onRefresh={() => void load()} />
        <div className={styles.errorState} role="alert"><span aria-hidden="true">!</span><div><strong>Revenue intelligence unavailable</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>Try again</button></div>
      </section>
    );
  }

  if (!data) return null;

  const trendMaximum = Math.max(1, ...data.exceptions.trend.map((point) => Math.max(point.refunded, point.failed, point.disputed)));

  return (
    <section className={styles.shell} aria-labelledby="revenue-intelligence-title" aria-busy={loading}>
      <RevenueHeader refreshing={loading} onRefresh={() => void load()} />
      {error && <div className={styles.inlineError} role="alert"><span aria-hidden="true">!</span>{error}</div>}

      <details className={styles.methodology}>
        <summary>Calculation methodology</summary>
        <ol>{data.methodology.map((item) => <li key={item}>{item}</li>)}</ol>
      </details>

      <div className={styles.primaryGrid}>
        <section className={`${styles.panel} ${styles.mrrPanel}`} aria-labelledby="revenue-mrr-title">
          <PanelHeading kicker="Normalized recurring value" title="MRR by currency" id="revenue-mrr-title" badge="No FX conversion" />
          {data.mrr.byCurrency.length ? (
            <div className={styles.mrrCurrencies}>
              {data.mrr.byCurrency.map((row) => <article className={styles.mrrCard} key={row.currency}><span>{row.currency}</span><strong>{formatAmount(row.amount, row.currency)}</strong><small>{row.licenseCount} matched {row.licenseCount === 1 ? 'license' : 'licenses'}</small></article>)}
            </div>
          ) : <EmptyState title="No normalized MRR available" detail="No active qualifying term license currently has a completed matching payment." />}
          <dl className={styles.mrrAudit}>
            <div><dt>Eligible term licenses</dt><dd>{data.mrr.eligibleLicenseCount}</dd></div>
            <div><dt>Matched payments</dt><dd>{data.mrr.matchedLicenseCount}</dd></div>
            <div><dt>Unmatched licenses</dt><dd>{data.mrr.unmatchedLicenseCount}</dd></div>
            <div><dt>Lifetime excluded</dt><dd>{data.mrr.excludedLifetimeCount}</dd></div>
          </dl>
        </section>

        <MonthlyGoalsPanel data={data} savingCurrency={savingCurrency} feedback={goalFeedback} onSave={saveGoal} />
      </div>

      <section className={`${styles.panel} ${styles.renewalPanel}`} aria-labelledby="revenue-renewals-title">
        <PanelHeading kicker="Forward calendar" title="90-day renewals" id="revenue-renewals-title" badge={`${data.renewals.entries.length} scheduled`} />
        <p className={styles.sectionNote}>Active Basic and Premium licenses expiring from <time dateTime={data.renewals.windowStart}>{formatDate(data.renewals.windowStart)}</time> through <time dateTime={data.renewals.windowEnd}>{formatDate(data.renewals.windowEnd)}</time>.</p>
        {!data.renewals.entries.length && <EmptyState title="No renewals in this window" detail="There are no active term licenses with an expiry date in the next 90 days." />}
        <div className={styles.calendarScroller}>
          <div className={styles.calendarMonths}>
            {calendar.map((month) => <article className={styles.calendarMonth} key={month.key}><header><h3>{month.label}</h3><span>{month.days.reduce((total, day) => total + day.entries.length, 0)} renewals</span></header><div className={styles.weekdays} aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div><div className={styles.monthGrid} role="grid" aria-label={`${month.label} renewal calendar`}>{Array.from({ length: month.leadingBlankDays }, (_, index) => <span className={styles.blankDay} role="presentation" key={`blank-${index}`} />)}{month.days.map((day) => <div className={`${styles.calendarDay} ${!day.inWindow ? styles.outsideWindow : ''} ${day.isToday ? styles.today : ''} ${day.entries.length ? styles.hasRenewal : ''}`} role="gridcell" aria-disabled={!day.inWindow} aria-label={`${month.label} ${day.day}: ${day.entries.length} ${day.entries.length === 1 ? 'renewal' : 'renewals'}`} key={day.date}><time dateTime={day.date}>{day.day}</time>{day.entries.slice(0, 2).map((entry) => <span className={styles.renewalChip} title={`${entry.clientName} · ${entry.plan} · ${entry.platform}`} key={entry.licenseId}><strong>{entry.clientName}</strong><small>{entry.plan} · {entry.platform}</small></span>)}{day.entries.length > 2 && <span className={styles.moreRenewals}>+{day.entries.length - 2} more</span>}</div>)}</div></article>)}
          </div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.exceptionPanel}`} aria-labelledby="revenue-exceptions-title">
        <PanelHeading kicker="Payment exceptions" title="Refund, failure and dispute signals" id="revenue-exceptions-title" badge="Latest 90 days" />
        <div className={styles.exceptionKpis}>{data.exceptions.kpis.map((kpi) => <article className={`${styles.exceptionCard} ${styles[`status${kpi.status}`]}`} key={kpi.status}><span>{kpi.status}</span><strong>{kpi.count}</strong><small>{kpi.count === 1 ? 'record' : 'records'}</small>{kpi.amounts.length ? <ul>{kpi.amounts.map((amount) => <li key={amount.currency}>{formatAmount(amount.amount, amount.currency)}</li>)}</ul> : <p>No recorded amount</p>}</article>)}</div>
        <div className={styles.trendRegion}>
          <div className={styles.trendHeading}><div><strong>Weekly record trend</strong><span>{formatDate(data.exceptions.windowStart)} – {formatDate(data.exceptions.windowEnd)}</span></div><div className={styles.legend}><span><i className={styles.refundedLegend} />Refunded</span><span><i className={styles.failedLegend} />Failed</span><span><i className={styles.disputedLegend} />Disputed</span></div></div>
          <ol className={styles.trendChart} aria-label="Weekly refund, failed-payment, and dispute record counts over the latest 90 days">{data.exceptions.trend.map((point) => <li key={point.periodStart} aria-label={`${point.label}: ${point.refunded} refunded, ${point.failed} failed, ${point.disputed} disputed`}><div className={styles.trendPlot} aria-hidden="true"><i className={styles.refundedBar} style={barHeight(point.refunded, trendMaximum)} /><i className={styles.failedBar} style={barHeight(point.failed, trendMaximum)} /><i className={styles.disputedBar} style={barHeight(point.disputed, trendMaximum)} /></div><strong>{point.total}</strong><time dateTime={point.periodStart}>{point.label}</time></li>)}</ol>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.currencyPanel}`} aria-labelledby="revenue-currency-title">
        <PanelHeading kicker="Currency ledger" title="Separate currency summary" id="revenue-currency-title" badge="No blended totals" />
        {data.currencies.length ? <div className={styles.tableWrap}><table><caption>Revenue, normalized MRR, goals, and exception amounts shown separately for every recorded currency.</caption><thead><tr><th scope="col">Currency</th><th scope="col">Revenue this month</th><th scope="col">Normalized MRR</th><th scope="col">Goal</th><th scope="col">Refunded · 90d</th><th scope="col">Failed · 90d</th><th scope="col">Disputed · 90d</th></tr></thead><tbody>{data.currencies.map((row) => <tr key={row.currency}><th scope="row">{row.currency}</th><td>{formatAmount(row.revenueMonth, row.currency)}</td><td>{formatAmount(row.normalizedMrr, row.currency)}</td><td>{row.goalTarget ? <><span>{formatAmount(row.goalTarget, row.currency)}</span><small>{formatPercent(row.goalProgressPercent || 0)}</small></> : 'Not set'}</td><td>{formatAmount(row.refunded90d, row.currency)}</td><td>{formatAmount(row.failed90d, row.currency)}</td><td>{formatAmount(row.disputed90d, row.currency)}</td></tr>)}</tbody></table></div> : <EmptyState title="No currency records available" detail="Currency summaries appear after a payment, normalized MRR match, or revenue goal exists." />}
      </section>
    </section>
  );
}

function MonthlyGoalsPanel({ data, savingCurrency, feedback, onSave }: {
  data: RevenueIntelligenceResponse;
  savingCurrency: string;
  feedback: GoalFeedback | null;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const targetsSet = data.goals.filter((goal) => Boolean(goal.targetAmount)).length;
  const achieved = data.goals.filter((goal) => Boolean(goal.targetAmount) && (goal.progressPercent || 0) >= 100).length;
  const timing = monthTiming(data.periodMonth, data.generatedAt);
  return (
    <section className={`${styles.panel} ${styles.goalsPanel}`} aria-labelledby="revenue-goals-title">
      <header className={styles.goalsHeader}>
        <div><p>Monthly target command</p><h3 id="revenue-goals-title">{data.monthLabel} goals</h3><span>Track each currency separately against calendar pace.</span></div>
        <span>{data.canEditGoals ? 'Targets editable' : 'Read only'}</span>
      </header>
      <dl className={styles.goalSummary}>
        <div><dt>Currencies tracked</dt><dd>{data.goals.length}</dd></div>
        <div><dt>Targets set</dt><dd>{targetsSet}</dd></div>
        <div><dt>Goals achieved</dt><dd>{achieved}</dd></div>
        <div><dt>UTC month elapsed</dt><dd>{formatPercent(timing.calendarProgress)}</dd></div>
      </dl>
      {data.goals.length ? <div className={styles.goalGrid}>{data.goals.map((goal) => <MonthlyGoalCard key={goal.currency} goal={goal} timing={timing} canEdit={data.canEditGoals} saving={savingCurrency === goal.currency} savingAny={Boolean(savingCurrency)} onSave={onSave} />)}</div> : <EmptyState title="No currency goals yet" detail="Monthly goal cards appear when completed revenue or a saved target exists for a currency." />}
      {data.canEditGoals && (
        <details className={styles.addGoalDisclosure}>
          <summary><span aria-hidden="true">＋</span><div><strong>Add a currency target</strong><small>Create a target only for a currency not already shown above.</small></div><b aria-hidden="true">⌄</b></summary>
          <form className={styles.addGoalForm} data-new-goal="true" onSubmit={onSave}>
            <label><span>Currency</span><input name="currency" inputMode="text" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" placeholder="USD" required /></label>
            <label><span>Target amount</span><input name="target_amount" type="number" min="0.01" max="999999999999.99" step="0.01" placeholder="5000" required /></label>
            <button type="submit" disabled={Boolean(savingCurrency)}>{savingCurrency ? 'Saving…' : 'Add target'}</button>
          </form>
        </details>
      )}
      {feedback && <p className={`${styles.goalStatus} ${feedback.kind === 'error' ? styles.goalStatusError : styles.goalStatusSuccess}`} role={feedback.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{feedback.message}</p>}
    </section>
  );
}

function MonthlyGoalCard({ goal, timing, canEdit, saving, savingAny, onSave }: {
  goal: RevenueIntelligenceSnapshot['goals'][number];
  timing: ReturnType<typeof monthTiming>;
  canEdit: boolean;
  saving: boolean;
  savingAny: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const target = goal.targetAmount || 0;
  const rawProgress = goal.progressPercent || 0;
  const visualProgress = Math.max(0, Math.min(100, rawProgress));
  const remaining = Math.max(0, target - goal.actualAmount);
  const exceeded = Math.max(0, goal.actualAmount - target);
  const dailyNeeded = remaining && timing.remainingDays ? remaining / timing.remainingDays : 0;
  const state = !goal.targetAmount ? 'unset' : rawProgress >= 100 ? 'achieved' : rawProgress >= timing.calendarProgress ? 'pace' : 'behind';
  const stateLabel = state === 'achieved' ? 'Goal achieved' : state === 'pace' ? 'On calendar pace' : state === 'behind' ? 'Behind calendar pace' : 'Target not set';
  const barStyle: GoalBarStyle = { '--goal-progress': `${visualProgress}%` };
  return (
    <article className={`${styles.goalCard} ${styles[`goal${state[0].toUpperCase()}${state.slice(1)}`]}`} aria-busy={saving}>
      <header><span>{goal.currency}</span><b>{stateLabel}</b></header>
      <div className={styles.goalAmounts}><span><small>Completed revenue</small><strong>{formatAmount(goal.actualAmount, goal.currency)}</strong></span><span><small>Monthly target</small><strong>{goal.targetAmount ? formatAmount(goal.targetAmount, goal.currency) : 'Not set'}</strong></span></div>
      <div className={styles.goalProgress}>
        <div role="progressbar" aria-label={`${goal.currency} monthly goal progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={visualProgress} aria-valuetext={goal.targetAmount ? `${formatPercent(rawProgress)} of target` : 'Target not set'}><i style={barStyle} /></div>
        <span><strong>{goal.targetAmount ? formatPercent(rawProgress) : '—'}</strong><small>Calendar pace {formatPercent(timing.calendarProgress)}</small></span>
      </div>
      <dl className={styles.goalFacts}>
        <div><dt>{state === 'achieved' ? 'Exceeded by' : 'Remaining'}</dt><dd>{goal.targetAmount ? formatAmount(state === 'achieved' ? exceeded : remaining, goal.currency) : '—'}</dd></div>
        <div><dt>Daily amount needed</dt><dd>{goal.targetAmount ? state === 'achieved' ? 'Completed' : timing.remainingDays ? formatAmount(dailyNeeded, goal.currency) : 'Month ended' : '—'}</dd></div>
        <div><dt>Days remaining</dt><dd>{timing.remainingDays}</dd></div>
      </dl>
      {canEdit && (
        <details className={styles.goalEdit}>
          <summary>{goal.targetAmount ? 'Edit target' : 'Set target'} <span aria-hidden="true">⌄</span></summary>
          <form className={styles.goalForm} key={`${goal.currency}-${goal.targetAmount ?? 'new'}`} onSubmit={onSave}>
            <input type="hidden" name="currency" value={goal.currency} />
            <label><span>Target amount</span><input name="target_amount" type="number" min="0.01" max="999999999999.99" step="0.01" defaultValue={goal.targetAmount ?? ''} required /></label>
            <button type="submit" disabled={savingAny}>{saving ? 'Saving…' : 'Save target'}</button>
          </form>
        </details>
      )}
    </article>
  );
}

function monthTiming(periodMonth: string, generatedAt: string) {
  const [year, month] = periodMonth.slice(0, 7).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const generated = new Date(generatedAt);
  const generatedMonth = generated.getUTCFullYear() * 12 + generated.getUTCMonth();
  const targetMonth = year * 12 + month - 1;
  const elapsedDays = generatedMonth < targetMonth ? 0 : generatedMonth > targetMonth ? daysInMonth : Math.max(0, Math.min(daysInMonth, generated.getUTCDate() - 1));
  const remainingDays = generatedMonth < targetMonth ? daysInMonth : generatedMonth > targetMonth ? 0 : Math.max(0, daysInMonth - elapsedDays);
  return {
    daysInMonth,
    elapsedDays,
    remainingDays,
    calendarProgress: daysInMonth ? elapsedDays / daysInMonth * 100 : 0,
  };
}

function RevenueHeader({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return <header className={styles.header}><div><p>Revenue operations</p><h2 id="revenue-intelligence-title">Revenue intelligence</h2><span>Recurring value, renewal timing, goals, and payment exceptions from current Orion records.</span></div><button type="button" onClick={onRefresh} disabled={refreshing}><span aria-hidden="true">↻</span>{refreshing ? 'Refreshing…' : 'Refresh data'}</button></header>;
}

function PanelHeading({ kicker, title, id, badge }: { kicker: string; title: string; id: string; badge: string }) {
  return <header className={styles.panelHeading}><div><p>{kicker}</p><h3 id={id}>{title}</h3></div><span>{badge}</span></header>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className={styles.emptyState} role="status"><span aria-hidden="true">◇</span><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function RevenueLoading() {
  return <section className={`${styles.shell} ${styles.loadingShell}`} aria-labelledby="revenue-intelligence-loading-title" aria-busy="true"><header className={styles.header}><div><p>Revenue operations</p><h2 id="revenue-intelligence-loading-title">Revenue intelligence</h2><span role="status">Loading current financial records…</span></div></header><div className={styles.loadingGrid} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index}><i /><i /><i /></span>)}</div></section>;
}

function barHeight(value: number, maximum: number): BarStyle {
  return { '--trend-height': `${Math.max(value ? 8 : 0, value / maximum * 100)}%` };
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
