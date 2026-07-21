import Link from 'next/link';
import CheckoutActions from '@/components/checkout-actions';
import RegistrationTracker from '@/components/registration-tracker';
import PortalTopbar from '@/components/portal-topbar';
import { requireClient } from '@/lib/auth';
import { checkoutPath, normalizePlan, planKeys, plans } from '@/lib/plans';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function CheckoutPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const queryPlan = normalizePlan(first(params.plan));
  const requestedPath = queryPlan ? checkoutPath(queryPlan) : '/checkout';
  const { user, client } = await requireClient(requestedPath);
  const selectedPlan = queryPlan || normalizePlan(user.user_metadata?.selected_plan);
  const plan = selectedPlan ? plans[selectedPlan] : null;

  return (
    <main className="portal-shell checkout-shell">
      <a className="portal-skip-link" href="#checkout-content">Skip to order review</a>
      <PortalTopbar clientName={client.full_name} />

      <section className="checkout-content" id="checkout-content" aria-labelledby="checkout-title">
        <div className="checkout-heading">
          <div className="checkout-heading-copy">
            <p className="eyebrow">Orion V5 / Secure purchase handoff</p>
            <h1 id="checkout-title">{plan ? `Review Orion ${plan.name}.` : 'Choose your Orion edition.'}</h1>
            <p>{plan ? 'Confirm the edition and price before requesting official payment instructions.' : 'Compare the available editions, then review your choice before contacting Orion.'}</p>
          </div>
          <div className="checkout-step" aria-current="step" aria-label="Step 1 of 2: Review">
            <span aria-hidden="true">01</span>
            <span><small>Step 1 of 2</small><strong>Review</strong></span>
          </div>
        </div>

        {!plan ? (
          <div className="checkout-plan-grid">
            {planKeys.map((key) => {
              const option = plans[key];
              const titleId = `checkout-plan-${key}`;
              const descriptionId = `${titleId}-description`;
              return (
                <article className={`checkout-plan-card checkout-plan-${key} ${key === 'premium' ? 'featured' : ''}`} key={key} aria-labelledby={titleId} aria-describedby={descriptionId}>
                  {key === 'premium' && <span className="checkout-recommended">Most popular</span>}
                  <p className="eyebrow">Orion V5</p>
                  <h2 id={titleId}>{option.name}</h2>
                  <strong>{option.priceLabel}<small> USD</small></strong>
                  <span>{option.license}</span>
                  <p id={descriptionId}>{option.description}</p>
                  <ul aria-label={`${option.name} highlights`}>{option.highlights.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul>
                  <Link className="checkout-select" href={checkoutPath(key)} aria-label={`Review Orion ${option.name} for ${option.priceLabel} USD`}>Review {option.name}<span aria-hidden="true">→</span></Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="checkout-layout">
            <section className={`checkout-review-card checkout-review-${selectedPlan}`} aria-labelledby="checkout-product-title">
              <div className="checkout-product-head">
                <div><span className="checkout-product-mark" aria-hidden="true"><i>◌</i><b>✦</b></span><div><small>ORION V5 EDITION</small><h2 id="checkout-product-title">{plan.name}</h2></div></div>
                <strong>{plan.priceLabel}<small> USD</small></strong>
              </div>
              <p className="checkout-description">{plan.description}</p>
              <div className="checkout-includes" role="region" aria-labelledby="checkout-includes-title">
                <p className="eyebrow" id="checkout-includes-title">What is included</p>
                <ul>{plan.highlights.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul>
                <ul><li><span aria-hidden="true">✓</span>1 registered MT5 real account</li><li><span aria-hidden="true">✓</span>1 registered Demo identity per license</li><li><span aria-hidden="true">✓</span>1 transferable installation seat</li><li><span aria-hidden="true">✓</span>{plan.license}</li></ul>
              </div>
              <nav className="checkout-change" aria-label="Choose a different Orion edition">
                <span>Need a different edition?</span>
                <div>{planKeys.filter((key) => key !== selectedPlan).map((key) => <Link key={key} href={checkoutPath(key)}>{plans[key].name}</Link>)}</div>
              </nav>
            </section>

            <aside className="checkout-summary" aria-labelledby="checkout-summary-title">
              <p className="eyebrow">Order summary</p>
              <h2 id="checkout-summary-title">Review total</h2>
              <dl>
                <div><dt>Edition</dt><dd>Orion V5 {plan.name}</dd></div>
                <div><dt>License term</dt><dd>{plan.license.replace(' license', '')}</dd></div>
                <div><dt>Subtotal</dt><dd>{plan.priceLabel} USD</dd></div>
                <div className="checkout-total"><dt>Total</dt><dd>{plan.priceLabel} USD</dd></div>
              </dl>
              <div className="checkout-safe-note" role="note"><span aria-hidden="true">◇</span><p><strong>No payment is taken on this page.</strong> Orion support will confirm the official payment details with you directly.</p></div>
              <a className="checkout-contact" href="https://t.me/authenticacademy" target="_blank" rel="noopener noreferrer" aria-label="Request official payment instructions from Orion support on Telegram">Request payment instructions<span aria-hidden="true">↗</span></a>
              <p className="checkout-fine-print">Payment does not guarantee trading results. Your license is issued only after payment is verified. Trading involves risk and losses are possible.</p>
              <Link className="checkout-back" href="/portal">← Return to client portal</Link>
            </aside>
          </div>
        )}
      </section>
      {user.user_metadata?.registration_source === 'orion_client_portal' && <RegistrationTracker plan={selectedPlan} />}
      {selectedPlan && <CheckoutActions plan={selectedPlan} />}
    </main>
  );
}
