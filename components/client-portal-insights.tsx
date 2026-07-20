import Link from 'next/link';
import React, { type CSSProperties } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Download,
  KeyRound,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';
import { activeLicensesForPlan, compatibleReleaseForPlan, effectiveLicenseStatus } from '@/lib/portal-activation';

type ClientFacts = {
  plan: string;
  status: string;
};

type LicenseFact = {
  id: string;
  plan: string;
  platform: string;
  status: string;
  expires_at?: string | null;
};

type PaymentFact = {
  id: string;
  plan: string;
  status: string;
  created_at?: string | null;
};

type ReleaseFact = {
  id: string;
  version: string;
  title: string;
  platform: string;
  download_url?: string | null;
};

type DownloadFact = {
  id: string;
  release_id?: string | null;
  version?: string | null;
  downloaded_at: string;
};

type ClientPortalInsightsProps = {
  client: ClientFacts;
  licenses: LicenseFact[];
  payments: PaymentFact[];
  releases: ReleaseFact[];
  downloads: DownloadFact[];
  recordsAvailable: boolean;
  downloadHistoryAvailable: boolean;
  planSelectionPath: string;
  showHeading?: boolean;
};

type JourneyState = 'complete' | 'current' | 'waiting' | 'attention' | 'unknown';

type JourneyStep = {
  label: string;
  detail: string;
  complete: boolean;
  attention: boolean;
  unknown?: boolean;
  icon: LucideIcon;
};

const confirmedPaymentStatuses = new Set(['paid', 'manually verified']);
const attentionPaymentStatuses = new Set(['failed', 'refunded', 'disputed']);

export default function ClientPortalInsights({
  client,
  licenses,
  payments,
  releases,
  downloads,
  recordsAvailable,
  downloadHistoryAvailable,
  planSelectionPath,
  showHeading = true,
}: ClientPortalInsightsProps) {
  if (!recordsAvailable) return <ActivationDataUnavailable embedded={!showHeading} />;

  const paidPlanAssigned = normalize(client.plan) !== 'free';
  const accountActive = normalize(client.status) === 'active';
  const accountNeedsAttention = ['expired', 'suspended'].includes(normalize(client.status));
  const currentPlanLicenses = licenses.filter((license) => normalize(license.plan) === normalize(client.plan));
  const activeLicenses = activeLicensesForPlan(client.plan, licenses);
  const licenseNeedsAttention = activeLicenses.length === 0 && currentPlanLicenses.some((license) => ['expired', 'suspended'].includes(effectiveLicenseStatus(license)));
  const latestRelevantPayment = paidPlanAssigned
    ? payments.find((payment) => normalize(payment.plan) === normalize(client.plan))
    : undefined;
  const paymentStatus = normalize(latestRelevantPayment?.status || '');
  const paymentVerified = paidPlanAssigned && confirmedPaymentStatuses.has(paymentStatus);
  const paymentAwaitingReview = paymentStatus === 'pending';
  const paymentNeedsAttention = attentionPaymentStatuses.has(paymentStatus);
  const downloadableRelease = accountActive ? compatibleReleaseForPlan(client.plan, licenses, releases) : undefined;
  const latestDownload = downloadableRelease
    ? downloads.find((download) => download.release_id === downloadableRelease.id)
    : undefined;
  const downloadStatusUnknown = Boolean(downloadableRelease) && !downloadHistoryAvailable;

  const steps: JourneyStep[] = [
    {
      label: 'Account created',
      detail: 'Your secure Orion client workspace is ready.',
      complete: true,
      attention: false,
      icon: UserRoundCheck,
    },
    {
      label: 'Payment verified',
      detail: paymentVerified
        ? `${client.plan} payment confirmed.`
        : !paidPlanAssigned
          ? 'Choose an Orion plan to continue.'
          : paymentAwaitingReview
            ? 'Your payment is awaiting Orion review.'
            : paymentNeedsAttention
              ? `Payment status: ${latestRelevantPayment?.status}.`
              : 'No verified payment is linked yet.',
      complete: paymentVerified,
      attention: paymentNeedsAttention,
      icon: BadgeCheck,
    },
    {
      label: 'Access approved',
      detail: accountActive ? 'Your client account is approved.' : `Account status: ${client.status}.`,
      complete: accountActive,
      attention: accountNeedsAttention,
      icon: ShieldCheck,
    },
    {
      label: 'License active',
      detail: activeLicenses.length > 0
        ? countLabel(activeLicenses.length, 'active license')
        : currentPlanLicenses.length > 0
          ? 'Your assigned license is not currently active.'
          : `No active license matches your ${client.plan} plan yet.`,
      complete: activeLicenses.length > 0,
      attention: licenseNeedsAttention,
      icon: KeyRound,
    },
    {
      label: 'EA download started',
      detail: downloadStatusUnknown
        ? 'Download activity is temporarily unavailable.'
        : latestDownload
          ? `${versionLabel(latestDownload.version)} requested ${formatDate(latestDownload.downloaded_at)}.`
          : downloadableRelease
            ? `${versionLabel(downloadableRelease.version)} is ready for secure download.`
            : accountActive && activeLicenses.length > 0
              ? 'No compatible release is available yet.'
              : 'Available after account and license activation.',
      complete: Boolean(latestDownload),
      attention: false,
      unknown: downloadStatusUnknown,
      icon: Download,
    },
  ];

  const firstIncompleteStep = steps.findIndex((step) => !step.complete);
  const firstAttentionStep = steps.findIndex((step) => step.attention);
  const currentStepIndex = firstAttentionStep >= 0 ? firstAttentionStep : firstIncompleteStep;
  const completedSteps = steps.filter((step) => step.complete).length;
  const progress = Math.round((completedSteps / steps.length) * 100);
  const readiness = readinessSummary({
    paidPlanAssigned,
    paymentVerified,
    paymentAwaitingReview,
    paymentNeedsAttention,
    accountActive,
    accountNeedsAttention,
    activeLicenses: activeLicenses.length,
    licenseNeedsAttention,
    hasDownload: Boolean(latestDownload),
    hasDownloadAvailable: Boolean(downloadableRelease),
    downloadHistoryAvailable,
  });
  const nextAction = activationAction({
    paidPlanAssigned,
    paymentVerified,
    paymentAwaitingReview,
    paymentNeedsAttention,
    accountActive,
    accountNeedsAttention,
    activeLicenses: activeLicenses.length,
    licenseNeedsAttention,
    hasDownload: Boolean(latestDownload),
    hasDownloadAvailable: Boolean(downloadableRelease),
    downloadHistoryAvailable,
    planSelectionPath,
  });

  return (
    <section className={`portal-activation-system${showHeading ? '' : ' portal-insights--embedded'}`} aria-labelledby="portal-activation-title">
      <div className="portal-activation-main">
        <header className="portal-activation-header">
          <div>
            <p className="eyebrow">Live activation journey</p>
            <h3 id="portal-activation-title">From account to Orion setup</h3>
            <p>{readiness.detail}</p>
          </div>
          <span className={`portal-activation-badge portal-activation-badge--${readiness.tone}`}>{readiness.label}</span>
        </header>

        <div className="portal-activation-progress">
          <div aria-hidden="true"><span style={{ '--portal-setup-progress': `${progress}%` } as CSSProperties} /></div>
          <p><strong>{completedSteps} of {steps.length}</strong> steps completed</p>
        </div>

        <ol className="portal-activation-steps">
          {steps.map((step, index) => {
            const state = journeyState(step.complete, step.attention, Boolean(step.unknown), index, currentStepIndex);
            const Icon = step.icon;
            return (
              <li className={`portal-activation-step portal-activation-step--${state}`} aria-current={index === currentStepIndex ? 'step' : undefined} key={step.label}>
                <div className="portal-activation-step-head">
                  <span className="portal-activation-step-marker" aria-hidden="true">{step.complete ? <BadgeCheck size={18} /> : <Icon size={18} />}</span>
                  <span className="portal-activation-step-state">{stateLabel(state)}</span>
                </div>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
              </li>
            );
          })}
        </ol>
      </div>

      <aside className={`portal-activation-action portal-activation-action--${nextAction.tone}`} aria-labelledby="portal-next-action-title">
        <span className="portal-activation-action-icon" aria-hidden="true">{nextAction.tone === 'attention' ? <CircleAlert size={22} /> : nextAction.tone === 'ready' ? <Rocket size={22} /> : <Sparkles size={22} />}</span>
        <p className="eyebrow">Recommended next action</p>
        <h4 id="portal-next-action-title">{nextAction.title}</h4>
        <p>{nextAction.detail}</p>
        <Link href={nextAction.href}>{nextAction.label}<ArrowRight size={15} aria-hidden="true" /></Link>
        <small>Need help? <a href="#support">Open official Orion support</a></small>
      </aside>
    </section>
  );
}

function ActivationDataUnavailable({ embedded }: { embedded: boolean }) {
  return (
    <section className={`portal-activation-system${embedded ? ' portal-insights--embedded' : ''}`} aria-labelledby="portal-activation-title">
      <div className="portal-activation-main">
        <header className="portal-activation-header">
          <div>
            <p className="eyebrow">Live activation journey</p>
            <h3 id="portal-activation-title">Status temporarily unavailable</h3>
            <p>Orion could not safely confirm all of your activation records. No account status has been guessed or changed.</p>
          </div>
          <span className="portal-activation-badge">Try again shortly</span>
        </header>
        <div className="portal-activation-unavailable" role="status">
          <span aria-hidden="true"><CircleAlert size={19} /></span>
          <p>Your account, payment, license, and download records will reappear automatically when the secure connection is restored.</p>
        </div>
      </div>
      <aside className="portal-activation-action" aria-labelledby="portal-next-action-title">
        <span className="portal-activation-action-icon" aria-hidden="true"><Sparkles size={22} /></span>
        <p className="eyebrow">Recommended next action</p>
        <h4 id="portal-next-action-title">Refresh your portal</h4>
        <p>Try loading this page again. If the status remains unavailable, Orion support can check it securely.</p>
        <Link href="/portal">Refresh activation status<ArrowRight size={15} aria-hidden="true" /></Link>
        <small>Need help? <a href="#support">Open official Orion support</a></small>
      </aside>
    </section>
  );
}

function journeyState(complete: boolean, attention: boolean, unknown: boolean, index: number, currentStepIndex: number): JourneyState {
  if (complete) return 'complete';
  if (unknown) return 'unknown';
  if (attention) return 'attention';
  return index === currentStepIndex ? 'current' : 'waiting';
}

function stateLabel(state: JourneyState) {
  if (state === 'complete') return 'Complete';
  if (state === 'current') return 'Next';
  if (state === 'attention') return 'Attention';
  if (state === 'unknown') return 'Unavailable';
  return 'Waiting';
}

function readinessSummary({ paidPlanAssigned, paymentVerified, paymentAwaitingReview, paymentNeedsAttention, accountActive, accountNeedsAttention, activeLicenses, licenseNeedsAttention, hasDownload, hasDownloadAvailable, downloadHistoryAvailable }: {
  paidPlanAssigned: boolean;
  paymentVerified: boolean;
  paymentAwaitingReview: boolean;
  paymentNeedsAttention: boolean;
  accountActive: boolean;
  accountNeedsAttention: boolean;
  activeLicenses: number;
  licenseNeedsAttention: boolean;
  hasDownload: boolean;
  hasDownloadAvailable: boolean;
  downloadHistoryAvailable: boolean;
}) {
  if (accountNeedsAttention || paymentNeedsAttention || licenseNeedsAttention) return { label: 'Needs attention', detail: 'One of your activation records needs attention before setup can continue.', tone: 'attention' as const };
  if (!paidPlanAssigned) return { label: 'Choose a plan', detail: 'Choose your Orion edition to begin the activation process.', tone: 'pending' as const };
  if (!paymentVerified) return { label: paymentAwaitingReview ? 'Verification pending' : 'Payment required', detail: paymentAwaitingReview ? 'Your payment is recorded and waiting for Orion verification.' : 'A verified payment is required before access can be approved.', tone: 'pending' as const };
  if (!accountActive) return { label: 'Approval pending', detail: 'Your payment is verified. Orion is preparing your client access.', tone: 'pending' as const };
  if (activeLicenses === 0) return { label: 'License pending', detail: 'Your account is approved and waiting for an active Orion license.', tone: 'pending' as const };
  if (!hasDownloadAvailable) return { label: 'Release pending', detail: 'Your access is ready, but no compatible Orion EA release is available yet.', tone: 'pending' as const };
  if (!downloadHistoryAvailable) return { label: 'Status unavailable', detail: 'Your EA is available, but previous download activity cannot be confirmed right now.', tone: 'pending' as const };
  if (!hasDownload) return { label: 'Ready to download', detail: 'Your licensed Orion EA is available for secure download.', tone: 'ready' as const };
  return { label: 'Download requested', detail: 'Your Orion EA download request is recorded. Finish installation and activation in your licensed MetaTrader platform.', tone: 'ready' as const };
}

function activationAction({ paidPlanAssigned, paymentVerified, paymentAwaitingReview, paymentNeedsAttention, accountActive, accountNeedsAttention, activeLicenses, licenseNeedsAttention, hasDownload, hasDownloadAvailable, downloadHistoryAvailable, planSelectionPath }: {
  paidPlanAssigned: boolean;
  paymentVerified: boolean;
  paymentAwaitingReview: boolean;
  paymentNeedsAttention: boolean;
  accountActive: boolean;
  accountNeedsAttention: boolean;
  activeLicenses: number;
  licenseNeedsAttention: boolean;
  hasDownload: boolean;
  hasDownloadAvailable: boolean;
  downloadHistoryAvailable: boolean;
  planSelectionPath: string;
}) {
  if (paymentNeedsAttention) return { title: 'Resolve your payment status', detail: 'Review the payment record and contact Orion if you need help correcting it.', label: 'View payment records', href: '#payments', tone: 'attention' as const };
  if (accountNeedsAttention) return { title: 'Restore account access', detail: 'Official Orion support can review the account restriction with you.', label: 'Contact Orion support', href: '#support', tone: 'attention' as const };
  if (licenseNeedsAttention) return { title: 'Review your license', detail: 'An assigned license has expired or is suspended and needs attention.', label: 'View license details', href: '#licenses', tone: 'attention' as const };
  if (!paidPlanAssigned) return { title: 'Choose your Orion plan', detail: 'Compare the available editions and confirm the plan that fits your account.', label: 'Review Orion plans', href: planSelectionPath, tone: 'pending' as const };
  if (!paymentVerified) return { title: paymentAwaitingReview ? 'Wait for verification' : 'Complete payment verification', detail: paymentAwaitingReview ? 'No action is required unless Orion asks for more information.' : 'Review your records or ask Orion for official payment instructions.', label: 'Check payment status', href: '#payments', tone: 'pending' as const };
  if (!accountActive) return { title: 'Account approval is in progress', detail: 'Your verified record is ready for Orion’s final account review.', label: 'View account status', href: '#support', tone: 'pending' as const };
  if (activeLicenses === 0) return { title: 'License assignment is next', detail: 'Your approved account is waiting for an active Orion license.', label: 'Check license status', href: '#licenses', tone: 'pending' as const };
  if (!hasDownloadAvailable) return { title: 'No compatible release yet', detail: 'Check your license platform or ask Orion when the matching EA release will be available.', label: 'Check software updates', href: '#downloads', tone: 'pending' as const };
  if (!downloadHistoryAvailable) return { title: 'Download status is unavailable', detail: 'You can still access your licensed software while Orion refreshes the activity record.', label: 'Open secure downloads', href: '#downloads', tone: 'pending' as const };
  if (!hasDownload) return { title: 'Download Orion EA', detail: 'Your license is active and the secure software download is ready.', label: 'Open secure downloads', href: '#downloads', tone: 'ready' as const };
  return { title: 'Continue setup in MetaTrader', detail: 'Confirm the EA file is on your device, then install it in your licensed platform, attach it to your chart, and verify the license.', label: 'Get activation support', href: '#support', tone: 'ready' as const };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function versionLabel(version?: string | null) {
  if (!version) return 'Orion EA';
  return /^v/i.test(version) ? version : `v${version}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
