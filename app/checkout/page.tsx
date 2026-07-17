import Link from 'next/link';
import CheckoutActions from '@/components/checkout-actions';
import RegistrationTracker from '@/components/registration-tracker';
import LogoutButton from '@/components/logout-button';
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
      <header className="portal-topbar">
        <Link className="brand" href="/portal"><span className="brand-mark">✦</span><span>ORION <em>CLIENT</em></span></Link>
        <div><span className="portal-user">{client.full_name}</span><LogoutButton redirectTo="/client-login" /></div>
      </header>

      <section className="checkout-content">
        <div className="checkout-heading">
          <div>
            <p className="eyebrow">Secure purchase handoff</p>
            <h1>{plan ? `Review Orion ${plan.name}.` : 'Choose your Orion edition.'}</h1>
            <p>{plan ? 'Confirm the edition and price before requesting official payment instructions.' : 'Compare the available editions, then review your choice before contacting Orion.'}</p>
          </div>
          <span className="checkout-step">Step 1 of 2 · Review</span>
        </div>

        {!plan ? (
          <div className="checkout-plan-grid">
            {planKeys.map((key) => {
              const option = plans[key];
              return (
                <article className={key === 'premium' ? 'featured' : ''} key={key}>
                  {key === 'premium' && <span className="checkout-recommended">Most popular</span>}
                  <p className="eyebrow">Orion V5</p>
                  <h2>{option.name}</h2>
                  <strong>{option.priceLabel}<small> USD</small></strong>
                  <span>{option.license}</span>
                  <p>{option.description}</p>
                  <ul>{option.highlights.map((item) => <li key={item}>✓ {item}</li>)}</ul>
                  <Link className="checkout-select" href={checkoutPath(key)}>Review {option.name}<span>→</span></Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="checkout-layout">
            <section className="checkout-review-card">
              <div className="checkout-product-head">
                <div><span className="checkout-product-mark">✦</span><div><small>ORION V5 EDITION</small><h2>{plan.name}</h2></div></div>
                <strong>{plan.priceLabel}<small> USD</small></strong>
              </div>
              <p className="checkout-description">{plan.description}</p>
              <div className="checkout-includes">
                <p className="eyebrow">What is included</p>
                <ul>{plan.highlights.map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul>
                <ul><li><span>✓</span>1 registered MT5 live account</li><li><span>✓</span>Unlimited demo accounts</li><li><span>✓</span>{plan.license}</li></ul>
              </div>
              <div className="checkout-change">
                <span>Need a different edition?</span>
                <div>{planKeys.filter((key) => key !== selectedPlan).map((key) => <Link key={key} href={checkoutPath(key)}>{plans[key].name}</Link>)}</div>
              </div>
            </section>

            <aside className="checkout-summary">
              <p className="eyebrow">Order summary</p>
              <h2>Review total</h2>
              <dl>
                <div><dt>Edition</dt><dd>Orion V5 {plan.name}</dd></div>
                <div><dt>License term</dt><dd>{plan.license.replace(' license', '')}</dd></div>
                <div><dt>Subtotal</dt><dd>{plan.priceLabel} USD</dd></div>
                <div className="checkout-total"><dt>Total</dt><dd>{plan.priceLabel} USD</dd></div>
              </dl>
              <div className="checkout-safe-note"><span>◇</span><p><strong>No payment is taken on this page.</strong> Orion support will confirm the official payment details with you directly.</p></div>
              <a className="checkout-contact" href="https://t.me/authenticacademy" target="_blank" rel="noopener noreferrer">Request payment instructions<span>↗</span></a>
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
