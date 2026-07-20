import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import PrintReceiptButton from '@/components/print-receipt-button';
import { getPortalSession } from '@/lib/portal-session';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import './invoice.css';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) notFound();

  const session = await getPortalSession();
  if (!session.user) redirect(`/client-login?next=${encodeURIComponent(`/invoice/${id}`)}`);
  if (!session.admin && !session.client) notFound();

  const db = createSupabaseAdminClient();
  let query = db.from('client_payments')
    .select('id,client_id,license_id,receipt_number,plan,method,status,amount,currency,payment_date,reference_id,created_at,clients(full_name,email,country),licenses(license_key,platform,account_number)')
    .eq('id', parsedId.data);
  if (!session.admin && session.client) query = query.eq('client_id', session.client.id);
  const { data: payment, error } = await query.maybeSingle();
  if (error || !payment) notFound();

  const customer = relation(payment.clients);
  const license = relation(payment.licenses);
  const settled = ['Paid', 'Manually verified'].includes(payment.status);
  const reference = payment.reference_id || payment.receipt_number || payment.id;

  return (
    <main className="invoice-page">
      <div className="invoice-actions">
        <a href={session.admin ? '/dashboard?section=payments' : '/portal'}>← Back</a>
        <PrintReceiptButton />
      </div>
      <article className="invoice-sheet" aria-labelledby="invoice-title">
        <header className="invoice-header">
          <div><p>ORION SCALPER</p><h1 id="invoice-title">CLIENT INVOICE</h1><span>Secure account statement</span></div>
          <b className={`invoice-status invoice-status--${statusClass(payment.status)}`}>{payment.status}</b>
        </header>

        <section className="invoice-meta" aria-label="Invoice details">
          <div><small>Invoice reference</small><strong>{reference}</strong></div>
          <div><small>Recorded date</small><strong>{formatDate(payment.payment_date || payment.created_at)}</strong></div>
          <div><small>Payment method</small><strong>{payment.method}</strong></div>
        </section>

        <section className="invoice-parties">
          <div><small>BILLED TO</small><h2>{customer?.full_name || 'Orion client'}</h2><p>{customer?.email || 'Email not recorded'}<br />{customer?.country || 'Country not recorded'}</p></div>
          <div><small>ISSUED BY</small><h2>Orion Scalper</h2><p>Official client portal<br />Secure digital delivery</p></div>
        </section>

        <section className="invoice-items" aria-label="Invoice items">
          <div className="invoice-item-head"><span>Description</span><span>Access</span><span>Amount</span></div>
          <div className="invoice-item">
            <div><strong>Orion {payment.plan} plan</strong><p>{license ? `${license.platform} license · Account ${license.account_number || 'not assigned'}` : 'License assignment recorded separately'}</p>{license?.license_key && <code>{maskedLicenseKey(license.license_key)}</code>}</div>
            <span>{payment.plan}</span>
            <strong>{money(Number(payment.amount), payment.currency)}</strong>
          </div>
        </section>

        <footer className="invoice-footer">
          <div><span>{settled ? 'Total recorded' : 'Invoice amount'}</span><strong>{money(Number(payment.amount), payment.currency)}</strong></div>
          <p>{settled ? 'This invoice is linked to a completed account payment record. The separate payment receipt confirms the recorded payment.' : `This invoice reflects a transaction currently marked ${payment.status}. It is not proof of payment.`}</p>
          {settled && payment.receipt_number?.trim() && <a href={`/receipt/${payment.id}`}>Open payment receipt {payment.receipt_number} →</a>}
        </footer>
      </article>
    </main>
  );
}

function relation(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as { full_name?: string; email?: string; country?: string; license_key?: string; platform?: string; account_number?: string } : null;
}

function formatDate(value: string) {
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value); }
  catch { return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`; }
}

function statusClass(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function maskedLicenseKey(value: string) {
  return `License ending •••• ${value.slice(-4)}`;
}
