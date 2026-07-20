import React from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  FolderOpen,
  History,
  KeyRound,
  LockKeyhole,
  Monitor,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import CopyLicenseButton from '@/components/copy-license-button';
import {
  activeLicensesForPlan,
  compatibleReleaseForPlan,
  effectiveLicenseStatus,
  normalizeActivationValue,
} from '@/lib/portal-activation';
import styles from './software-access-hub.module.css';

export type SoftwareLicense = {
  id: string;
  license_key: string;
  platform: string;
  account_number?: string | null;
  plan: string;
  status: string;
  issued_at: string;
  expires_at?: string | null;
};

export type SoftwareRelease = {
  id: string;
  version: string;
  title: string;
  release_notes?: string | null;
  platform: string;
  download_url?: string | null;
  released_at: string;
};

export type SoftwareDownloadActivity = {
  id: string;
  release_id?: string | null;
  version?: string | null;
  platform?: string | null;
  downloaded_at: string;
};

type SoftwareAccessHubProps = {
  client: { plan: string; status: string };
  licenses: SoftwareLicense[];
  releases: SoftwareRelease[];
  downloadActivity: SoftwareDownloadActivity[];
  recordsAvailable: boolean;
  activityAvailable: boolean;
  currentReleaseRequested: boolean;
  currentReleaseRequestAvailable: boolean;
};

type HubTone = 'ready' | 'pending' | 'attention' | 'unavailable';

export default function SoftwareAccessHub({ client, licenses, releases, downloadActivity, recordsAvailable, activityAvailable, currentReleaseRequested, currentReleaseRequestAvailable }: SoftwareAccessHubProps) {
  const currentPlanLicenses = licenses.filter((license) => normalizeActivationValue(license.plan) === normalizeActivationValue(client.plan));
  const activePlanLicenses = activeLicensesForPlan(client.plan, licenses);
  const accountStatus = normalizeActivationValue(client.status);
  const accountActive = accountStatus === 'active';
  const accountExpired = accountStatus === 'expired';
  const accountPaused = ['suspended', 'disabled', 'inactive'].includes(accountStatus);
  const secureRelease = compatibleReleaseForPlan(client.plan, licenses, releases);
  const matchingActiveLicense = secureRelease && normalizeActivationValue(secureRelease.platform) !== 'both'
    ? activePlanLicenses.find((license) => normalizeActivationValue(license.platform) === normalizeActivationValue(secureRelease.platform))
    : activePlanLicenses[0];
  const primaryLicense = matchingActiveLicense || activePlanLicenses[0] || currentPlanLicenses[0];
  const additionalLicenses = licenses.filter((license) => license.id !== primaryLicense?.id);
  const releasePlatforms = new Set((activePlanLicenses.length ? activePlanLicenses : currentPlanLicenses).map((license) => normalizeActivationValue(license.platform)));
  const displayRelease = releases.find((release) => normalizeActivationValue(release.platform) === 'both' || releasePlatforms.has(normalizeActivationValue(release.platform)));
  const accessReady = recordsAvailable && accountActive && Boolean(secureRelease);
  const primaryRelease = accessReady ? secureRelease : displayRelease;
  const additionalSecureReleases = accessReady && secureRelease
    ? downloadableReleaseOptions(activePlanLicenses, releases).filter((option) => option.release.id !== secureRelease.id)
    : [];
  const releaseAccessLabel = !accessReady
    ? 'Latest compatible release'
    : currentReleaseRequested
        ? 'Latest release requested'
        : !currentReleaseRequestAvailable || !activityAvailable
          ? 'Available for secure download'
          : downloadActivity.length
          ? 'Update available'
          : 'Ready for first download';
  const hubState = resolveHubState({ recordsAvailable, accountActive, accountPaused, accountExpired, currentPlanLicenses, activePlanLicenses, secureRelease });
  const primaryStatus = primaryLicense ? effectiveLicenseStatus(primaryLicense) : 'pending';
  const expiry = licenseExpiry(primaryLicense?.expires_at, primaryLicense?.plan, primaryStatus);
  const licensePlatform = platformDetails(primaryLicense?.platform);
  const setupPlatform = platformDetails(normalizeActivationValue(secureRelease?.platform || '') === 'both' || additionalSecureReleases.length > 0 ? 'Both' : primaryLicense?.platform);
  const visibleActivity = downloadActivity.slice(0, 3);
  const olderActivity = downloadActivity.slice(3);

  return (
    <section className={styles.hub} id="licenses" aria-labelledby="software-access-title" data-state={hubState.tone}>
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Software access</p>
          <h2 id="software-access-title">Orion Software Center</h2>
          <span>Your license, latest EA release, setup guide, and secure download activity in one place.</span>
        </div>
        <div className={styles.hubStatus} role="status" data-tone={hubState.tone}>
          <StatusIcon tone={hubState.tone} />
          <span><small>Current status</small><strong>{hubState.label}</strong></span>
        </div>
        <strong className={styles.marker} aria-hidden="true">02</strong>
      </header>

      <div className={styles.accessGrid}>
        <article className={styles.licenseCard} data-tone={licenseTone(primaryStatus)}>
          <div className={styles.scanLayer} aria-hidden="true"><i /><i /><i /></div>
          <header className={styles.cardHeading}>
            <span aria-hidden="true"><Monitor size={21} /></span>
            <div><small>{primaryLicense ? `${primaryLicense.plan} license` : 'License assignment'}</small><h3>{primaryLicense ? `${licensePlatform.label} access key` : 'Your license is being prepared'}</h3></div>
            <span className={styles.licenseStatus} data-tone={licenseTone(primaryStatus)}><i aria-hidden="true" />{formatStatus(primaryStatus)}</span>
          </header>

          {recordsAvailable ? primaryLicense ? (
            <>
              <div className={styles.keyField}>
                <span><KeyRound size={15} aria-hidden="true" />License key</span>
                <div><code>{primaryLicense.license_key}</code><CopyLicenseButton licenseKey={primaryLicense.license_key} /></div>
              </div>
              <dl className={styles.licenseFacts}>
                <div><dt>Platform</dt><dd>{licensePlatform.label}</dd></div>
                <div><dt>Trading account</dt><dd>{primaryLicense.account_number || 'Not assigned'}</dd></div>
                <div><dt>Issued</dt><dd>{formatDate(primaryLicense.issued_at)}</dd></div>
                <div><dt>Access period</dt><dd>{expiry.dateLabel}</dd></div>
              </dl>
              <div className={styles.renewalBar} data-tone={expiry.tone}>
                <span aria-hidden="true"><CalendarClock size={17} /></span>
                <div><small>{expiry.eyebrow}</small><strong>{expiry.countdown}</strong></div>
                {expiry.tone === 'attention' && <a href="#support">Get renewal help <span aria-hidden="true">→</span></a>}
              </div>
            </>
          ) : (
            <AccessPlaceholder icon={<KeyRound size={21} />} title="No license assigned yet" text="Orion will place your license here after your account and payment are approved." />
          ) : (
            <AccessPlaceholder icon={<RefreshCw size={21} />} title="License status temporarily unavailable" text="Refresh the portal in a moment. No access decision is being shown while your records cannot be confirmed." />
          )}
        </article>

        <article className={styles.releaseCard} id="downloads" data-ready={accessReady ? 'true' : 'false'}>
          <header className={styles.cardHeading}>
            <span aria-hidden="true">{accessReady ? <PackageCheck size={21} /> : <LockKeyhole size={20} />}</span>
            <div><small>{releaseAccessLabel}</small><h3>{primaryRelease?.title || 'EA release access'}</h3></div>
            {primaryRelease && <span className={styles.versionBadge}>{formatVersion(primaryRelease.version)}</span>}
          </header>

          {!recordsAvailable ? (
            <AccessPlaceholder icon={<RefreshCw size={21} />} title="Release status unavailable" text="We cannot safely confirm your licensed release right now. Please refresh or use official support." />
          ) : primaryRelease ? (
            <>
              <div className={styles.releaseVisual} aria-hidden="true">
                <span><ShieldCheck size={26} /></span>
                <i /><i /><i />
                <strong>{formatPlatform(primaryRelease.platform)}</strong>
              </div>
              <div className={styles.releaseMeta}>
                <span><small>Version</small><strong>{formatVersion(primaryRelease.version)}</strong></span>
                <span><small>Platform</small><strong>{formatPlatform(primaryRelease.platform)}</strong></span>
                <span><small>Released</small><strong>{formatDate(primaryRelease.released_at)}</strong></span>
              </div>
              <p className={styles.releaseNotes}>{primaryRelease.release_notes || 'The latest Orion EA release approved for your licensed platform.'}</p>
              {accessReady && secureRelease && (
                <a className={styles.downloadButton} href={`/api/downloads/${secureRelease.id}`} aria-label={`Securely download ${secureRelease.title}, version ${secureRelease.version}`}>
                  <span><Download size={17} aria-hidden="true" />Secure download</span><strong>{formatVersion(secureRelease.version)}</strong>
                </a>
              )}
              {additionalSecureReleases.length > 0 && <div className={styles.additionalReleases}><small>Other licensed platform</small>{additionalSecureReleases.map(({ platform, release }) => <a href={`/api/downloads/${release.id}`} key={`${platform}:${release.id}`} aria-label={`Securely download ${release.title}, version ${release.version}, for ${formatPlatform(platform)}`}><span><Monitor size={14} aria-hidden="true" /><strong>{formatPlatform(platform)}</strong><small>{formatVersion(release.version)}</small></span><Download size={14} aria-hidden="true" /></a>)}</div>}
            </>
          ) : (
            <AccessPlaceholder icon={<LockKeyhole size={21} />} title={activePlanLicenses.length ? 'Compatible release is being prepared' : 'Download unlocks with your license'} text={activePlanLicenses.length ? 'Your license is active. Orion will show the secure download here as soon as a compatible release is published.' : 'An active license for your current plan and platform is required before secure delivery can begin.'} />
          )}
          {!accessReady && <div className={styles.lockedAction}><span><LockKeyhole size={16} aria-hidden="true" /><strong>Download locked</strong></span><a href="#support">Contact support <span aria-hidden="true">→</span></a></div>}
          <p className={styles.securityNote}><ShieldCheck size={13} aria-hidden="true" />Secure delivery is checked against your account and active platform license.</p>
        </article>
      </div>

      {recordsAvailable && additionalLicenses.length > 0 && (
        <details className={styles.otherLicenses}>
          <summary><div><small>Other assigned licenses</small><strong>{additionalLicenses.length} additional record{additionalLicenses.length === 1 ? '' : 's'}</strong></div><span>View licenses <ChevronDown size={15} aria-hidden="true" /></span></summary>
          <div>
            {additionalLicenses.map((license) => {
              const status = effectiveLicenseStatus(license);
              const term = license.expires_at ? `Expires ${formatDate(license.expires_at)}` : license.plan === 'Lifetime' ? 'Lifetime' : 'Expiry date not set';
              return <article key={license.id}><span className={styles.miniPlatform}>{formatPlatform(license.platform)}</span><div><strong>{license.plan}</strong><code>{license.license_key}</code><small>{license.account_number ? `Account ${license.account_number}` : 'Account not assigned'} · {term}</small></div><span className={styles.miniStatus} data-tone={licenseTone(status)}>{formatStatus(status)}</span><CopyLicenseButton licenseKey={license.license_key} compact /></article>;
            })}
          </div>
        </details>
      )}

      <details className={styles.guide}>
        <summary><div><p className="eyebrow">Quick installation</p><h3>From download to running on your chart</h3></div><span>{setupPlatform.helper} <ChevronDown size={15} aria-hidden="true" /></span></summary>
        <ol>
          <GuideStep number="01" icon={<Download size={18} />} title="Download the EA" text="Use the secure button above so Orion can confirm the release against your account and licensed platform." />
          <GuideStep number="02" icon={<FolderOpen size={18} />} title="Place it in Experts" text={`Open the MetaTrader data folder, then place the EA file inside ${setupPlatform.folder}. Refresh Navigator or restart MetaTrader.`} />
          <GuideStep number="03" icon={<CheckCircle2 size={18} />} title="Attach and activate" text="Attach Orion to your chart, enter the matching license key, enable automated trading, and confirm the active status." />
        </ol>
      </details>

      <section className={styles.activity} aria-labelledby="download-activity-title">
          <header><div><History size={17} aria-hidden="true" /><span><small>Secure records</small><h3 id="download-activity-title">Download activity</h3></span></div><div className={styles.activityActions}><strong>{activityAvailable ? `${downloadActivity.length} recent` : 'Unavailable'}</strong><a href="#support">Need help?</a></div></header>
          {!activityAvailable ? (
            <AccessPlaceholder icon={<RefreshCw size={20} />} title="Activity temporarily unavailable" text="Your download record cannot be confirmed right now. This does not change your license status." compact />
          ) : downloadActivity.length ? (
            <><ol>{visibleActivity.map((activity) => <DownloadActivityRow activity={activity} key={activity.id} />)}</ol>{olderActivity.length > 0 && <details className={styles.activityHistory}><summary>View {olderActivity.length} older request{olderActivity.length === 1 ? '' : 's'} <ChevronDown size={14} aria-hidden="true" /></summary><ol>{olderActivity.map((activity) => <DownloadActivityRow activity={activity} key={activity.id} />)}</ol></details>}</>
          ) : (
            <AccessPlaceholder icon={<History size={20} />} title="No download requests yet" text="Your recent secure delivery requests will appear here after you use the download button." compact />
          )}
          <p>Activity is recorded when secure delivery begins; it does not confirm that the file finished downloading.</p>
      </section>
    </section>
  );
}

function GuideStep({ number, icon, title, text }: { number: string; icon: React.ReactNode; title: string; text: string }) {
  return <li><span className={styles.stepIcon} aria-hidden="true">{icon}</span><div><small>Step {number}</small><strong>{title}</strong><p>{text}</p></div><i aria-hidden="true" /></li>;
}

function DownloadActivityRow({ activity }: { activity: SoftwareDownloadActivity }) {
  return <li><span aria-hidden="true"><Download size={15} /></span><div><strong>Secure delivery requested</strong><small>{formatVersion(activity.version || 'Release')} · {formatPlatform(activity.platform || 'MetaTrader')}</small></div><time dateTime={activity.downloaded_at}>{formatDateTime(activity.downloaded_at)}</time></li>;
}

function AccessPlaceholder({ icon, title, text, compact = false }: { icon: React.ReactNode; title: string; text: string; compact?: boolean }) {
  return <div className={`${styles.placeholder} ${compact ? styles.placeholderCompact : ''}`} role="status"><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function StatusIcon({ tone }: { tone: HubTone }) {
  if (tone === 'ready') return <CheckCircle2 size={17} aria-hidden="true" />;
  if (tone === 'attention') return <CircleAlert size={17} aria-hidden="true" />;
  if (tone === 'unavailable') return <RefreshCw size={17} aria-hidden="true" />;
  return <Clock3 size={17} aria-hidden="true" />;
}

function resolveHubState({ recordsAvailable, accountActive, accountPaused, accountExpired, currentPlanLicenses, activePlanLicenses, secureRelease }: { recordsAvailable: boolean; accountActive: boolean; accountPaused: boolean; accountExpired: boolean; currentPlanLicenses: SoftwareLicense[]; activePlanLicenses: SoftwareLicense[]; secureRelease?: SoftwareRelease }) {
  if (!recordsAvailable) return { tone: 'unavailable' as const, label: 'Status unavailable' };
  if (accountExpired) return { tone: 'attention' as const, label: 'Account expired' };
  if (accountPaused) return { tone: 'attention' as const, label: 'Account paused' };
  if (!accountActive) return { tone: 'pending' as const, label: 'Approval pending' };
  if (!activePlanLicenses.length) {
    const currentStatus = currentPlanLicenses[0] ? effectiveLicenseStatus(currentPlanLicenses[0]) : 'pending';
    if (['expired', 'revoked', 'suspended'].includes(currentStatus)) return { tone: 'attention' as const, label: currentStatus === 'expired' ? 'Renewal needed' : 'License unavailable' };
    return { tone: 'pending' as const, label: 'License pending' };
  }
  if (!secureRelease) return { tone: 'pending' as const, label: 'Release pending' };
  return { tone: 'ready' as const, label: 'Access ready' };
}

function downloadableReleaseOptions(activeLicenses: SoftwareLicense[], releases: SoftwareRelease[]) {
  const platforms = [...new Set(activeLicenses.map((license) => normalizeActivationValue(license.platform)))];
  const options = platforms.flatMap((platform) => {
    const release = releases.find((candidate) => Boolean(candidate.download_url) && ['both', platform].includes(normalizeActivationValue(candidate.platform)));
    return release ? [{ platform, release }] : [];
  });
  const seen = new Set<string>();
  return options.filter(({ release }) => {
    if (seen.has(release.id)) return false;
    seen.add(release.id);
    return true;
  }).sort((left, right) => releases.findIndex((release) => release.id === left.release.id) - releases.findIndex((release) => release.id === right.release.id));
}

function licenseExpiry(expiresAt?: string | null, plan?: string, effectiveStatus = 'pending') {
  const recordedDate = expiresAt ? formatDate(expiresAt) : plan === 'Lifetime' ? 'Lifetime' : 'Not set';
  if (effectiveStatus === 'suspended') return { dateLabel: recordedDate, eyebrow: 'License status', countdown: 'Access suspended', tone: 'attention' as const };
  if (['revoked', 'disabled'].includes(effectiveStatus)) return { dateLabel: recordedDate, eyebrow: 'License status', countdown: 'Access unavailable', tone: 'attention' as const };
  if (effectiveStatus === 'expired') {
    const days = expiresAt ? daysUntil(expiresAt) : 0;
    return { dateLabel: recordedDate, eyebrow: 'License status', countdown: days < 0 ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` : 'License marked expired', tone: 'attention' as const };
  }
  if (effectiveStatus !== 'active') return { dateLabel: recordedDate, eyebrow: 'License status', countdown: 'Activation pending', tone: 'pending' as const };
  if (!expiresAt && plan === 'Lifetime') return { dateLabel: 'Lifetime', eyebrow: 'License duration', countdown: 'Lifetime access', tone: 'ready' as const };
  if (!expiresAt) return { dateLabel: 'Not set', eyebrow: 'License term', countdown: 'Expiry date not set', tone: 'pending' as const };
  const days = daysUntil(expiresAt);
  if (days < 0) return { dateLabel: formatDate(expiresAt), eyebrow: 'License expired', countdown: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`, tone: 'attention' as const };
  if (days === 0) return { dateLabel: formatDate(expiresAt), eyebrow: 'Renewal countdown', countdown: 'Expires today', tone: 'attention' as const };
  if (days <= 30) return { dateLabel: formatDate(expiresAt), eyebrow: 'Renewal countdown', countdown: `${days} day${days === 1 ? '' : 's'} remaining`, tone: 'attention' as const };
  return { dateLabel: formatDate(expiresAt), eyebrow: 'License countdown', countdown: `${days} days remaining`, tone: 'ready' as const };
}

function daysUntil(date: string) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - todayUtc) / 86400000);
}

function platformDetails(platform?: string) {
  const normalized = normalizeActivationValue(platform || '');
  if (normalized === 'mt4') return { label: 'MT4', folder: 'MQL4 → Experts', helper: 'MetaTrader 4 setup' };
  if (normalized === 'mt5') return { label: 'MT5', folder: 'MQL5 → Experts', helper: 'MetaTrader 5 setup' };
  if (normalized === 'both') return { label: 'MT4 + MT5', folder: 'MQL4 or MQL5 → Experts', helper: 'MT4 and MT5 setup' };
  return { label: platform || 'MetaTrader', folder: 'MQL4 or MQL5 → Experts', helper: 'MetaTrader setup' };
}

function formatPlatform(platform: string) {
  return platformDetails(platform).label;
}

function licenseTone(status: string) {
  if (status === 'active') return 'ready';
  if (['expired', 'revoked', 'suspended', 'disabled'].includes(status)) return 'attention';
  return 'pending';
}

function formatStatus(status: string) {
  if (!status) return 'Pending';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatVersion(version: string) {
  if (!version) return 'Release';
  return /^v/i.test(version) ? version : `v${version}`;
}

function formatDate(value: string) {
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';
  return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(parsed)} UTC`;
}
