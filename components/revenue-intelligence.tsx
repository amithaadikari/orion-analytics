'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { buildRenewalCalendar, type RevenueIntelligenceSnapshot } from '@/lib/revenue-intelligence';
import styles from './revenue-intelligence.module.css';

type RevenueIntelligenceResponse = RevenueIntelligenceSnapshot & {
  canEditGoals: boolean;
};

type RingStyle = CSSProperties & { '--goal-progress': string };
type BarStyle = CSSProperties & { '--trend-height': string };

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RevenueIntelligence() {
  const [data, setData] = useState<RevenueIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingCurrency, setSavingCurrency] = useState('');
  const [goalStatus, setGoalStatus] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/revenue-intelligence', { cache: 'no-store', credentials: 'same-origin', signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Unable to load revenue intelligence.');
      setData(payload as RevenueIntelligenceResponse);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to load revenue intelligence.');
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
    setGoalStatus('');
    try {
      const response = await fetch('/api/revenue-intelligence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ period_month: data.periodMonth, currency, target_amount: targetAmount }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Unable to save the revenue goal.');
      await load();
      setGoalStatus(`${currency} target saved for ${data.monthLabel}.`);
      if (isNewGoal) form.reset();
    } catch (reason) {
      setGoalStatus(reason instanceof Error ? reason.message : 'Unable to save the revenue goal.');
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

        <section className={`${styles.panel} ${styles.goalsPanel}`} aria-labelledby="revenue-goals-title">
          <PanelHeading kicker="Monthly targets" title={`${data.monthLabel} goals`} id="revenue-goals-title" badge={data.canEditGoals ? 'Admin editable' : 'Read only'} />
          {data.goals.length ? <div className={styles.goalGrid}>{data.goals.map((goal) => {
            const visualProgress = Math.max(0, Math.min(100, goal.progressPercent || 0));
            const ringStyle: RingStyle = { '--goal-progress': `${visualProgress}%` };
            return (
              <article className={styles.goalCard} key={goal.currency}>
                <div className={styles.goalRing} style={ringStyle} role="img" aria-label={goal.targetAmount ? `${goal.currency} goal is ${formatPercent(goal.progressPercent || 0)} complete` : `${goal.currency} has no revenue target`}><span>{goal.progressPercent === null ? '—' : formatPercent(goal.progressPercent)}</span><small>{goal.currency}</small></div>
                <div className={styles.goalCopy}><span>Completed revenue</span><strong>{formatAmount(goal.actualAmount, goal.currency)}</strong><small>{goal.targetAmount ? `Target ${formatAmount(goal.targetAmount, goal.currency)}` : 'No target set'}</small></div>
                {data.canEditGoals && <form className={styles.goalForm} onSubmit={saveGoal}><input type="hidden" name="currency" value={goal.currency} /><label><span>{goal.targetAmount ? 'Update target' : 'Set target'}</span><input name="target_amount" type="number" min="0.01" max="1000000000000" step="0.01" defaultValue={goal.targetAmount ?? ''} required /></label><button type="submit" disabled={Boolean(savingCurrency)}>{savingCurrency === goal.currency ? 'Saving…' : 'Save'}</button></form>}
              </article>
            );
          })}</div> : <EmptyState title="No currency goals yet" detail="Monthly goal cards appear when completed revenue or a saved target exists for a currency." />}
          {data.canEditGoals && <form className={styles.addGoalForm} data-new-goal="true" onSubmit={saveGoal}><div><strong>Add a currency target</strong><span>Targets remain separate by currency.</span></div><label><span>Currency</span><input name="currency" inputMode="text" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" placeholder="USD" required /></label><label><span>Target amount</span><input name="target_amount" type="number" min="0.01" max="1000000000000" step="0.01" placeholder="5000" required /></label><button type="submit" disabled={Boolean(savingCurrency)}>{savingCurrency ? 'Saving…' : 'Add target'}</button></form>}
          {goalStatus && <p className={styles.goalStatus} role="status" aria-live="polite">{goalStatus}</p>}
        </section>
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

function formatAmount(amount: number, currency: string) {
  const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${number}`;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
