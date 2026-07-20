import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import PrintReceiptButton from '@/components/print-receipt-button';
import { getPortalSession } from '@/lib/portal-session';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import './receipt.css';

export const dynamic = 'force-dynamic';

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) notFound();

  const session = await getPortalSession();
  if (!session.user) redirect(`/client-login?next=${encodeURIComponent(`/receipt/${id}`)}`);
  if (!session.admin && !session.client) notFound();

  const db = createSupabaseAdminClient();
  let query = db.from('client_payments')
    .select('id,client_id,license_id,receipt_number,plan,method,status,amount,currency,payment_date,reference_id,created_at,license_key_snapshot,license_platform_snapshot,account_number_snapshot,broker_server_snapshot,account_snapshot_captured_at,clients(full_name,email,country),licenses(license_key,platform,account_number)')
    .eq('id', parsedId.data);
  if (!session.admin && session.client) query = query.eq('client_id', session.client.id);
  const { data: payment, error } = await query.maybeSingle();
  if (error || !payment || !['Paid', 'Manually verified'].includes(payment.status) || !payment.receipt_number?.trim()) notFound();

  const customer = relation(payment.clients);
  const license = relation(payment.licenses);
  const licenseIdentity = payment.account_snapshot_captured_at ? {
    key: payment.license_key_snapshot || null,
    platform: payment.license_platform_snapshot || null,
    accountNumber: payment.account_number_snapshot || null,
    brokerServer: payment.broker_server_snapshot || null,
  } : license ? { key: license.license_key || null, platform: license.platform || null, accountNumber: license.account_number || null, brokerServer: null } : null;

  return (
    <main className="receipt-page">
      <div className="receipt-actions">
        <a href={session.admin ? '/dashboard?section=payments' : '/portal'}>← Back</a>
        <PrintReceiptButton />
      </div>
      <article className="receipt-sheet" aria-labelledby="receipt-title">
        <header><div><p>ORION SCALPER</p><h1 id="receipt-title">PAYMENT RECEIPT</h1></div><span>{payment.status === 'Paid' ? 'PAID' : 'VERIFIED'}</span></header>
        <section className="receipt-meta">
          <div><small>Receipt number</small><strong>{payment.receipt_number}</strong></div>
          <div><small>{payment.payment_date ? 'Payment date' : 'Recorded date'}</small><strong>{formatDate(payment.payment_date || payment.created_at)}</strong></div>
        </section>
        <section className="receipt-parties">
          <div><small>RECEIVED FROM</small><h2>{customer?.full_name || 'Orion client'}</h2><p>{customer?.email || 'No email'}<br />{customer?.country || ''}</p></div>
          <div><small>PAYMENT DETAILS</small><p>Method: <b>{payment.method}</b><br />Reference: <b>{payment.reference_id || '—'}</b></p></div>
        </section>
        <div className="receipt-line">
          <div><small>DESCRIPTION</small><strong>Orion {payment.plan} plan</strong>{licenseIdentity && <p>{licenseIdentity.platform || 'Orion'} · Account {licenseIdentity.accountNumber || 'Not assigned'}{licenseIdentity.brokerServer ? ` · ${licenseIdentity.brokerServer}` : ''}<br /><code>{maskedLicenseKey(licenseIdentity.key || undefined)}</code></p>}</div>
          <strong>{money(Number(payment.amount), payment.currency)}</strong>
        </div>
        <footer><div><span>Total paid</span><strong>{money(Number(payment.amount), payment.currency)}</strong></div><p>Thank you for choosing Orion Scalper. This computer-generated receipt confirms the payment recorded in your Orion account.</p></footer>
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
  if (!Number.isFinite(value)) return 'Amount unavailable';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value); }
  catch { return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`; }
}

function maskedLicenseKey(value?: string) {
  return value ? `License ending •••• ${value.slice(-4)}` : 'License linked in Software Center';
}
