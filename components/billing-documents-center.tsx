'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  CreditCard,
  FileText,
  Headphones,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { activeLicensesForPlan, effectiveLicenseStatus, normalizeActivationValue } from '@/lib/portal-activation';
import styles from './billing-documents-center.module.css';

export type BillingPayment = {
  id: string;
  plan: string;
  method: string;
  status: string;
  amount: number | string;
  currency: string;
  payment_date?: string | null;
  reference_id?: string | null;
  receipt_number?: string | null;
  created_at: string;
};

export type BillingLicense = {
  id: string;
  plan: string;
  platform: string;
  status: string;
  issued_at: string;
  expires_at?: string | null;
};

type BillingDocumentsCenterProps = {
  client: { plan: string; status: string };
  payments: BillingPayment[];
  licenses: BillingLicense[];
  paymentsAvailable: boolean;
  licensesAvailable: boolean;
  asOf: string;
};

type PaymentFilter = 'all' | 'completed' | 'pending' | 'attention';
type Tone = 'ready' | 'pending' | 'attention' | 'neutral';

const filters: { id: PaymentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'pending', label: 'Pending' },
  { id: 'attention', label: 'Needs attention' },
];

export default function BillingDocumentsCenter({ client, payments, licenses, paymentsAvailable, licensesAvailable, asOf }: BillingDocumentsCenterProps) {
  const [filter, setFilter] = useState<PaymentFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const asOfTime = Number.isFinite(Date.parse(asOf)) ? Date.parse(asOf) : 0;
  const sortedPayments = useMemo(
    () => paymentsAvailable ? [...payments].sort((left, right) => recordedTime(right) - recordedTime(left) || right.id.localeCompare(left.id)) : [],
    [payments, paymentsAvailable],
  );
  const latestPayment = sortedPayments[0];
  const filteredPayments = sortedPayments.filter((payment) => matchesFilter(payment.status, filter));
  const visiblePayments = expanded ? filteredPayments : filteredPayments.slice(0, 5);
  const hiddenCount = filteredPayments.length - visiblePayments.length;
  const completedCount = sortedPayments.filter((payment) => paymentTone(payment.status) === 'ready').length;
  const receiptCount = sortedPayments.filter(canOpenReceipt).length;
  const renewal = resolveRenewal(client, licensesAvailable ? licenses : [], licensesAvailable, asOfTime);

  function selectFilter(nextFilter: PaymentFilter) {
    setFilter(nextFilter);
    setExpanded(false);
  }

  return (
    <section className={styles.center} id="payments" aria-labelledby="billing-center-title">
      <header className={styles.heading}>
        <div className={styles.headingCopy}>
          <p className="eyebrow">Billing & documents</p>
          <h2 id="billing-center-title">Your payment center</h2>
          <span>See your current access period, payment status, invoices, and receipts issued for completed payments without searching through long tables.</span>
        </div>
        <div className={styles.securityBadge}><ShieldCheck size={16} aria-hidden="true" /><span><small>Private records</small><strong>Account protected</strong></span></div>
        <strong className={styles.marker} aria-hidden="true">05</strong>
      </header>

      <div className={styles.summaryGrid}>
        <article className={styles.planCard} data-tone={renewal.tone}>
          <div className={styles.cardGlow} aria-hidden="true"><i /><i /><i /></div>
          <header className={styles.cardHeader}>
            <span className={styles.cardIcon} aria-hidden="true"><CalendarClock size={20} /></span>
            <div><small>Current access</small><h3>{client.plan} plan</h3></div>
            <StatusPill label={client.status} tone={accountTone(client.status)} />
          </header>
          <div className={styles.renewalState}>
            <small>{renewal.eyebrow}</small>
            <strong>{renewal.title}</strong>
            <p>{renewal.detail}</p>
          </div>
          <div className={styles.planFooter}>
            <span><RenewalIcon tone={renewal.tone} />{renewal.note}</span>
            {renewal.showSupport && <a href="#support">Renewal help <span aria-hidden="true">→</span></a>}
          </div>
        </article>

        <article className={styles.latestCard} data-tone={latestPayment ? paymentTone(latestPayment.status) : 'neutral'}>
          <header className={styles.cardHeader}>
            <span className={styles.cardIcon} aria-hidden="true"><CreditCard size={20} /></span>
            <div><small>Latest payment</small><h3>{paymentsAvailable ? latestPayment ? `${latestPayment.plan} plan` : 'No payment yet' : 'Records unavailable'}</h3></div>
            {latestPayment && <StatusPill label={latestPayment.status} tone={paymentTone(latestPayment.status)} />}
          </header>
          {!paymentsAvailable ? (
            <UnavailableState title="Payment status temporarily unavailable" text="Refresh the portal in a moment. We will not guess while your secure records cannot be confirmed." />
          ) : latestPayment ? (
            <>
              <div className={styles.paymentAmount}><strong>{formatMoney(latestPayment.amount, latestPayment.currency)}</strong><span>{latestPayment.method} · {latestPayment.payment_date ? 'Payment' : 'Recorded'} {formatShortDate(paymentDate(latestPayment))}</span></div>
              <p className={styles.paymentMessage}>{paymentMessage(latestPayment.status)}</p>
              <DocumentLinks payment={latestPayment} featured />
            </>
          ) : (
            <div className={styles.noPayment}><ReceiptText size={22} aria-hidden="true" /><div><strong>No billing records yet</strong><p>Your invoice and receipt links will appear here after a payment is recorded.</p></div><a href="#support">Billing help <span aria-hidden="true">→</span></a></div>
          )}
        </article>

        <aside className={styles.recordSummary} aria-label="Billing record summary">
          <div><span data-tone="blue"><FileText size={16} aria-hidden="true" /></span><p><small>Payment records</small><strong>{paymentsAvailable ? sortedPayments.length : '—'}</strong></p></div>
          <div><span data-tone="green"><CheckCircle2 size={16} aria-hidden="true" /></span><p><small>Completed</small><strong>{paymentsAvailable ? completedCount : '—'}</strong></p></div>
          <div><span data-tone="gold"><ReceiptText size={16} aria-hidden="true" /></span><p><small>Receipts ready</small><strong>{paymentsAvailable ? receiptCount : '—'}</strong></p></div>
          <p><ShieldCheck size={13} aria-hidden="true" />Invoices show every recorded transaction. Receipts only confirm completed payments.</p>
        </aside>
      </div>

      <section className={styles.history} aria-labelledby="transaction-history-title">
        <header className={styles.historyHeader}>
          <div><p className="eyebrow">Transaction history</p><h3 id="transaction-history-title">Payments and documents</h3></div>
          {paymentsAvailable && sortedPayments.length > 0 && (
            <div className={styles.filters} role="group" aria-label="Filter payment history">
              {filters.map((option) => <button type="button" key={option.id} onClick={() => selectFilter(option.id)} aria-pressed={filter === option.id}>{option.label}<span>{filterCount(sortedPayments, option.id)}</span></button>)}
            </div>
          )}
        </header>

        {!paymentsAvailable ? (
          <UnavailableState title="Transaction history unavailable" text="Your records could not be loaded safely. Refresh the portal or contact secure support if this continues." />
        ) : sortedPayments.length === 0 ? (
          <div className={styles.emptyState} role="status"><ReceiptText size={21} aria-hidden="true" /><div><strong>No transactions recorded</strong><p>Future invoices, payment states, and receipts will appear in this secure history.</p></div></div>
        ) : filteredPayments.length === 0 ? (
          <div className={styles.emptyState} role="status"><FileText size={20} aria-hidden="true" /><div><strong>No {filters.find((option) => option.id === filter)?.label.toLowerCase()} payments</strong><p>Choose another filter to see the rest of your billing history.</p></div></div>
        ) : (
          <>
            <div className={styles.table} role="table" aria-label="Payment and document history">
              <div className={styles.tableHead} role="row"><span role="columnheader">Date</span><span role="columnheader">Purchase</span><span role="columnheader">Amount</span><span role="columnheader">Status</span><span role="columnheader">Documents</span></div>
              <div role="rowgroup" id="billing-payment-records">
                {visiblePayments.map((payment) => <PaymentRow payment={payment} key={payment.id} />)}
              </div>
            </div>
            {hiddenCount > 0 && <button className={styles.showMore} type="button" onClick={() => setExpanded(true)} aria-expanded={false} aria-controls="billing-payment-records">Show {hiddenCount} older record{hiddenCount === 1 ? '' : 's'} <ChevronDown size={14} aria-hidden="true" /></button>}
            {expanded && filteredPayments.length > 5 && <button className={styles.showMore} type="button" onClick={() => setExpanded(false)} aria-expanded aria-controls="billing-payment-records">Show recent records</button>}
          </>
        )}
        <footer className={styles.historyFooter}><span><ShieldCheck size={14} aria-hidden="true" />Documents open inside your secure Orion account.</span><a href="#support"><Headphones size={14} aria-hidden="true" />Ask billing support</a></footer>
      </section>
    </section>
  );
}

function PaymentRow({ payment }: { payment: BillingPayment }) {
  const tone = paymentTone(payment.status);
  const date = paymentDate(payment);
  return (
    <div className={styles.tableRow} role="row" data-tone={tone}>
      <time role="cell" dateTime={date} data-label="Date"><span>{formatDay(date)}</span><small>{payment.payment_date ? formatMonthYear(date) : `Recorded ${formatMonthYear(date)}`}</small></time>
      <div className={styles.purchaseCell} role="cell" data-label="Purchase"><strong>{payment.plan} plan</strong><small>{payment.method}{payment.reference_id ? ` · Ref ${shortReference(payment.reference_id)}` : ''}</small></div>
      <strong className={styles.amountCell} role="cell" data-label="Amount">{formatMoney(payment.amount, payment.currency)}</strong>
      <span role="cell" data-label="Status"><StatusPill label={payment.status} tone={tone} /></span>
      <span role="cell" data-label="Documents"><DocumentLinks payment={payment} /></span>
    </div>
  );
}

function DocumentLinks({ payment, featured = false }: { payment: BillingPayment; featured?: boolean }) {
  const tone = paymentTone(payment.status);
  const receiptNote = tone === 'ready' && !payment.receipt_number?.trim()
    ? 'Receipt being prepared'
    : tone === 'pending'
      ? 'Receipt after confirmation'
      : null;
  return <div className={`${styles.documentLinks} ${featured ? styles.documentLinksFeatured : ''}`}><Link href={`/invoice/${payment.id}`} aria-label={`Open invoice for ${payment.plan} payment`}><FileText size={14} aria-hidden="true" />Invoice</Link>{canOpenReceipt(payment) && <Link href={`/receipt/${payment.id}`} aria-label={`Open receipt for ${payment.plan} payment`}><ReceiptText size={14} aria-hidden="true" />Receipt</Link>}{receiptNote && <small className={styles.documentNote}>{receiptNote}</small>}{tone === 'attention' && featured && <a href="#support"><Headphones size={14} aria-hidden="true" />Get help</a>}</div>;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={styles.statusPill} data-tone={tone}><i aria-hidden="true" />{label}</span>;
}

function RenewalIcon({ tone }: { tone: Tone }) {
  if (tone === 'ready') return <CheckCircle2 size={15} aria-hidden="true" />;
  if (tone === 'attention') return <CircleAlert size={15} aria-hidden="true" />;
  if (tone === 'pending') return <Clock3 size={15} aria-hidden="true" />;
  return <RefreshCw size={15} aria-hidden="true" />;
}

function UnavailableState({ title, text }: { title: string; text: string }) {
  return <div className={styles.unavailable} role="status"><RefreshCw size={20} aria-hidden="true" /><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function resolveRenewal(client: { plan: string; status: string }, licenses: BillingLicense[], recordsAvailable: boolean, asOf: number) {
  if (!recordsAvailable) return { eyebrow: 'License renewal', title: 'Status unavailable', detail: 'Your license dates could not be confirmed safely.', note: 'Refresh to check again', tone: 'neutral' as const, showSupport: false };
  const account = normalizeActivationValue(client.status);
  if (['suspended', 'disabled', 'inactive'].includes(account)) return { eyebrow: 'Account status', title: 'Access paused', detail: 'Your account needs attention before license access can continue.', note: 'Secure support is available', tone: 'attention' as const, showSupport: true };
  if (account === 'expired') return { eyebrow: 'Account status', title: 'Renewal required', detail: 'Your Orion account is marked expired.', note: 'Renew to restore access', tone: 'attention' as const, showSupport: true };
  if (account !== 'active') return { eyebrow: 'Account approval', title: 'Access pending', detail: 'Your access period will appear after Orion approves the account.', note: 'Approval is being reviewed', tone: 'pending' as const, showSupport: false };
  if (normalizeActivationValue(client.plan) === 'free') return { eyebrow: 'Current access', title: 'Free account', detail: 'Choose a paid edition when you are ready to activate Orion software.', note: 'No renewal date', tone: 'pending' as const, showSupport: false };

  const currentPlanLicenses = licenses.filter((license) => normalizeActivationValue(license.plan) === normalizeActivationValue(client.plan));
  const activeLicenses = activeLicensesForPlan(client.plan, currentPlanLicenses, asOf).sort((left, right) => expiryTime(left.expires_at) - expiryTime(right.expires_at));
  const license = activeLicenses[0] || currentPlanLicenses.sort((left, right) => statusPriority(effectiveLicenseStatus(left, asOf)) - statusPriority(effectiveLicenseStatus(right, asOf)))[0];
  if (!license) return { eyebrow: 'License renewal', title: 'License pending', detail: 'No license is assigned to your current plan yet.', note: 'Orion is preparing your access', tone: 'pending' as const, showSupport: false };

  const status = effectiveLicenseStatus(license, asOf);
  if (['suspended', 'revoked', 'disabled'].includes(status)) return { eyebrow: 'License status', title: 'License paused', detail: `Your ${license.platform} license is currently ${status}.`, note: 'Contact secure support', tone: 'attention' as const, showSupport: true };
  if (status === 'expired') return { eyebrow: 'License renewal', title: 'Renewal required', detail: license.expires_at ? `Access expired ${formatLongDate(license.expires_at)}.` : 'Your license is marked expired.', note: 'Renew to restore software access', tone: 'attention' as const, showSupport: true };
  if (status !== 'active') return { eyebrow: 'License status', title: 'Activation pending', detail: `Your ${license.platform} license is not active yet.`, note: 'Access is being prepared', tone: 'pending' as const, showSupport: false };
  if (!license.expires_at && normalizeActivationValue(license.plan) === 'lifetime') return { eyebrow: 'License duration', title: 'Lifetime access', detail: `${license.platform} access has no recorded expiry date.`, note: 'No renewal required', tone: 'ready' as const, showSupport: false };
  if (!license.expires_at) return { eyebrow: 'License renewal', title: 'Expiry date not set', detail: `Your ${license.platform} license is active, but no expiry date is recorded.`, note: 'Ask support to confirm the term', tone: 'pending' as const, showSupport: true };

  const days = daysUntil(license.expires_at, asOf);
  if (days <= 0) return { eyebrow: 'License renewal', title: days === 0 ? 'Expires today' : 'Renewal required', detail: `Access expires ${formatLongDate(license.expires_at)}.`, note: 'Renew to keep software access', tone: 'attention' as const, showSupport: true };
  return { eyebrow: 'License renewal', title: `${days} day${days === 1 ? '' : 's'} remaining`, detail: `Access expires ${formatLongDate(license.expires_at)}.`, note: days <= 30 ? 'Renewal window is open' : 'License access is active', tone: days <= 30 ? 'attention' as const : 'ready' as const, showSupport: days <= 30 };
}

function paymentTone(status: string): Tone {
  const normalized = normalizeActivationValue(status);
  if (['paid', 'manually verified'].includes(normalized)) return 'ready';
  if (normalized === 'pending') return 'pending';
  if (['failed', 'refunded', 'disputed'].includes(normalized)) return 'attention';
  return 'neutral';
}

function accountTone(status: string): Tone {
  const normalized = normalizeActivationValue(status);
  if (normalized === 'active') return 'ready';
  if (['expired', 'suspended', 'disabled', 'inactive'].includes(normalized)) return 'attention';
  if (normalized === 'pending') return 'pending';
  return 'neutral';
}

function matchesFilter(status: string, filter: PaymentFilter) {
  if (filter === 'all') return true;
  const tone = paymentTone(status);
  if (filter === 'completed') return tone === 'ready';
  if (filter === 'pending') return tone === 'pending';
  return tone === 'attention';
}

function filterCount(payments: BillingPayment[], filter: PaymentFilter) {
  return payments.filter((payment) => matchesFilter(payment.status, filter)).length;
}

function canOpenReceipt(payment: BillingPayment) {
  return paymentTone(payment.status) === 'ready' && Boolean(payment.receipt_number?.trim());
}

function paymentMessage(status: string) {
  const normalized = normalizeActivationValue(status);
  if (normalized === 'paid') return 'Payment verified and recorded in your Orion account.';
  if (normalized === 'manually verified') return 'Payment was manually verified by Orion and recorded as completed.';
  if (normalized === 'pending') return 'Payment is recorded and awaiting Orion verification.';
  if (normalized === 'failed') return 'This payment attempt failed and did not confirm access.';
  if (normalized === 'refunded') return 'This payment was refunded and remains in your history for reference.';
  if (normalized === 'disputed') return 'This payment is under review. Use secure support for an update.';
  return `${status} is the latest status recorded for this payment.`;
}

function paymentDate(payment: BillingPayment) {
  return payment.payment_date || payment.created_at;
}

function recordedTime(payment: BillingPayment) {
  const parsed = Date.parse(payment.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysUntil(value: string, asOf: number) {
  const date = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  const reference = new Date(asOf);
  const today = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return Math.round((date - today) / 86400000);
}

function expiryTime(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function statusPriority(status: string) {
  if (status === 'expired') return 0;
  if (['suspended', 'revoked', 'disabled'].includes(status)) return 1;
  return 2;
}

function parseDisplayDate(value: string) {
  const normalized = value.includes('T') ? value : `${value}T00:00:00Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(value: string) {
  const date = parseDisplayDate(value);
  return date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date unavailable';
}

function formatLongDate(value: string) {
  const date = parseDisplayDate(value);
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'on an unavailable date';
}

function formatDay(value: string) {
  const date = parseDisplayDate(value);
  return date ? date.toLocaleDateString('en-GB', { day: '2-digit', timeZone: 'UTC' }) : '—';
}

function formatMonthYear(value: string) {
  const date = parseDisplayDate(value);
  return date ? date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date unavailable';
}

function formatMoney(value: number | string, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Amount unavailable';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
}

function shortReference(reference: string) {
  return reference.length > 14 ? `${reference.slice(0, 6)}…${reference.slice(-4)}` : reference;
}
