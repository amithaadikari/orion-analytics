import Link from 'next/link';
import { requireClient } from '@/lib/auth';
import PortalTopbar from '@/components/portal-topbar';
import RegistrationTracker from '@/components/registration-tracker';
import { countryFlag } from '@/lib/country';
import { checkoutPath, normalizePlan, plans } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export default async function PortalPage() {
  const { supabase, user, client } = await requireClient();
  const selectedPlan = normalizePlan(user.user_metadata?.selected_plan);
  const selected = selectedPlan ? plans[selectedPlan] : null;
  const [{ data: licenses }, { data: payments }, { data: releases }] = await Promise.all([
    supabase.from('licenses').select('id,license_key,platform,account_number,plan,status,issued_at,expires_at').eq('client_id', client.id).order('created_at', { ascending: false }),
    supabase.from('client_payments').select('id,plan,method,status,amount,currency,payment_date,reference_id').eq('client_id', client.id).order('created_at', { ascending: false }),
    supabase.from('product_releases').select('id,version,title,release_notes,platform,download_url,released_at').eq('published', true).order('released_at', { ascending: false }),
  ]);

  return (
    <main className="portal-shell">
      <a className="portal-skip-link" href="#portal-content">Skip to client workspace</a>
      <PortalTopbar clientName={client.full_name} />
      <section className="portal-content" id="portal-content" aria-labelledby="portal-title">
        <div className="portal-hero">
          <div className="portal-hero-copy">
            <p className="eyebrow">Orion V5 / Client command center</p>
            <h1 id="portal-title">Welcome back, <span>{client.full_name.split(' ')[0]}.</span></h1>
            <p>See your plan, license status, payment records, product updates, and next steps in one secure workspace.</p>
          </div>
          <div className="portal-account-state" aria-label={`Account status: ${client.status}`}>
            <small>Account status</small>
            <span className={`portal-status ${client.status.toLowerCase()}`} role="status">{client.status}</span>
          </div>
        </div>

        {client.status === 'Pending' && <div className="portal-approval-notice" role="status"><span className="portal-notice-mark" aria-hidden="true">!</span><div><strong>Paid plan awaiting approval</strong><span>Your portal account is active, but downloads and licensing remain locked until Orion verifies your payment.</span></div></div>}
        {client.plan === 'Free' && (
          <div className="portal-free-notice">
            <span className="portal-notice-mark" aria-hidden="true">◇</span>
            <div><strong>{selected ? `${selected.name} selection saved` : 'Free Orion account'}</strong><span>{selected ? `Review your ${selected.priceLabel} ${selected.license.toLowerCase()} before requesting official payment instructions.` : 'Choose an edition and review the full price before contacting Orion.'}</span></div>
            <Link href={checkoutPath(selectedPlan)}>{selected ? 'Review order' : 'Choose a plan'}<span>→</span></Link>
          </div>
        )}

        <div className="portal-metrics" aria-label="Account overview">
          <PortalMetric icon="◇" label="Assigned licenses" value={licenses?.length || 0} tone="cyan" />
          <PortalMetric icon="✦" label="Current plan" value={client.plan} tone="gold" />
          <PortalMetric icon="▣" label="Recorded payments" value={payments?.length || 0} tone="green" />
          <PortalMetric icon={countryFlag(client.country)} label="Registered country" value={client.country || 'Not set'} tone="cyan" />
        </div>

        <div className="portal-grid">
          <PortalPanel title="Your licenses" eyebrow="Software access" marker="01">
            <div className="portal-records">{licenses?.map((license) => <LicenseRecord key={license.id} license={license} />) || null}{!licenses?.length && <Empty text="No license has been assigned yet." />}</div>
          </PortalPanel>
          <PortalPanel title="Downloads & updates" eyebrow="Licensed releases" marker="02">
            <div className="portal-records">
              {releases?.map((release) => (
                <article className="release-record" key={release.id}>
                  <div><strong>{release.title}</strong><span>Version {release.version} · {release.platform}</span><p>{release.release_notes || 'Orion product update.'}</p></div>
                  {release.download_url ? <a href={release.download_url} rel="noopener noreferrer" aria-label={`Download ${release.title}, version ${release.version}`}>Download <span aria-hidden="true">↓</span></a> : <span className="muted">Coming soon</span>}
                </article>
              ))}
              {!releases?.length && <Empty text="Downloads become available after an active license is assigned." />}
            </div>
          </PortalPanel>
          <PortalPanel title="Payment history" eyebrow="Transactions" marker="03" wide>
            {payments?.length ? <div className="portal-table" role="table" aria-label="Payment history">
              <div className="portal-table-head" role="row"><span role="columnheader">Date</span><span role="columnheader">Plan</span><span role="columnheader">Method</span><span role="columnheader">Amount</span><span role="columnheader">Status</span></div>
              {payments.map((payment) => <div className="portal-table-row" role="row" key={payment.id}><span role="cell" data-label="Date">{payment.payment_date ? new Date(`${payment.payment_date}T00:00:00`).toLocaleDateString() : '—'}</span><strong role="cell" data-label="Plan">{payment.plan}</strong><span role="cell" data-label="Method">{payment.method}</span><span role="cell" data-label="Amount">{payment.currency} {Number(payment.amount).toLocaleString()}</span><span className={`payment-status ${payment.status.toLowerCase().replace(/\s+/g, '-')}`} role="cell" data-label="Status">{payment.status}</span></div>)}
            </div> : <Empty text="No payment history yet." />}
          </PortalPanel>
          <PortalPanel title="Your activation path" eyebrow="Setup & official support" marker="04" wide>
            <div className="portal-help" role="list" aria-label="Orion activation steps">
              <article role="listitem"><span aria-hidden="true">01</span><div><small>CHOOSE</small><strong>Review your plan</strong><p>Choose an Orion edition and confirm the full price in your secure order summary.</p>{client.plan === 'Free' && <Link href={checkoutPath(selectedPlan)}>Open order summary →</Link>}</div></article>
              <article role="listitem"><span aria-hidden="true">02</span><div><small>VERIFY</small><strong>Verify payment</strong><p>Follow only the official payment instructions provided by Orion support.</p></div></article>
              <article role="listitem"><span aria-hidden="true">03</span><div><small>ACTIVATE</small><strong>Activate your license</strong><p>After payment verification, Orion assigns the license for your registered trading account.</p><a href="https://t.me/authenticacademy" target="_blank" rel="noopener noreferrer">Open official support ↗</a></div></article>
            </div>
          </PortalPanel>
        </div>
      </section>
      {user.user_metadata?.registration_source === 'orion_client_portal' && <RegistrationTracker plan={selectedPlan} />}
    </main>
  );
}

function PortalMetric({ icon, label, value, tone }: { icon: string; label: string; value: string | number; tone: 'gold' | 'cyan' | 'green' }) {
  return <article className={`portal-metric portal-metric-${tone}`}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function PortalPanel({ title, eyebrow, marker, wide = false, children }: { title: string; eyebrow: string; marker: string; wide?: boolean; children: React.ReactNode }) {
  const headingId = `portal-panel-${marker}`;
  return <section className={`portal-panel ${wide ? 'wide' : ''}`} aria-labelledby={headingId}><header className="portal-panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2></div><span aria-hidden="true">{marker}</span></header>{children}</section>;
}

function LicenseRecord({ license }: { license: { license_key: string; platform: string; account_number?: string; plan: string; status: string; issued_at: string; expires_at?: string } }) {
  const expired = license.expires_at && new Date(`${license.expires_at.slice(0, 10)}T23:59:59.999Z`).getTime() < Date.now();
  const status = expired ? 'Expired' : license.status;
  const days = licenseDays(license.expires_at);
  return <article className="license-record" aria-label={`${license.platform} ${license.plan} license, ${status}`}><div><strong>{license.platform} · {license.plan}</strong><code>{license.license_key}</code></div><span className={status.toLowerCase()} role="status"><i aria-hidden="true" />{status}</span><dl><div><dt>Account</dt><dd>{license.account_number || 'Not assigned'}</dd></div><div><dt>Issued</dt><dd>{new Date(license.issued_at).toLocaleDateString()}</dd></div><div><dt>Expires</dt><dd>{license.expires_at ? new Date(`${license.expires_at.slice(0, 10)}T00:00:00`).toLocaleDateString() : 'Lifetime'}</dd></div></dl>{status === 'Active' && days !== null && days >= 0 && days <= 30 && <p className="license-renewal-warning">Renewal due in {days} day{days === 1 ? '' : 's'} · Contact Orion support</p>}</article>;
}

function licenseDays(expiresAt?: string) {
  if (!expiresAt) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${expiresAt.slice(0, 10)}T00:00:00Z`) - todayUtc) / 86400000);
}

function Empty({ text }: { text: string }) {
  return <p className="portal-empty" role="status"><span aria-hidden="true">◇</span>{text}</p>;
}
