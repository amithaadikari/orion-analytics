import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireClient } from '@/lib/auth';
import ClientPortalInsights from '@/components/client-portal-insights';
import ClientProfileSummary from '@/components/client-profile-summary';
import PortalNotificationCenter from '@/components/portal-notification-center';
import PortalWorkspaceShell from '@/components/portal-workspace-shell';
import RegistrationTracker from '@/components/registration-tracker';
import SupportTicketCenter from '@/components/support-ticket-center';
import { countryFlag } from '@/lib/country';
import { checkoutSelectionPath, normalizePlan, plans } from '@/lib/plans';
import { normalizePortalTheme, portalThemeCookie } from '@/lib/portal-theme';
import { clientProfileDisplayName, readClientProfile } from '@/lib/client-profile';

export const dynamic = 'force-dynamic';

export default async function PortalPage() {
  const { supabase, user, client } = await requireClient();
  const cookieStore = await cookies();
  const initialTheme = normalizePortalTheme(cookieStore.get(portalThemeCookie)?.value);
  const selectedPlan = normalizePlan(user.user_metadata?.selected_plan);
  const selected = selectedPlan ? plans[selectedPlan] : null;
  const planSelectionPath = checkoutSelectionPath(selectedPlan);
  const profile = readClientProfile(user.user_metadata, {
    telegramUsername: client.telegram_username,
    phoneNumber: client.phone,
  });
  const displayName = clientProfileDisplayName(profile, client.full_name);
  const [{ data: licenses }, { data: payments }, { data: releases }] = await Promise.all([
    supabase.from('licenses').select('id,license_key,platform,account_number,plan,status,issued_at,expires_at').eq('client_id', client.id).order('created_at', { ascending: false }),
    supabase.from('client_payments').select('id,plan,method,status,amount,currency,payment_date,reference_id,receipt_number').eq('client_id', client.id).order('created_at', { ascending: false }),
    supabase.from('product_releases').select('id,version,title,release_notes,platform,download_url,released_at').eq('published', true).order('released_at', { ascending: false }),
  ]);

  return (
    <PortalWorkspaceShell currentView="overview" clientName={client.full_name} clientDisplayName={displayName} clientAvatarKey={profile.avatarKey} clientPlan={client.plan} clientStatus={client.status} initialTheme={initialTheme}>
      <section className="portal-content portal-workspace-content" aria-labelledby="portal-title">
        <div className="portal-overview-view" id="overview" tabIndex={-1}>
          <div className="portal-hero portal-workspace-hero">
            <div className="portal-hero-copy">
              <p className="eyebrow">Orion V5 · Secure client workspace</p>
              <h1 id="portal-title">Everything you need, <span>{displayName}.</span></h1>
              <p>Your setup, software access, payments, updates, and official support are now organized in one simple workspace.</p>
              <div className="portal-hero-links"><a href="#setup">Continue setup <span aria-hidden="true">→</span></a><a href="#support">Get support</a></div>
            </div>
            <div className="portal-account-state portal-account-snapshot" aria-label={`${client.plan} plan, account status ${client.status}`}>
              <div><small>Current plan</small><strong>{client.plan}</strong></div>
              <span className={`portal-status ${client.status.toLowerCase()}`} role="status"><i aria-hidden="true" />{client.status}</span>
              <p>Protected access · Orion V5</p>
            </div>
          </div>

          {client.status === 'Pending' && <div className="portal-approval-notice" role="status"><span className="portal-notice-mark" aria-hidden="true">!</span><div><strong>Paid plan awaiting approval</strong><span>Your portal account is active, but downloads and licensing remain locked until Orion verifies your payment.</span></div></div>}
          {client.plan === 'Free' && (
            <div className="portal-free-notice">
              <span className="portal-notice-mark" aria-hidden="true">◇</span>
              <div><strong>{selected ? `${selected.name} selection saved` : 'Free Orion account'}</strong><span>{selected ? `Review your ${selected.priceLabel} ${selected.license.toLowerCase()} before requesting official payment instructions.` : 'Choose an edition and review the full price before contacting Orion.'}</span></div>
              <Link href={planSelectionPath}>{selected ? 'Review order' : 'Choose a plan'}<span>→</span></Link>
            </div>
          )}

          <div className="portal-metrics" aria-label="Account overview">
            <PortalMetric icon="◇" label="Assigned licenses" value={licenses?.length || 0} tone="cyan" />
            <PortalMetric icon="✦" label="Current plan" value={client.plan} tone="gold" />
            <PortalMetric icon="▣" label="Recorded payments" value={payments?.length || 0} tone="green" />
            <PortalMetric icon={countryFlag(client.country)} label="Registered country" value={client.country || 'Not set'} tone="cyan" />
          </div>

          <ClientProfileSummary fullName={client.full_name} country={client.country || null} profile={profile} />
        </div>

        <PortalWorkspaceSection title="Setup & activation" eyebrow="Your next step" marker="01" anchorId="setup" description="Follow your real account progress and jump directly to the action you need.">
          <ClientPortalInsights client={{ plan: client.plan, status: client.status }} licenses={licenses || []} payments={payments || []} showHeading={false} />
          <div className="portal-setup-actions" aria-label="Setup shortcuts">
            {client.plan === 'Free' ? <Link href={planSelectionPath}><span aria-hidden="true">01</span><div><small>Choose</small><strong>Review your Orion plan</strong><p>See the full price and what your selected edition includes.</p></div><b aria-hidden="true">→</b></Link> : <a href="#licenses"><span aria-hidden="true">01</span><div><small>Access</small><strong>View your license</strong><p>Check the account, platform, status, and expiry linked to your key.</p></div><b aria-hidden="true">→</b></a>}
            <a href="#payments"><span aria-hidden="true">02</span><div><small>Verify</small><strong>Check payment records</strong><p>Confirm your payment status and download available documents.</p></div><b aria-hidden="true">→</b></a>
            <a href="#support"><span aria-hidden="true">03</span><div><small>Support</small><strong>Ask Orion securely</strong><p>Keep setup, license, and payment questions in one official thread.</p></div><b aria-hidden="true">→</b></a>
          </div>
        </PortalWorkspaceSection>

        <div className="portal-grid portal-resource-grid">
          <PortalPanel title="Your licenses" eyebrow="Software access" marker="02" anchorId="licenses">
            <div className="portal-records">{licenses?.map((license) => <LicenseRecord key={license.id} license={license} />) || null}{!licenses?.length && <Empty text="No license has been assigned yet." />}</div>
          </PortalPanel>
          <PortalPanel title="Downloads & updates" eyebrow="Licensed releases" marker="03" anchorId="downloads">
            <div className="portal-records">
              {releases?.map((release) => (
                <article className="release-record" key={release.id}>
                  <div><strong>{release.title}</strong><span>Version {release.version} · {release.platform}</span><p>{release.release_notes || 'Orion product update.'}</p></div>
                  {release.download_url ? <a href={`/api/downloads/${release.id}`} aria-label={`Securely download ${release.title}, version ${release.version}`}>Secure download <span aria-hidden="true">↓</span></a> : <span className="muted">Coming soon</span>}
                </article>
              ))}
              {!releases?.length && <Empty text="Downloads become available after an active license is assigned." />}
            </div>
          </PortalPanel>
          <PortalPanel title="Payment history" eyebrow="Transactions & documents" marker="04" anchorId="payments" wide>
            {payments?.length ? <div className="portal-table" role="table" aria-label="Payment history">
              <div className="portal-table-head portal-table-head--documents" role="row"><span role="columnheader">Date</span><span role="columnheader">Plan</span><span role="columnheader">Method</span><span role="columnheader">Amount</span><span role="columnheader">Status</span><span role="columnheader">Documents</span></div>
              {payments.map((payment) => <div className="portal-table-row portal-table-row--documents" role="row" key={payment.id}><span role="cell" data-label="Date">{payment.payment_date ? new Date(`${payment.payment_date}T00:00:00`).toLocaleDateString() : '—'}</span><strong role="cell" data-label="Plan">{payment.plan}</strong><span role="cell" data-label="Method">{payment.method}</span><span role="cell" data-label="Amount">{payment.currency} {Number(payment.amount).toLocaleString()}</span><span className={`payment-status ${payment.status.toLowerCase().replace(/\s+/g, '-')}`} role="cell" data-label="Status">{payment.status}</span><span className="portal-document-links" role="cell" data-label="Documents"><Link href={`/invoice/${payment.id}`}>Invoice</Link>{payment.receipt_number && <Link href={`/receipt/${payment.id}`}>Receipt</Link>}</span></div>)}
            </div> : <Empty text="No payment history yet." />}
          </PortalPanel>
        </div>

        <PortalNotificationCenter />
        <SupportTicketCenter />
      </section>
      {user.user_metadata?.registration_source === 'orion_client_portal' && <RegistrationTracker plan={selectedPlan} />}
    </PortalWorkspaceShell>
  );
}

function PortalMetric({ icon, label, value, tone }: { icon: string; label: string; value: string | number; tone: 'gold' | 'cyan' | 'green' }) {
  return <article className={`portal-metric portal-metric-${tone}`}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function PortalPanel({ title, eyebrow, marker, anchorId, wide = false, children }: { title: string; eyebrow: string; marker: string; anchorId?: string; wide?: boolean; children: React.ReactNode }) {
  const headingId = `portal-panel-${marker}`;
  return <section className={`portal-panel portal-workspace-panel ${wide ? 'wide' : ''}`} id={anchorId} aria-labelledby={headingId}><header className="portal-panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2></div><span aria-hidden="true">{marker}</span></header>{children}</section>;
}

function PortalWorkspaceSection({ title, eyebrow, marker, anchorId, description, children }: { title: string; eyebrow: string; marker: string; anchorId: string; description: string; children: React.ReactNode }) {
  const headingId = `portal-section-${anchorId}`;
  return <section className="portal-workspace-section" id={anchorId} aria-labelledby={headingId}><header className="portal-workspace-section-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2><span>{description}</span></div><strong aria-hidden="true">{marker}</strong></header>{children}</section>;
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
