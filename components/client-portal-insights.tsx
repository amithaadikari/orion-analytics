type ClientFacts = {
  plan: string;
  status: string;
};

type LicenseFact = {
  id: string;
  status: string;
  expires_at?: string | null;
};

type PaymentFact = {
  id: string;
  plan: string;
  method: string;
  status: string;
  amount: number | string;
  currency: string;
  payment_date?: string | null;
};

type ClientPortalInsightsProps = {
  client: ClientFacts;
  licenses: LicenseFact[];
  payments: PaymentFact[];
};

type JourneyState = 'complete' | 'current' | 'waiting' | 'attention';

const confirmedPaymentStatuses = new Set(['paid', 'manually verified']);
const attentionPaymentStatuses = new Set(['failed', 'refunded', 'disputed']);

export default function ClientPortalInsights({ client, licenses, payments }: ClientPortalInsightsProps) {
  const effectiveLicenseStatuses = licenses.map(effectiveLicenseStatus);
  const licenseCounts = {
    active: effectiveLicenseStatuses.filter((status) => status === 'active').length,
    expired: effectiveLicenseStatuses.filter((status) => status === 'expired').length,
    suspended: effectiveLicenseStatuses.filter((status) => status === 'suspended').length,
    other: effectiveLicenseStatuses.filter((status) => !['active', 'expired', 'suspended'].includes(status)).length,
  };
  const normalizedPaymentStatuses = payments.map((payment) => normalize(payment.status));
  const confirmedPayments = normalizedPaymentStatuses.filter((status) => confirmedPaymentStatuses.has(status)).length;
  const hasPaymentAwaitingReview = normalizedPaymentStatuses.some((status) => status === 'pending');
  const hasPaymentNeedingAttention = normalizedPaymentStatuses.some((status) => attentionPaymentStatuses.has(status));
  const paidPlanAssigned = normalize(client.plan) !== 'free';
  const accountActive = normalize(client.status) === 'active';
  const accountNeedsAttention = ['expired', 'suspended'].includes(normalize(client.status));
  const licenseNeedsAttention = licenseCounts.active === 0 && (licenseCounts.expired > 0 || licenseCounts.suspended > 0);

  const journeyFacts = [
    {
      label: 'Plan assigned',
      complete: paidPlanAssigned,
      attention: false,
      detail: paidPlanAssigned ? `Orion ${client.plan} is assigned to this account.` : 'The current account plan is Free.',
    },
    {
      label: 'Payment recorded',
      complete: payments.length > 0,
      attention: false,
      detail: payments.length > 0 ? countLabel(payments.length, 'payment record') : 'No payment record is available yet.',
    },
    {
      label: 'Payment confirmed',
      complete: confirmedPayments > 0,
      attention: confirmedPayments === 0 && hasPaymentNeedingAttention && !hasPaymentAwaitingReview,
      detail: confirmedPayments > 0
        ? `${countLabel(confirmedPayments, 'record')} marked Paid or Manually verified.`
        : hasPaymentAwaitingReview
          ? 'A payment record is awaiting review.'
          : hasPaymentNeedingAttention
            ? 'The latest payment records need attention.'
            : 'No confirmed payment record is available yet.',
    },
    {
      label: 'Account approved',
      complete: accountActive,
      attention: accountNeedsAttention,
      detail: `Current account status: ${client.status}.`,
    },
    {
      label: 'License active',
      complete: licenseCounts.active > 0,
      attention: licenseNeedsAttention,
      detail: licenseCounts.active > 0
        ? countLabel(licenseCounts.active, 'active license')
        : licenses.length > 0
          ? 'No assigned license is currently active.'
          : 'No license has been assigned yet.',
    },
  ];
  const firstIncompleteStep = journeyFacts.findIndex((fact) => !fact.complete);
  const readiness = readinessSummary({
    clientStatus: client.status,
    paidPlanAssigned,
    paymentCount: payments.length,
    confirmedPayments,
    activeLicenses: licenseCounts.active,
    accountActive,
    accountNeedsAttention,
    licenseNeedsAttention,
  });

  return (
    <section className="portal-insights" aria-labelledby="portal-insights-title">
      <header className="portal-insights-heading">
        <div>
          <p className="eyebrow">Live workspace facts</p>
          <h2 id="portal-insights-title">Activation and account activity</h2>
        </div>
        <p>Based only on the plan, account, license, and payment records in your secure workspace.</p>
      </header>

      <div className="portal-insights-grid">
        <article className="portal-insight-card portal-insight-card--journey" aria-labelledby="portal-readiness-title">
          <header className="portal-insight-card-heading">
            <div>
              <p className="eyebrow">Activation readiness</p>
              <h3 id="portal-readiness-title">Your access journey</h3>
            </div>
            <span className={`portal-readiness-badge portal-readiness-badge--${readiness.tone}`}>{readiness.label}</span>
          </header>
          <p className="portal-readiness-summary">{readiness.detail}</p>
          <ol className="portal-readiness-journey">
            {journeyFacts.map((fact, index) => {
              const state = journeyState(fact.complete, fact.attention, index, firstIncompleteStep);
              return (
                <li className={`portal-readiness-step portal-readiness-step--${state}`} aria-current={index === firstIncompleteStep ? 'step' : undefined} key={fact.label}>
                  <span className="portal-readiness-step-marker" aria-hidden="true">{fact.complete ? '✓' : String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{fact.label}</strong>
                    <p>{fact.detail}</p>
                  </div>
                  <span className="portal-readiness-step-state">{stateLabel(state)}</span>
                </li>
              );
            })}
          </ol>
        </article>

        <article className="portal-insight-card portal-insight-card--licenses" aria-labelledby="portal-license-distribution-title">
          <header className="portal-insight-card-heading">
            <div>
              <p className="eyebrow">License facts</p>
              <h3 id="portal-license-distribution-title">Status distribution</h3>
            </div>
            <strong className="portal-insight-total" aria-label={`${licenses.length} assigned licenses`}>{licenses.length}</strong>
          </header>
          {licenses.length > 0 ? (
            <ul className="portal-license-distribution" aria-label={`${licenses.length} assigned licenses by current status`}>
              <LicenseDistributionRow label="Active" count={licenseCounts.active} total={licenses.length} tone="active" />
              <LicenseDistributionRow label="Expired" count={licenseCounts.expired} total={licenses.length} tone="expired" />
              <LicenseDistributionRow label="Suspended" count={licenseCounts.suspended} total={licenses.length} tone="suspended" />
              {licenseCounts.other > 0 && <LicenseDistributionRow label="Other" count={licenseCounts.other} total={licenses.length} tone="other" />}
            </ul>
          ) : (
            <p className="portal-insight-empty">License status information will appear after a license is assigned.</p>
          )}
        </article>

        <PaymentActivity payments={payments} />
      </div>
    </section>
  );
}

function LicenseDistributionRow({ label, count, total, tone }: { label: string; count: number; total: number; tone: string }) {
  return (
    <li className={`portal-license-distribution-item portal-license-distribution-item--${tone}`}>
      <div><span>{label}</span><strong>{count}</strong></div>
      <meter className="portal-license-distribution-meter" min={0} max={Math.max(total, 1)} value={count} aria-label={`${count} of ${total} licenses are ${label.toLowerCase()}`}>{count} of {total}</meter>
    </li>
  );
}

function PaymentActivity({ payments }: { payments: PaymentFact[] }) {
  const recentPayments = payments.slice(0, 6).map((payment) => ({
    ...payment,
    numericAmount: finiteAmount(payment.amount),
    normalizedCurrency: currencyLabel(payment.currency),
  }));
  const currencyMaximums = recentPayments.reduce<Record<string, number>>((maximums, payment) => {
    maximums[payment.normalizedCurrency] = Math.max(maximums[payment.normalizedCurrency] || 0, payment.numericAmount);
    return maximums;
  }, {});

  return (
    <article className="portal-insight-card portal-insight-card--payments" aria-labelledby="portal-payment-activity-title">
      <header className="portal-insight-card-heading">
        <div>
          <p className="eyebrow">Recent records</p>
          <h3 id="portal-payment-activity-title">Payment activity</h3>
        </div>
        <strong className="portal-insight-total" aria-label={`${payments.length} recorded payments`}>{payments.length}</strong>
      </header>
      <p className="portal-payment-activity-note" id="portal-payment-activity-note">Each bar is one recorded payment and is scaled only against the recent entries in the same currency. It does not represent trading performance.</p>
      {recentPayments.length > 0 ? (
        <ol className="portal-payment-activity" aria-describedby="portal-payment-activity-note">
          {recentPayments.map((payment) => {
            const date = paymentDate(payment.payment_date);
            const status = normalize(payment.status).replace(/[^a-z0-9]+/g, '-');
            return (
              <li className={`portal-payment-activity-item portal-payment-activity-item--${status}`} key={payment.id}>
                <div className="portal-payment-activity-labels">
                  <div>
                    {date ? <time dateTime={date.dateTime}>{date.label}</time> : <span>Date not recorded</span>}
                    <small>{payment.plan} · {payment.method}</small>
                  </div>
                  <div>
                    <strong>{payment.normalizedCurrency} {formatNumber(payment.numericAmount)}</strong>
                    <span className={`payment-status ${status}`}>{payment.status}</span>
                  </div>
                </div>
                <meter
                  className="portal-payment-activity-meter"
                  min={0}
                  max={Math.max(currencyMaximums[payment.normalizedCurrency], 1)}
                  value={payment.numericAmount}
                  aria-label={`${payment.normalizedCurrency} ${formatNumber(payment.numericAmount)}, compared only with recent ${payment.normalizedCurrency} payment records`}
                >
                  {payment.normalizedCurrency} {formatNumber(payment.numericAmount)}
                </meter>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="portal-insight-empty">Recent payment activity will appear after a payment is recorded.</p>
      )}
    </article>
  );
}

function journeyState(complete: boolean, attention: boolean, index: number, firstIncompleteStep: number): JourneyState {
  if (complete) return 'complete';
  if (attention) return 'attention';
  return index === firstIncompleteStep ? 'current' : 'waiting';
}

function stateLabel(state: JourneyState) {
  if (state === 'complete') return 'Complete';
  if (state === 'current') return 'Next step';
  if (state === 'attention') return 'Needs attention';
  return 'Waiting';
}

function readinessSummary({ clientStatus, paidPlanAssigned, paymentCount, confirmedPayments, activeLicenses, accountActive, accountNeedsAttention, licenseNeedsAttention }: {
  clientStatus: string;
  paidPlanAssigned: boolean;
  paymentCount: number;
  confirmedPayments: number;
  activeLicenses: number;
  accountActive: boolean;
  accountNeedsAttention: boolean;
  licenseNeedsAttention: boolean;
}) {
  if (accountNeedsAttention) return { label: 'Needs attention', detail: `Your account status is ${clientStatus}. Review your records or contact Orion support.`, tone: 'attention' };
  if (!paidPlanAssigned) return { label: 'Choose a plan', detail: 'Choose an Orion edition to begin the paid activation path.', tone: 'pending' };
  if (paymentCount === 0) return { label: 'Payment not recorded', detail: 'No payment record is currently linked to this account.', tone: 'pending' };
  if (confirmedPayments === 0) return { label: 'Verification pending', detail: 'A confirmed payment record is required before activation can be completed.', tone: 'pending' };
  if (!accountActive) return { label: 'Approval pending', detail: `Your payment record is confirmed and the account status is ${clientStatus}.`, tone: 'pending' };
  if (licenseNeedsAttention) return { label: 'License attention', detail: 'Assigned licenses are present, but none is currently active.', tone: 'attention' };
  if (activeLicenses === 0) return { label: 'License pending', detail: 'Your account is active and is waiting for an active license assignment.', tone: 'pending' };
  return { label: 'Access ready', detail: `${countLabel(activeLicenses, 'active license')} available on an active account.`, tone: 'ready' };
}

function effectiveLicenseStatus(license: LicenseFact) {
  if (license.expires_at) {
    const expiry = Date.parse(`${license.expires_at.slice(0, 10)}T23:59:59.999Z`);
    if (Number.isFinite(expiry) && expiry < Date.now()) return 'expired';
  }
  return normalize(license.status);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function finiteAmount(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function currencyLabel(value: string) {
  const label = value.trim().toUpperCase();
  return label || 'Currency not set';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function paymentDate(value?: string | null) {
  if (!value) return null;
  const dateTime = value.slice(0, 10);
  const date = new Date(`${dateTime}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return { dateTime, label: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date) };
}
