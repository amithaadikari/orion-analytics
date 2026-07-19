'use client';

import { useEffect, useMemo, useState } from 'react';
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

const completedStatuses = new Set(['Paid', 'Manually verified']);
const exceptionStatuses = new Set(['Refunded', 'Disputed']);
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
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0] || '';

  useEffect(() => {
    if (currency && currency !== selectedCurrency) setSelectedCurrency(currency);
  }, [currency, selectedCurrency]);

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
  const completed = currencyPayments.filter((payment) => completedStatuses.has(payment.status));
  const exceptions = currencyPayments.filter((payment) => exceptionStatuses.has(payment.status));
  const totalRevenue = sumAmounts(completed);
  const thirtyDayRevenue = sumAmounts(withinDays(completed, 30));
  const previousThirtyDayRevenue = sumAmounts(inPreviousWindow(completed, 30));
  const change = percentageChange(thirtyDayRevenue, previousThirtyDayRevenue);
  const averageSale = completed.length ? totalRevenue / completed.length : 0;
  const exceptionValue = sumAmounts(withinDays(exceptions, 30));
  const comparison = buildComparisonSeries(completed, 30);
  const averageSeries = buildDailySeries(completed, 14, 'average');
  const exceptionSeries = buildDailySeries(exceptions, 14, 'total');
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
  const periodAverage = comparison.length ? thirtyDayRevenue / comparison.length : 0;

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

      <div className={styles.signalGrid}>
        <SignalCard
          title="Revenue momentum"
          eyebrow="Completed · 30 days"
          value={formatMoney(thirtyDayRevenue, currency)}
          change={formatChange(change)}
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
          eyebrow="Exceptions · 30 days"
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
              <h3>Last 30 days</h3>
            </div>
            <div className={styles.periodSummary}>
              <strong>{formatMoney(thirtyDayRevenue, currency)}</strong>
              <span className={change !== null && change < 0 ? styles.negative : styles.positive}>{formatChange(change)} vs prior 30 days</span>
            </div>
          </div>
          <div
            className={styles.mainChart}
            role="img"
            tabIndex={0}
            aria-label={`Daily ${currency} completed revenue for the last 30 days compared with the previous 30 days.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={comparison} margin={{ top: 18, right: 8, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#a78bfa" stopOpacity={0.36} />
                    <stop offset="62%" stopColor="#7c63ff" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="#7c63ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,.055)" vertical={false} strokeDasharray="4 8" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: '#656b7c', fontSize: 9 }} />
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
                  formatter={(value, name) => [formatMoney(Number(value), currency), name === 'value' ? 'Current period' : 'Prior period']}
                />
                <ReferenceLine y={periodAverage} stroke="rgba(255,255,255,.18)" strokeDasharray="4 7" />
                <Line type="monotone" dataKey="previous" stroke="rgba(255,255,255,.16)" strokeWidth={1.4} dot={false} activeDot={false} />
                <Area type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={3} fill="url(#salesRevenueFill)" dot={false} activeDot={{ r: 5, fill: '#080811', stroke: '#d8ceff', strokeWidth: 2 }} />
                {periodHigh && <ReferenceDot x={periodHigh.label} y={periodHigh.value} r={4.5} fill="#090911" stroke="#d8ceff" strokeWidth={2} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <footer className={styles.chartFooter}>
            <span><i className={styles.currentDot} />Current 30 days</span>
            <span><i className={styles.previousDot} />Previous 30 days</span>
            <strong>{completed.length} completed payments</strong>
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
                <div><i style={{ width: percentage(value, totalRevenue), background: planColor(index) }} /></div>
                <small>{percentage(value, totalRevenue)} of completed revenue</small>
              </div>
            )) : <InlineEmpty text="No completed plan revenue." />}
          </div>
          <dl className={styles.quickFacts}>
            <div><dt>Completed revenue</dt><dd>{formatMoney(totalRevenue, currency)}</dd></div>
            <div><dt>Average payment</dt><dd>{formatMoney(averageSale, currency)}</dd></div>
            <div><dt>Prior 30 days</dt><dd>{formatMoney(previousThirtyDayRevenue, currency)}</dd></div>
          </dl>
        </article>
      </div>

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
              {sortedMethods.slice(0, 6).map(([name, value], index) => (
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
                <div><i style={{ width: percentage(value, sortedCountries[0]?.[1] || 0) }} /></div>
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
    </section>
  );
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
            <ReferenceLine y={average} stroke="rgba(255,255,255,.18)" strokeDasharray="4 5" />
            <Tooltip contentStyle={chartTooltip} labelStyle={{ color: '#858b9b' }} formatter={(pointValue) => formatter(Number(pointValue))} />
            <Line type="monotone" dataKey="value" stroke={`url(#${gradientId})`} strokeWidth={2.7} dot={false} activeDot={{ r: 4.5, fill: '#080811', stroke: color, strokeWidth: 2 }} />
            {high && high.value > 0 && <ReferenceDot x={high.label} y={high.value} r={3.8} fill="#080811" stroke={color} strokeWidth={2} />}
            {last && last.value > 0 && last.key !== high?.key && <ReferenceDot x={last.label} y={last.value} r={3.8} fill="#080811" stroke={color} strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function InlineEmpty({ text }: { text: string }) {
  return <p className={styles.inlineEmpty}>{text}</p>;
}

function buildComparisonSeries(rows: SalesPayment[], days: number): ComparisonPoint[] {
  const current = new Map<string, number>();
  rows.forEach((row) => {
    const key = paymentDateKey(row);
    if (key) current.set(key, (current.get(key) || 0) + Number(row.amount));
  });
  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    const key = localDateKey(offset);
    const comparisonKey = localDateKey(offset + days);
    return { key, label: shortDate(key), value: current.get(key) || 0, previous: current.get(comparisonKey) || 0 };
  });
}

function buildDailySeries(rows: SalesPayment[], days: number, mode: 'total' | 'average'): SeriesPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const key = localDateKey(days - index - 1);
    const dayRows = rows.filter((row) => paymentDateKey(row) === key);
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

function withinDays(rows: SalesPayment[], days: number) {
  const cutoff = startOfLocalDay(Date.now() - (days - 1) * 86400000);
  return rows.filter((row) => paymentTimestamp(row) >= cutoff);
}

function inPreviousWindow(rows: SalesPayment[], days: number) {
  const currentStart = startOfLocalDay(Date.now() - (days - 1) * 86400000);
  const previousStart = startOfLocalDay(Date.now() - (days * 2 - 1) * 86400000);
  return rows.filter((row) => {
    const timestamp = paymentTimestamp(row);
    return timestamp >= previousStart && timestamp < currentStart;
  });
}

function paymentTimestamp(payment: SalesPayment) {
  const value = payment.payment_date ? `${payment.payment_date}T12:00:00` : payment.created_at;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function paymentDateKey(payment: SalesPayment) {
  if (payment.payment_date && /^\d{4}-\d{2}-\d{2}$/.test(payment.payment_date)) return payment.payment_date;
  const date = new Date(payment.created_at);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateKey(offset: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortDate(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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
  return total > 0 ? `${Math.max(2, Math.round((value / total) * 100))}%` : '0%';
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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
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
