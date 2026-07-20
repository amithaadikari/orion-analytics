import Link from 'next/link';
import { cookies } from 'next/headers';
import { KeyRound, LockKeyhole, MapPin, PackageOpen, ReceiptText, ShieldCheck } from 'lucide-react';
import { requireClient } from '@/lib/auth';
import ClientPortalInsights from '@/components/client-portal-insights';
import ClientProfileSummary from '@/components/client-profile-summary';
import PortalNotificationCenter from '@/components/portal-notification-center';
import PortalWorkspaceShell from '@/components/portal-workspace-shell';
import RegistrationTracker from '@/components/registration-tracker';
import SoftwareAccessHub from '@/components/software-access-hub';
import SupportTicketCenter from '@/components/support-ticket-center';
import { countryFlag } from '@/lib/country';
import { checkoutSelectionPath, normalizePlan, plans } from '@/lib/plans';
import { normalizePortalTheme, portalThemeCookie } from '@/lib/portal-theme';
import { clientProfileDisplayName, readClientProfile } from '@/lib/client-profile';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { compatibleReleaseForPlan } from '@/lib/portal-activation';

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
  const admin = createSupabaseAdminClient();
  const [licenseResult, paymentResult, releaseResult] = await Promise.all([
    supabase.from('licenses').select('id,license_key,platform,account_number,plan,status,issued_at,expires_at').eq('client_id', client.id).order('created_at', { ascending: false }),
    supabase.from('client_payments').select('id,plan,method,status,amount,currency,payment_date,reference_id,receipt_number,created_at').eq('client_id', client.id).order('created_at', { ascending: false }),
    admin.from('product_releases').select('id,version,title,release_notes,platform,download_url,released_at').eq('published', true).order('released_at', { ascending: false }),
  ]);
  const { data: licenses, error: licensesError } = licenseResult;
  const { data: payments, error: paymentsError } = paymentResult;
  const { data: releaseRows, error: releasesError } = releaseResult;
  const releases = (releaseRows || []).map(({ download_url, ...release }) => ({ ...release, download_url: download_url ? 'protected' : null }));
  const currentRelease = compatibleReleaseForPlan(client.plan, licenses || [], releases);
  const currentReleaseId = currentRelease?.id;
  const [downloadResult, downloadHistoryResult] = await Promise.all([
    currentReleaseId
      ? admin.from('download_events').select('id,release_id,version,platform,downloaded_at').eq('client_id', client.id).eq('release_id', currentReleaseId).order('downloaded_at', { ascending: false }).limit(1)
      : Promise.resolve({ data: [], error: null }),
    admin.from('download_events').select('id,release_id,version,platform,downloaded_at').eq('client_id', client.id).order('downloaded_at', { ascending: false }).limit(8),
  ]);
  const { data: downloads, error: downloadsError } = downloadResult;
  const { data: downloadHistory, error: downloadHistoryError } = downloadHistoryResult;
  const activationDataAvailable = !licensesError && !paymentsError && !releasesError;
  const activeLicenseCount = licenses?.filter((license) => {
    const expired = license.expires_at && new Date(`${license.expires_at.slice(0, 10)}T23:59:59.999Z`).getTime() < Date.now();
    return license.status === 'Active' && !expired;
  }).length || 0;
  const latestRelease = currentRelease;
  const latestReleaseVersion = latestRelease
    ? (/^v/i.test(latestRelease.version) ? latestRelease.version : `v${latestRelease.version}`)
    : 'Not ready';

  return (
    <PortalWorkspaceShell currentView="overview" clientName={client.full_name} clientDisplayName={displayName} clientAvatarKey={profile.avatarKey} clientPlan={client.plan} clientStatus={client.status} initialTheme={initialTheme}>
      <section className="portal-content portal-workspace-content" aria-labelledby="portal-title">
        <div className="portal-overview-view" id="overview" tabIndex={-1}>
          <div className="portal-hero portal-workspace-hero">
            <div className="portal-hero-copy">
              <p className="eyebrow">Orion client workspace</p>
              <h1 id="portal-title">Welcome back, <span>{displayName}.</span></h1>
              <p>Manage your setup, licenses, payments, software updates, and support from one secure workspace.</p>
              <div className="portal-hero-links"><a href="#setup">Continue setup <span aria-hidden="true">→</span></a><Link href="/portal/profile">View profile</Link></div>
            </div>
            <aside className="portal-account-state portal-account-snapshot" aria-label={`${client.plan} plan, account status ${client.status}`}>
              <div className="portal-account-snapshot-heading">
                <span aria-hidden="true"><ShieldCheck size={18} /></span>
                <div><small>Secure account</small><strong>Orion access</strong></div>
              </div>
              <div className="portal-account-snapshot-facts">
                <div><small>Current plan</small><strong>{client.plan}</strong></div>
                <div><small>Account status</small><span className={`portal-status ${client.status.toLowerCase()}`} role="status"><i aria-hidden="true" />{client.status}</span></div>
              </div>
              <p><LockKeyhole size={13} aria-hidden="true" />Protected client workspace</p>
            </aside>
          </div>

          {client.status === 'Pending' && <div className="portal-approval-notice" role="status"><span className="portal-notice-mark" aria-hidden="true">!</span><div><strong>Paid plan awaiting approval</strong><span>Your portal account is active, but downloads and licensing remain locked until Orion verifies your payment.</span></div></div>}
          {client.plan === 'Free' && (
            <div className="portal-free-notice">
              <span className="portal-notice-mark" aria-hidden="true">◇</span>
              <div><strong>{selected ? `${selected.name} selection saved` : 'Free Orion account'}</strong><span>{selected ? `Review your ${selected.priceLabel} ${selected.license.toLowerCase()} before requesting official payment instructions.` : 'Choose an edition and review the full price before contacting Orion.'}</span></div>
              <Link href={planSelectionPath}>{selected ? 'Review order' : 'Choose a plan'}<span>→</span></Link>
            </div>
          )}

          <header className="portal-overview-heading">
            <div><p className="eyebrow">Account summary</p><h2>At a glance</h2></div>
            <span>Updated from your Orion records</span>
          </header>
          <div className="portal-metrics portal-overview-metrics" aria-label="Account overview">
            <PortalMetric icon={<KeyRound size={18} />} label="Assigned licenses" value={licenses?.length || 0} detail={`${activeLicenseCount} active across plans`} tone="cyan" />
            <PortalMetric icon={<ReceiptText size={18} />} label="Payment records" value={payments?.length || 0} detail="Secure records on file" tone="green" />
            <PortalMetric icon={<PackageOpen size={18} />} label="Latest software" value={latestReleaseVersion} detail={latestRelease?.title || 'Available after activation'} tone="violet" />
            <PortalMetric icon={<MapPin size={18} />} label="Registered country" value={`${countryFlag(client.country)} ${client.country || 'Not set'}`} detail="Account location" tone="gold" />
          </div>

          <ClientProfileSummary fullName={client.full_name} country={client.country || null} profile={profile} />
        </div>

        <PortalWorkspaceSection title="Setup & activation" eyebrow="Your next step" marker="01" anchorId="setup" description="Follow your real account progress and jump directly to the action you need.">
          <ClientPortalInsights client={{ plan: client.plan, status: client.status }} licenses={licenses || []} payments={payments || []} releases={releases} downloads={downloads || []} recordsAvailable={activationDataAvailable} downloadHistoryAvailable={!downloadsError} planSelectionPath={planSelectionPath} showHeading={false} />
        </PortalWorkspaceSection>

        <SoftwareAccessHub client={{ plan: client.plan, status: client.status }} licenses={licenses || []} releases={releases} downloadActivity={downloadHistory || []} recordsAvailable={!licensesError && !releasesError} activityAvailable={!downloadHistoryError} currentReleaseRequested={Boolean(downloads?.length)} currentReleaseRequestAvailable={!downloadsError} />

        <div className="portal-grid portal-resource-grid">
          <PortalPanel title="Payment history" eyebrow="Transactions & documents" marker="03" anchorId="payments" wide>
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

function PortalMetric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string | number; detail: string; tone: 'gold' | 'cyan' | 'green' | 'violet' }) {
  return <article className={`portal-metric portal-metric-${tone}`}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function PortalPanel({ title, eyebrow, marker, anchorId, wide = false, children }: { title: string; eyebrow: string; marker: string; anchorId?: string; wide?: boolean; children: React.ReactNode }) {
  const headingId = `portal-panel-${marker}`;
  return <section className={`portal-panel portal-workspace-panel ${wide ? 'wide' : ''}`} id={anchorId} aria-labelledby={headingId}><header className="portal-panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2></div><span aria-hidden="true">{marker}</span></header>{children}</section>;
}

function PortalWorkspaceSection({ title, eyebrow, marker, anchorId, description, children }: { title: string; eyebrow: string; marker: string; anchorId: string; description: string; children: React.ReactNode }) {
  const headingId = `portal-section-${anchorId}`;
  return <section className="portal-workspace-section" id={anchorId} aria-labelledby={headingId}><header className="portal-workspace-section-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2><span>{description}</span></div><strong aria-hidden="true">{marker}</strong></header>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <p className="portal-empty" role="status"><span aria-hidden="true">◇</span>{text}</p>;
}
