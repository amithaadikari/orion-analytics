import Link from 'next/link';
import { requireClient } from '@/lib/auth';
import LogoutButton from '@/components/logout-button';
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
      <header className="portal-topbar">
        <div className="brand"><span className="brand-mark">✦</span><span>ORION <em>CLIENT</em></span></div>
        <div><span className="portal-user">{client.full_name}</span><LogoutButton redirectTo="/client-login" /></div>
      </header>
      <section className="portal-content">
        <div className="portal-hero">
          <div><p className="eyebrow">Client workspace</p><h1>Welcome back, {client.full_name.split(' ')[0]}.</h1><p>Manage your Orion access, licenses and updates securely.</p></div>
          <span className={`portal-status ${client.status.toLowerCase()}`}>{client.status}</span>
        </div>

        {client.status === 'Pending' && <div className="portal-approval-notice"><strong>Paid plan awaiting approval</strong><span>Your portal account is active, but downloads and licensing remain locked until Orion verifies your payment.</span></div>}
        {client.plan === 'Free' && (
          <div className="portal-free-notice">
            <div><strong>{selected ? `${selected.name} selection saved` : 'Free Orion account'}</strong><span>{selected ? `Review your ${selected.priceLabel} ${selected.license.toLowerCase()} before requesting official payment instructions.` : 'Choose an edition and review the full price before contacting Orion.'}</span></div>
            <Link href={checkoutPath(selectedPlan)}>{selected ? 'Review order' : 'Choose a plan'}<span>→</span></Link>
          </div>
        )}

        <div className="portal-metrics">
          <PortalMetric icon="◇" label="Licenses" value={licenses?.length || 0} />
          <PortalMetric icon="✦" label="Current plan" value={client.plan} />
          <PortalMetric icon="◈" label="Payments" value={payments?.length || 0} />
          <PortalMetric icon={countryFlag(client.country)} label="Country" value={client.country || 'Not set'} />
        </div>

        <div className="portal-grid">
          <PortalPanel title="Your licenses" eyebrow="Access">
            <div className="portal-records">{licenses?.map((license) => <LicenseRecord key={license.id} license={license} />) || null}{!licenses?.length && <Empty text="No license has been assigned yet." />}</div>
          </PortalPanel>
          <PortalPanel title="Downloads & updates" eyebrow="Licensed releases">
            <div className="portal-records">
              {releases?.map((release) => <div className="release-record" key={release.id}><div><strong>{release.title}</strong><span>Version {release.version} · {release.platform}</span><p>{release.release_notes || 'Orion product update.'}</p></div>{release.download_url ? <a href={release.download_url} rel="noopener noreferrer">Download</a> : <span className="muted">Coming soon</span>}</div>)}
              {!releases?.length && <Empty text="Downloads become available after an active license is assigned." />}
            </div>
          </PortalPanel>
          <PortalPanel title="Payment history" eyebrow="Transactions" wide>
            <div className="portal-table">
              <div className="portal-table-head"><span>Date</span><span>Plan</span><span>Method</span><span>Amount</span><span>Status</span></div>
              {payments?.map((payment) => <div className="portal-table-row" key={payment.id}><span>{payment.payment_date ? new Date(`${payment.payment_date}T00:00:00`).toLocaleDateString() : '—'}</span><strong>{payment.plan}</strong><span>{payment.method}</span><span>{payment.currency} {Number(payment.amount).toLocaleString()}</span><b>{payment.status}</b></div>)}
              {!payments?.length && <Empty text="No payment history yet." />}
            </div>
          </PortalPanel>
          <PortalPanel title="Setup & support" eyebrow="Help" wide>
            <div className="portal-help">
              <article><span>01</span><div><strong>Review your plan</strong><p>Choose an Orion edition and confirm the full price in your secure order summary.</p>{client.plan === 'Free' && <Link href={checkoutPath(selectedPlan)}>Open order summary →</Link>}</div></article>
              <article><span>02</span><div><strong>Verify payment</strong><p>Follow only the official payment instructions provided by Orion support.</p></div></article>
              <article><span>03</span><div><strong>Activate your license</strong><p>After payment verification, Orion assigns the license for your registered trading account.</p><a href="https://t.me/authenticacademy" target="_blank" rel="noopener noreferrer">Open official support ↗</a></div></article>
            </div>
          </PortalPanel>
        </div>
      </section>
      {user.user_metadata?.registration_source === 'orion_client_portal' && <RegistrationTracker plan={selectedPlan} />}
    </main>
  );
}

function PortalMetric({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return <article><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function PortalPanel({ title, eyebrow, wide = false, children }: { title: string; eyebrow: string; wide?: boolean; children: React.ReactNode }) {
  return <article className={`portal-panel ${wide ? 'wide' : ''}`}><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</article>;
}

function LicenseRecord({ license }: { license: { license_key: string; platform: string; account_number?: string; plan: string; status: string; issued_at: string; expires_at?: string } }) {
  const expired = license.expires_at && new Date(`${license.expires_at.slice(0, 10)}T23:59:59.999Z`).getTime() < Date.now();
  const status = expired ? 'Expired' : license.status;
  const days = licenseDays(license.expires_at);
  return <div className="license-record"><div><strong>{license.platform} · {license.plan}</strong><code>{license.license_key}</code></div><span className={status.toLowerCase()}>{status}</span><dl><div><dt>Account</dt><dd>{license.account_number || 'Not assigned'}</dd></div><div><dt>Issued</dt><dd>{new Date(license.issued_at).toLocaleDateString()}</dd></div><div><dt>Expires</dt><dd>{license.expires_at ? new Date(`${license.expires_at.slice(0, 10)}T00:00:00`).toLocaleDateString() : 'Lifetime'}</dd></div></dl>{status === 'Active' && days !== null && days >= 0 && days <= 30 && <p className="license-renewal-warning">Renewal due in {days} day{days === 1 ? '' : 's'} · Contact Orion support</p>}</div>;
}

function licenseDays(expiresAt?: string) {
  if (!expiresAt) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${expiresAt.slice(0, 10)}T00:00:00Z`) - todayUtc) / 86400000);
}

function Empty({ text }: { text: string }) {
  return <p className="portal-empty">{text}</p>;
}
