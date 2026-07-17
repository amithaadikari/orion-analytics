'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { countryFlag, countryOptions } from '@/lib/country';
import { checkoutPath, normalizeTrackingId, planKeys, plans, type PlanKey } from '@/lib/plans';
import { primeTrackingContext, trackFunnelEvent } from '@/lib/client-tracking';

type Props = {
  initialPlan: PlanKey | null;
};

function authLink(path: string, plan: PlanKey | null, next: string) {
  const params = new URLSearchParams({ next });
  if (plan) params.set('plan', plan);
  return `${path}?${params}`;
}

export default function ClientRegisterForm({ initialPlan }: Props) {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(initialPlan);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);
  const selected = selectedPlan ? plans[selectedPlan] : null;
  const next = checkoutPath(selectedPlan);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const sourceEventId = normalizeTrackingId(fragment.get('source_event_id'));
    primeTrackingContext({
      enabled: fragment.get('tracking') === 'enabled',
      visitorId: normalizeTrackingId(fragment.get('visitor_id')),
      sessionId: normalizeTrackingId(fragment.get('session_id')),
      fbp: fragment.get('fbp'),
      fbc: fragment.get('fbc'),
    });
    const cleanUrl = new URL(window.location.href);
    ['visitor_id', 'session_id', 'source_event_id', 'fbp', 'fbc', 'tracking_consent'].forEach((key) => cleanUrl.searchParams.delete(key));
    cleanUrl.hash = '';
    window.history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}`);
    if (initialPlan && !sourceEventId) void trackFunnelEvent('PlanSelected', initialPlan, {}, `orion_plan_selected_${initialPlan}`);
  }, [initialPlan]);

  function choosePlan(plan: PlanKey) {
    setSelectedPlan(plan);
    const params = new URLSearchParams(window.location.search);
    params.set('plan', plan);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    void trackFunnelEvent('PlanSelected', plan);
  }

  function markStarted() {
    if (started.current) return;
    started.current = true;
    void trackFunnelEvent('RegistrationStarted', selectedPlan, {}, 'orion_registration_started');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    markStarted();
    setError('');
    if (password.length < 10) {
      setError('Use at least 10 characters for your password.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next);
    const supabase = createSupabaseBrowserClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: callback.toString(),
        data: {
          full_name: fullName.trim(),
          country,
          selected_plan: selectedPlan,
          registration_source: 'orion_client_portal',
        },
      },
    });

    if (signUpError) {
      setError(/already|registered/i.test(signUpError.message)
        ? 'An account already exists for this email. Sign in or reset your password.'
        : signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      router.replace(next);
      router.refresh();
      return;
    }
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="auth-message registration-confirmation">
        <strong>Confirm your email</strong>
        <p>We sent a secure confirmation link to {email}. Open it to activate your free Orion account and continue to {selected ? `your ${selected.name} order review` : 'the client portal'}.</p>
        <Link href={authLink('/client-login', selectedPlan, next)}>Return to sign in</Link>
      </div>
    );
  }

  return (
    <div className="register-flow">
      <form className="login-form register-form" onSubmit={submit} onFocusCapture={markStarted}>
        <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="wide">Country<select required autoComplete="country-name" value={country} onChange={(event) => setCountry(event.target.value)}><option value="" disabled>Select your country</option>{countryOptions.map(({ code, name }) => <option key={code} value={name}>{countryFlag(code)} {name}</option>)}</select></label>
        <label>Password<input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<input type="password" required minLength={10} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <p className="registration-notice">Your account starts on the Free plan. Your selected paid edition is a purchase preference only until payment and the matching license are verified.</p>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={loading}>{loading ? 'Creating account…' : selected ? `Create account for ${selected.name}` : 'Create free Orion account'}<span>↗</span></button>
        <div className="auth-form-link"><Link href={authLink('/client-login', selectedPlan, next)}>Already registered? Sign in</Link></div>
      </form>

      <aside className="register-plan-panel" aria-labelledby="selected-plan-title">
        <p className="eyebrow">Your selected edition</p>
        <div className="register-plan-picker" role="radiogroup" aria-label="Choose an Orion edition">
          {planKeys.map((key) => (
            <button key={key} type="button" role="radio" aria-checked={selectedPlan === key} className={selectedPlan === key ? 'active' : ''} onClick={() => choosePlan(key)} disabled={loading}>
              <span>{plans[key].name}</span><strong>{plans[key].priceLabel}</strong>
            </button>
          ))}
        </div>
        {selected ? (
          <div className="register-plan-summary">
            <div><span><small>ORION V5</small><strong id="selected-plan-title">{selected.name}</strong></span><b>{selected.priceLabel}<small> USD</small></b></div>
            <p>{selected.description}</p>
            <ul>{selected.highlights.map((highlight) => <li key={highlight}>✓ {highlight}</li>)}</ul>
            <dl><div><dt>License</dt><dd>{selected.license}</dd></div><div><dt>Account access</dt><dd>1 registered MT5 live account</dd></div></dl>
          </div>
        ) : (
          <div className="register-plan-empty">
            <strong id="selected-plan-title">No paid edition selected</strong>
            <p>You can create a Free account now or choose an edition above. No payment is taken on this page.</p>
          </div>
        )}
        <p className="register-plan-security">No payment is collected during registration. You will review the edition and official payment guidance after signing in.</p>
      </aside>
    </div>
  );
}
