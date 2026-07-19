'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Area,
  AreaChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { countryLabel } from '@/lib/country';
import styles from './sales-command-center.module.css';

type SalesClient = {
  id: string;
  full_name: string;
  country?: string;
};

type SalesLicense = {
  id: string;
  license_key: string;
};

type SalesPayment = {
  id: string;
  client_id: string;
  license_id?: string;
  plan: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  payment_date?: string;
  reference_id?: string;
  created_at: string;
  updated_at?: string | null;
};

type SalesCommandCenterProps = {
  clients: SalesClient[];
  licenses: SalesLicense[];
  payments: SalesPayment[];
  search: string;
};

type SeriesPoint = {
  key: string;
  label: string;
  value: number;
};

type ComparisonPoint = SeriesPoint & {
  previous: number;
};

type RangePreset = '7d' | '30d' | '90d' | '12m' | 'custom';

type PeriodSpec = {
  startKey: string;
  endKey: string;
  previousStartKey: string;
  previousEndKey: string;
  days: number;
  label: string;
  previousLabel: string;
};

type TransactionView = {
  title: string;
  subtitle: string;
  payments: SalesPayment[];
};

type CountItem = {
  name: string;
  count: number;
};

const completedStatuses = new Set(['Paid', 'Manually verified']);
const exceptionStatuses = new Set(['Refunded', 'Disputed']);
const rangeOptions: { value: RangePreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '12m', label: '12M' },
  { value: 'custom', label: 'Custom' },
];
const chartTooltip = {
  background: 'rgba(4, 5, 10, .96)',
  border: '1px solid rgba(255, 255, 255, .12)',
  borderRadius: 12,
  boxShadow: '0 18px 50px rgba(0, 0, 0, .35)',
  fontSize: 11,
};

export default function SalesCommandCenter({ clients, licenses, payments, search }: SalesCommandCenterProps) {
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const licenseById = useMemo(() => new Map(licenses.map((license) => [license.id, license])), [licenses]);
  const visiblePayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return payments;
    return payments.filter((payment) => {
      const client = clientById.get(payment.client_id);
      const license = payment.license_id ? licenseById.get(payment.license_id) : undefined;
      return `${client?.full_name || ''} ${client?.country || ''} ${license?.license_key || ''} ${payment.reference_id || ''} ${payment.method} ${payment.plan} ${payment.status} ${payment.currency} ${payment.amount}`
        .toLowerCase()
        .includes(query);
    });
  }, [clientById, licenseById, payments, search]);

  const currencies = useMemo(
    () => [...new Set(visiblePayments.map((payment) => normalizeCurrency(payment.currency)))].sort(),
    [visiblePayments],
  );
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [range, setRange] = useState<RangePreset>('30d');
  const [customStart, setCustomStart] = useState(() => utcDateKey(29));
  const [customEnd, setCustomEnd] = useState(() => utcDateKey(0));
  const [showComparison, setShowComparison] = useState(true);
  const [transactionView, setTransactionView] = useState<TransactionView | null>(null);
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0] || '';
  const period = useMemo(() => resolvePeriod(range, customStart, customEnd), [customEnd, customStart, range]);

  useEffect(() => {
    if (currency && currency !== selectedCurrency) setSelectedCurrency(currency);
  }, [currency, selectedCurrency]);

  useEffect(() => {
    setTransactionView(null);
  }, [currency, customEnd, customStart, range, search]);

  if (!currency) {
    return (
      <section className={styles.empty} aria-labelledby="sales-command-title">
        <span aria-hidden="true">↗</span>
        <div>
          <p>Sales command center</p>
          <h2 id="sales-command-title">No matching sales yet</h2>
          <small>Completed revenue charts will appear when a payment matches the current search and filter.</small>
        </div>
      </section>
    );
  }

  const currencyPayments = visiblePayments.filter((payment) => normalizeCurrency(payment.currency) === currency);
  const completedAll = currencyPayments.filter((payment) => completedStatuses.has(payment.status));
  const exceptionsAll = currencyPayments.filter((payment) => exceptionStatuses.has(payment.status));
  const completed = filterPeriod(completedAll, period.startKey, period.endKey);
  const previousCompleted = filterPeriod(completedAll, period.previousStartKey, period.previousEndKey);
  const exceptions = filterPeriod(exceptionsAll, period.startKey, period.endKey, exceptionDateKey);
  const totalRevenue = sumAmounts(completed);
  const previousRevenue = sumAmounts(previousCompleted);
  const change = percentageChange(totalRevenue, previousRevenue);
  const averageSale = completed.length ? totalRevenue / completed.length : 0;
  const exceptionValue = sumAmounts(exceptions);
  const comparison = buildComparisonSeries(completedAll, period);
  const averageSeries = buildPeriodDailySeries(completed, period, 'average').slice(-14);
  const exceptionSeries = buildPeriodDailySeries(exceptions, period, 'total', exceptionDateKey).slice(-14);
  const planBreakdown = groupAmounts(completed, (payment) => payment.plan || 'Unassigned');
  const methodBreakdown = groupAmounts(completed, (payment) => payment.method || 'Unknown');
  const countryBreakdown = groupAmounts(completed, (payment) => clientById.get(payment.client_id)?.country || 'Unknown');
  const sortedPlans = [...planBreakdown].sort((left, right) => right[1] - left[1]);
  const sortedMethods = [...methodBreakdown].sort((left, right) => right[1] - left[1]);
  const sortedCountries = [...countryBreakdown].sort((left, right) => right[1] - left[1]).slice(0, 6);
  const recent = [...completed]
    .sort((left, right) => paymentTimestamp(right) - paymentTimestamp(left))
    .slice(0, 8);
  const dailyCurrent = comparison.map((point) => ({ ...point, value: point.value }));
  const periodHigh = maxPoint(dailyCurrent);
  const periodAverage = comparison.length ? totalRevenue / comparison.length : 0;
  const countByPlan = sortCounts(groupCounts(completed, (payment) => payment.plan || 'Unassigned'));
  const countByMethod = sortCounts(groupCounts(completed, (payment) => payment.method || 'Unknown'));
  const countByCountry = sortCounts(groupCounts(completed, (payment) => clientById.get(payment.client_id)?.country || 'Unknown'));
  const previousSalesChange = percentageChange(completed.length, previousCompleted.length);

  function openTransactions(title: string, subtitle: string, rows: SalesPayment[]) {
    setTransactionView({ title, subtitle, payments: [...rows].sort((left, right) => paymentTimestamp(right) - paymentTimestamp(left)) });
  }

  function openChartPoint(state: unknown) {
    const payload = chartPointPayload(state);
    if (!payload?.key) return;
    openChartDate(payload.key, payload.label);
  }

  function openChartDate(key: string, label = shortDate(key)) {
    const rows = completed.filter((payment) => paymentDateKey(payment) === key);
    openTransactions(`${label} sales`, `${rows.length} completed ${currency} ${rows.length === 1 ? 'payment' : 'payments'} on this date.`, rows);
  }

  return (
    <section className={styles.shell} aria-labelledby="sales-command-title">
      <header className={styles.header}>
        <div>
          <p>Live revenue overview</p>
          <h2 id="sales-command-title">Sales command center</h2>
          <span>Completed revenue, payment quality, and market mix without combining currencies.</span>
        </div>
        <div className={styles.currencyPicker} aria-label="Revenue currency">
          <small>Viewing currency</small>
          <div>
            {currencies.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={item === currency}
                onClick={() => setSelectedCurrency(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={styles.controlBar}>
        <div className={styles.rangeControl} aria-label="Sales reporting period">
          <small>Reporting period</small>
          <div>
            {rangeOptions.map((option) => (
              <button type="button" key={option.value} aria-pressed={range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
        {range === 'custom' && (
          <div className={styles.customDates}>
            <label><span>From</span><input type="date" min={utcDateKey(729)} max={customEnd} value={customStart} onChange={(event) => { const value = event.target.value; if (!value) return; setCustomStart(value); if (value > customEnd) setCustomEnd(value); }} /></label>
            <i aria-hidden="true">→</i>
            <label><span>To</span><input type="date" min={customStart} max={utcDateKey(0)} value={customEnd} onChange={(event) => { const value = event.target.value; if (!value) return; setCustomEnd(value); if (value < customStart) setCustomStart(value); }} /></label>
          </div>
        )}
        <button type="button" className={styles.compareToggle} aria-pressed={showComparison} onClick={() => setShowComparison((current) => !current)}>
          <span aria-hidden="true"><i /></span>
          <b>Compare previous period</b>
          <small>{showComparison ? period.previousLabel : 'Comparison hidden'}</small>
        </button>
        <div className={styles.scopeNote} role="status" aria-live="polite"><span aria-hidden="true">◎</span><p><strong>{period.label}</strong><small>{formatDate(period.startKey)} – {formatDate(period.endKey)} · {currency} · UTC</small></p></div>
      </div>

      <div className={styles.signalGrid}>
        <SignalCard
          title="Revenue momentum"
          eyebrow={`Completed · ${period.label}`}
          value={formatMoney(totalRevenue, currency)}
          change={showComparison ? formatChange(change) : `${completed.length} sales`}
          data={comparison.slice(-14).map(({ key, label, value }) => ({ key, label, value }))}
          color="#a78bfa"
          tone="violet"
          formatter={(value) => formatMoney(value, currency)}
        />
        <SignalCard
          title="Average payment"
          eyebrow="Completed order value"
          value={formatMoney(averageSale, currency)}
          change={`${completed.length} completed`}
          data={averageSeries}
          color="#68d8ff"
          tone="cyan"
          formatter={(value) => formatMoney(value, currency)}
        />
        <SignalCard
          title="Refund & dispute value"
          eyebrow={`Exceptions · ${period.label}`}
          value={exceptionValue ? `−${formatMoney(exceptionValue, currency)}` : formatMoney(0, currency)}
          change={exceptions.length ? `${exceptions.length} to review` : 'No exceptions'}
          data={exceptionSeries}
          color="#ff6575"
          tone="red"
          formatter={(value) => formatMoney(value, currency)}
        />
      </div>

      <div className={styles.primaryGrid}>
        <article className={`${styles.panel} ${styles.revenuePanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p>Revenue pulse</p>
              <h3>{period.label}</h3>
            </div>
            <div className={styles.periodSummary}>
              <strong>{formatMoney(totalRevenue, currency)}</strong>
              <span className={change !== null && change < 0 ? styles.negative : styles.positive}>{showComparison ? `${formatChange(change)} vs previous period` : `${completed.length} completed sales`}</span>
            </div>
          </div>
          <div
            className={styles.mainChart}
            role="img"
            tabIndex={0}
            aria-label={`Daily ${currency} completed revenue for ${period.label}${showComparison ? ` compared with ${period.previousLabel}` : ''}. Use the inspect date control below to open payments for a specific date.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={comparison} margin={{ top: 18, right: 8, left: 2, bottom: 0 }} onClick={openChartPoint}>
                <defs>
                  <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#a78bfa" stopOpacity={0.36} />
                    <stop offset="62%" stopColor="#7c63ff" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="#7c63ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,.055)" vertical={false} strokeDasharray="4 8" />
                <XAxis dataKey="key" tickFormatter={(value) => shortDate(String(value))} tickLine={false} axisLine={false} minTickGap={28} interval="preserveStartEnd" tick={{ fill: '#656b7c', fontSize: 9 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fill: '#656b7c', fontSize: 9 }}
                  tickFormatter={(value) => compactNumber(Number(value))}
                />
                <Tooltip
                  contentStyle={chartTooltip}
                  labelStyle={{ color: '#858b9b' }}
                  formatter={(value, name) => [formatMoney(Number(value), currency), name === 'value' ? period.label : period.previousLabel]}
                />
                <ReferenceLine y={periodAverage} stroke="rgba(255,255,255,.18)" strokeDasharray="4 7" />
                {showComparison && <Line type="monotone" dataKey="previous" stroke="rgba(255,255,255,.2)" strokeWidth={1.4} dot={false} activeDot={false} />}
                <Area type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={3} fill="url(#salesRevenueFill)" dot={false} activeDot={{ r: 5, fill: '#080811', stroke: '#d8ceff', strokeWidth: 2 }} />
                {periodHigh && <ReferenceDot x={periodHigh.key} y={periodHigh.value} r={4.5} fill="#090911" stroke="#d8ceff" strokeWidth={2} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <footer className={styles.chartFooter}>
            <span><i className={styles.currentDot} />{period.label}</span>
            {showComparison && <span><i className={styles.previousDot} />{period.previousLabel}</span>}
            <label className={styles.chartDateSelect}>
              <span>Inspect date</span>
              <select
                aria-label="Inspect completed sales for a date"
                defaultValue=""
                disabled={!comparison.some((point) => point.value > 0)}
                onChange={(event) => {
                  const key = event.currentTarget.value;
                  if (key) openChartDate(key);
                  event.currentTarget.value = '';
                }}
              >
                <option value="">{comparison.some((point) => point.value > 0) ? 'Choose date' : 'No sales dates'}</option>
                {comparison.filter((point) => point.value > 0).map((point) => <option key={point.key} value={point.key}>{formatDate(point.key)} · {formatMoney(point.value, currency)}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => openTransactions(`${period.label} sales`, `${completed.length} completed ${currency} payments in the selected period.`, completed)}>View {completed.length} transactions <b aria-hidden="true">→</b></button>
          </footer>
        </article>

        <article className={`${styles.panel} ${styles.planPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p>Product mix</p>
              <h3>Revenue by plan</h3>
            </div>
            <span className={styles.totalBadge}>{formatMoney(totalRevenue, currency)}</span>
          </div>
          <div className={styles.planList}>
            {sortedPlans.length ? sortedPlans.map(([name, value], index) => (
              <div key={name}>
                <span><i style={{ background: planColor(index) }} />{name}<strong>{formatMoney(value, currency)}</strong></span>
                <div><i style={{ width: visualPercentage(value, totalRevenue), background: planColor(index) }} /></div>
                <small>{percentage(value, totalRevenue)} of completed revenue</small>
              </div>
            )) : <InlineEmpty text="No completed plan revenue." />}
          </div>
          <dl className={styles.quickFacts}>
            <div><dt>Completed revenue</dt><dd>{formatMoney(totalRevenue, currency)}</dd></div>
            <div><dt>Average payment</dt><dd>{formatMoney(averageSale, currency)}</dd></div>
            <div><dt>{showComparison ? 'Previous period' : 'Sales in range'}</dt><dd>{showComparison ? formatMoney(previousRevenue, currency) : completed.length}</dd></div>
          </dl>
        </article>
      </div>

      <section className={styles.volumeSection} aria-labelledby="sales-volume-title">
        <header className={styles.volumeHeading}>
          <div><p>Sales volume</p><h3 id="sales-volume-title">Number of completed sales</h3><span>Counts follow the selected period, currency, search, and filters.</span></div>
          <button type="button" onClick={() => openTransactions('All completed sales', `${completed.length} completed ${currency} payments during ${period.label}.`, completed)}>Open all sales <span aria-hidden="true">↗</span></button>
        </header>
        <div className={styles.volumeGrid}>
          <article className={`${styles.volumeCard} ${styles.volumeTotal}`}>
            <div className={styles.volumeIcon} aria-hidden="true">◎</div>
            <p>Total sales</p>
            <strong>{completed.length.toLocaleString()}</strong>
            <span className={previousSalesChange !== null && previousSalesChange < 0 ? styles.negative : styles.positive}>{showComparison ? `${formatChange(previousSalesChange)} vs previous period` : period.label}</span>
            <dl><div><dt>{showComparison ? 'Previous' : 'Exceptions'}</dt><dd>{showComparison ? previousCompleted.length : exceptions.length}</dd></div><div><dt>Average value</dt><dd>{formatMoney(averageSale, currency)}</dd></div></dl>
          </article>
          <CountCard title="Sales by country" icon="⌖" items={countByCountry} empty="No country data" formatName={countryLabel} onSelect={(name) => openTransactions(`${countryLabel(name)} sales`, `${countByCountry.find((item) => item.name === name)?.count || 0} completed sales from this country.`, completed.filter((payment) => (clientById.get(payment.client_id)?.country || 'Unknown') === name))} />
          <CountCard title="Sales by plan" icon="◇" items={countByPlan} empty="No plan sales" onSelect={(name) => openTransactions(`${name} plan sales`, `${countByPlan.find((item) => item.name === name)?.count || 0} completed ${name} sales.`, completed.filter((payment) => (payment.plan || 'Unassigned') === name))} />
          <CountCard title="Sales by payment method" icon="◈" items={countByMethod} empty="No payment methods" onSelect={(name) => openTransactions(`${name} sales`, `${countByMethod.find((item) => item.name === name)?.count || 0} completed sales paid through ${name}.`, completed.filter((payment) => (payment.method || 'Unknown') === name))} />
        </div>
      </section>

      <div className={styles.breakdownGrid}>
        <article className={`${styles.panel} ${styles.methodPanel}`}>
          <div className={styles.panelHeading}>
            <div><p>Payment channels</p><h3>Revenue by method</h3></div>
            <span>{sortedMethods.length} methods</span>
          </div>
          <div className={styles.methodBody}>
            <div className={styles.donut} role="img" tabIndex={0} aria-label={`${currency} completed revenue divided by payment method.`}>
              {sortedMethods.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sortedMethods.map(([name, value]) => ({ name, value }))} dataKey="value" nameKey="name" innerRadius={48} outerRadius={74} paddingAngle={4} stroke="none">
                      {sortedMethods.map(([name], index) => <Cell key={name} fill={methodColor(index)} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip} formatter={(value) => formatMoney(Number(value), currency)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
              <span><strong>{sortedMethods.length}</strong><small>methods</small></span>
            </div>
            <div className={styles.methodLegend}>
              {sortedMethods.slice(0, 8).map(([name, value], index) => (
                <span key={name}><i style={{ background: methodColor(index) }} /><b>{name}</b><strong>{formatMoney(value, currency)}</strong></span>
              ))}
              {!sortedMethods.length && <InlineEmpty text="No payment methods available." />}
            </div>
          </div>
        </article>

        <article className={`${styles.panel} ${styles.countryPanel}`}>
          <div className={styles.panelHeading}>
            <div><p>Customer markets</p><h3>Top revenue countries</h3></div>
            <span>{countryBreakdown.size} markets</span>
          </div>
          <div className={styles.countryList}>
            {sortedCountries.map(([name, value], index) => (
              <div key={name}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>{countryLabel(name)}</span>
                <div><i style={{ width: visualPercentage(value, sortedCountries[0]?.[1] || 0) }} /></div>
                <strong>{formatMoney(value, currency)}</strong>
              </div>
            ))}
            {!sortedCountries.length && <InlineEmpty text="Add client countries to see market performance." />}
          </div>
        </article>
      </div>

      <article className={`${styles.panel} ${styles.recentPanel}`}>
        <div className={styles.panelHeading}>
          <div><p>Latest activity</p><h3>Recent completed sales</h3></div>
          <span>Showing {recent.length} of {completed.length}</span>
        </div>
        <div className={styles.salesTable} role="table" aria-label={`Recent completed ${currency} sales`}>
          <div className={styles.tableHead} role="row">
            <span role="columnheader">Client</span><span role="columnheader">Plan</span><span role="columnheader">Method</span><span role="columnheader">Date</span><span role="columnheader">Amount</span>
          </div>
          {recent.map((payment) => (
            <div className={styles.tableRow} role="row" key={payment.id}>
              <span role="cell"><i>{initials(clientById.get(payment.client_id)?.full_name || 'Client')}</i><b>{clientById.get(payment.client_id)?.full_name || 'Client'}<small>{payment.license_id ? licenseById.get(payment.license_id)?.license_key || 'No linked key' : 'No linked license'}</small></b></span>
              <span role="cell">{payment.plan || '—'}</span>
              <span role="cell">{payment.method || '—'}</span>
              <time role="cell" dateTime={payment.payment_date || payment.created_at}>{formatDate(payment.payment_date || payment.created_at)}</time>
              <strong role="cell">{formatMoney(Number(payment.amount), currency)}</strong>
            </div>
          ))}
          {!recent.length && <InlineEmpty text="No completed sales match the current view." />}
        </div>
      </article>
      {transactionView && <SalesDetailsDrawer view={transactionView} currency={currency} clientById={clientById} licenseById={licenseById} close={() => setTransactionView(null)} />}
    </section>
  );
}

function CountCard({ title, icon, items, empty, formatName = (name) => name, onSelect }: {
  title: string;
  icon: string;
  items: CountItem[];
  empty: string;
  formatName?: (name: string) => string;
  onSelect: (name: string) => void;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.count));
  return (
    <article className={styles.volumeCard}>
      <div className={styles.volumeCardHeading}><span aria-hidden="true">{icon}</span><h4>{title}</h4><small>{items.length} groups</small></div>
      <div className={styles.countList}>
        {items.map((item) => (
          <button type="button" key={item.name} onClick={() => onSelect(item.name)} style={{ '--count-width': `${Math.max(4, item.count / maximum * 100)}%` } as CSSProperties}>
            <span>{formatName(item.name)}</span><i><b /></i><strong>{item.count}</strong><small>View sales</small>
          </button>
        ))}
        {!items.length && <InlineEmpty text={empty} />}
      </div>
    </article>
  );
}

function SalesDetailsDrawer({ view, currency, clientById, licenseById, close }: {
  view: TransactionView;
  currency: string;
  clientById: Map<string, SalesClient>;
  licenseById: Map<string, SalesLicense>;
  close: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    closeButton.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); opener?.focus(); };
  }, [close]);

  return (
    <div className={styles.drawerBackdrop} onMouseDown={close}>
      <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="sales-detail-title" onKeyDown={trapDrawerFocus} onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeButton} className={styles.drawerClose} type="button" aria-label="Close sales details" onClick={close}>×</button>
        <header><p>Transaction drill-down</p><h2 id="sales-detail-title">{view.title}</h2><span>{view.subtitle}</span></header>
        <div className={styles.drawerSummary}><span><small>Transactions</small><strong>{view.payments.length}</strong></span><span><small>Completed value</small><strong>{formatMoney(sumAmounts(view.payments), currency)}</strong></span></div>
        <ul className={styles.drawerList}>
          {view.payments.map((payment) => {
            const client = clientById.get(payment.client_id);
            const license = payment.license_id ? licenseById.get(payment.license_id) : undefined;
            return <li key={payment.id}><i>{initials(client?.full_name || 'Client')}</i><div><strong>{client?.full_name || 'Client'}<small>{client?.country ? countryLabel(client.country) : '🌐 Country not set'} · {payment.plan || 'Unassigned'} · {payment.method || 'Unknown'}</small></strong><span>{license?.license_key || 'No linked license'} · {payment.reference_id || 'No payment reference'}</span></div><time dateTime={payment.payment_date || payment.created_at}>{formatDate(payment.payment_date || payment.created_at)}</time><b>{formatMoney(Number(payment.amount), currency)}</b></li>;
          })}
          {!view.payments.length && <li className={styles.drawerEmpty}><span aria-hidden="true">◇</span><p>No completed sales were recorded for this selection.</p></li>}
        </ul>
      </section>
    </div>
  );
}

function trapDrawerFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function SignalCard({ title, eyebrow, value, change, data, color, tone, formatter }: {
  title: string;
  eyebrow: string;
  value: string;
  change: string;
  data: SeriesPoint[];
  color: string;
  tone: 'violet' | 'cyan' | 'red';
  formatter: (value: number) => string;
}) {
  const high = maxPoint(data);
  const last = data[data.length - 1];
  const average = data.length ? data.reduce((total, point) => total + point.value, 0) / data.length : 0;
  const gradientId = `signal-${tone}`;
  return (
    <article className={`${styles.signalCard} ${styles[tone]}`} style={{ '--signal-color': color } as React.CSSProperties}>
      <div className={styles.signalHeading}>
        <div><p>{eyebrow}</p><h3>{title}</h3></div>
        <span aria-hidden="true">↗</span>
      </div>
      <div className={styles.signalValue}><strong>{value}</strong><small>{change}</small></div>
      <div className={styles.signalChart} role="img" tabIndex={0} aria-label={`${title} trend over the latest 14 days.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 9, left: 9, bottom: 3 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={color} stopOpacity={0.64} />
                <stop offset="100%" stopColor={color} stopOpacity={1} />
              </linearGradient>
            </defs>
            <XAxis dataKey="key" hide />
            <ReferenceLine y={average} stroke="rgba(255,255,255,.18)" strokeDasharray="4 5" />
            <Tooltip contentStyle={chartTooltip} labelStyle={{ color: '#858b9b' }} formatter={(pointValue) => formatter(Number(pointValue))} />
            <Line type="monotone" dataKey="value" stroke={`url(#${gradientId})`} strokeWidth={2.7} dot={false} activeDot={{ r: 4.5, fill: '#080811', stroke: color, strokeWidth: 2 }} />
            {high && high.value > 0 && <ReferenceDot x={high.key} y={high.value} r={3.8} fill="#080811" stroke={color} strokeWidth={2} />}
            {last && last.value > 0 && last.key !== high?.key && <ReferenceDot x={last.key} y={last.value} r={3.8} fill="#080811" stroke={color} strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function InlineEmpty({ text }: { text: string }) {
  return <p className={styles.inlineEmpty}>{text}</p>;
}

function buildComparisonSeries(rows: SalesPayment[], period: PeriodSpec): ComparisonPoint[] {
  const current = new Map<string, number>();
  rows.forEach((row) => {
    const key = paymentDateKey(row);
    if (key) current.set(key, (current.get(key) || 0) + Number(row.amount));
  });
  return Array.from({ length: period.days }, (_, index) => {
    const key = addDaysKey(period.startKey, index);
    const comparisonKey = addDaysKey(period.previousStartKey, index);
    return { key, label: shortDate(key), value: current.get(key) || 0, previous: current.get(comparisonKey) || 0 };
  });
}

function buildPeriodDailySeries(rows: SalesPayment[], period: PeriodSpec, mode: 'total' | 'average', dateKey: (payment: SalesPayment) => string = paymentDateKey): SeriesPoint[] {
  return Array.from({ length: period.days }, (_, index) => {
    const key = addDaysKey(period.startKey, index);
    const dayRows = rows.filter((row) => dateKey(row) === key);
    const total = sumAmounts(dayRows);
    return { key, label: shortDate(key), value: mode === 'average' && dayRows.length ? total / dayRows.length : total };
  });
}

function groupAmounts(rows: SalesPayment[], label: (payment: SalesPayment) => string) {
  const result = new Map<string, number>();
  rows.forEach((payment) => {
    const name = label(payment);
    result.set(name, (result.get(name) || 0) + Number(payment.amount));
  });
  return result;
}

function groupCounts(rows: SalesPayment[], label: (payment: SalesPayment) => string) {
  const result = new Map<string, number>();
  rows.forEach((payment) => {
    const name = label(payment);
    result.set(name, (result.get(name) || 0) + 1);
  });
  return result;
}

function sortCounts(counts: Map<string, number>): CountItem[] {
  return [...counts].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function filterPeriod(rows: SalesPayment[], startKey: string, endKey: string, dateKey: (payment: SalesPayment) => string = paymentDateKey) {
  return rows.filter((payment) => {
    const key = dateKey(payment);
    return key >= startKey && key <= endKey;
  });
}

function resolvePeriod(range: RangePreset, customStart: string, customEnd: string): PeriodSpec {
  const endKey = range === 'custom' ? customEnd : utcDateKey(0);
  const configuredDays = range === '7d' ? 7 : range === '90d' ? 90 : range === '12m' ? 365 : 30;
  const startKey = range === 'custom' ? customStart : range === '12m' ? firstDayMonthsAgo(11) : addDaysKey(endKey, -(configuredDays - 1));
  const safeStart = startKey <= endKey ? startKey : endKey;
  const safeEnd = startKey <= endKey ? endKey : startKey;
  const unboundedDays = Math.max(1, daysBetween(safeStart, safeEnd) + 1);
  const days = Math.min(730, unboundedDays);
  const boundedStart = unboundedDays > days ? addDaysKey(safeEnd, -(days - 1)) : safeStart;
  const previousEndKey = addDaysKey(boundedStart, -1);
  const previousStartKey = addDaysKey(previousEndKey, -(days - 1));
  const label = range === 'custom' ? 'Custom range' : range === '12m' ? 'Last 12 months' : `Last ${configuredDays} days`;
  return { startKey: boundedStart, endKey: safeEnd, previousStartKey, previousEndKey, days, label, previousLabel: `Previous ${days} days` };
}

function chartPointPayload(state: unknown): { key: string; label: string } | null {
  if (!state || typeof state !== 'object') return null;
  const chartState = state as { isTooltipActive?: unknown; activePayload?: unknown[] };
  if (chartState.isTooltipActive !== true) return null;
  const activePayload = chartState.activePayload;
  if (!Array.isArray(activePayload) || !activePayload.length) return null;
  const payload = (activePayload[0] as { payload?: unknown })?.payload;
  if (!payload || typeof payload !== 'object') return null;
  const key = (payload as { key?: unknown }).key;
  const label = (payload as { label?: unknown }).label;
  return typeof key === 'string' && typeof label === 'string' ? { key, label } : null;
}

function paymentTimestamp(payment: SalesPayment) {
  const value = payment.payment_date ? `${payment.payment_date}T00:00:00Z` : payment.created_at;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function paymentDateKey(payment: SalesPayment) {
  if (payment.payment_date && /^\d{4}-\d{2}-\d{2}$/.test(payment.payment_date)) return payment.payment_date;
  const date = new Date(payment.created_at);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function exceptionDateKey(payment: SalesPayment) {
  if (payment.updated_at) {
    const date = new Date(payment.updated_at);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return paymentDateKey(payment);
}

function utcDateKey(offset: number) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
  return date.toISOString().slice(0, 10);
}

function addDaysKey(key: string, offset: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startKey: string, endKey: string) {
  const start = new Date(`${startKey}T00:00:00Z`).getTime();
  const end = new Date(`${endKey}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function firstDayMonthsAgo(months: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
}

function shortDate(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function maxPoint<T extends SeriesPoint>(data: T[]) {
  return data.reduce<T | null>((best, point) => !best || point.value > best.value ? point : best, null);
}

function sumAmounts(rows: SalesPayment[]) {
  return rows.reduce((total, row) => total + Number(row.amount || 0), 0);
}

function percentageChange(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

function formatChange(value: number | null) {
  if (value === null) return 'New revenue';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

function percentage(value: number, total: number) {
  return total > 0 ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value / total * 100)}%` : '0%';
}

function visualPercentage(value: number, total: number) {
  return total > 0 && value > 0 ? `${Math.max(2, value / total * 100)}%` : '0%';
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase() || 'UNSPECIFIED';
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CL';
}

function planColor(index: number) {
  return ['#a78bfa', '#68d8ff', '#f6c453', '#39f28a'][index % 4];
}

function methodColor(index: number) {
  return ['#a78bfa', '#68d8ff', '#f6c453', '#39f28a', '#ff8a65', '#ff6575'][index % 6];
}
