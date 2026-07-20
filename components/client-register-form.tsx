'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { countryFlag, countryOptions } from '@/lib/country';
import { checkoutPath, normalizeTrackingId, type PlanKey } from '@/lib/plans';
import { primeTrackingContext, trackFunnelEvent } from '@/lib/client-tracking';
import PasswordField from '@/components/password-field';

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
  const selectedPlan = initialPlan;
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);
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
      <div className="auth-message auth-confirmation registration-confirmation" role="status" aria-live="polite">
        <span className="auth-confirmation-icon" aria-hidden="true">✓</span>
        <strong>Confirm your email</strong>
        <p>We sent a secure confirmation link to {email}. Open it to activate your Orion account and continue securely.</p>
        <Link href={authLink('/client-login', selectedPlan, next)}>Return to sign in <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  return (
    <form className="login-form register-form orion-auth-form" onSubmit={submit} onFocusCapture={markStarted} aria-busy={loading}>
        <label className="auth-field" htmlFor="register-name">
          <span className="auth-field-label">Full name</span>
          <span className="auth-input-shell">
            <span className="auth-input-icon" aria-hidden="true">◎</span>
            <input
              id="register-name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </span>
        </label>
        <label className="auth-field" htmlFor="register-email">
          <span className="auth-field-label">Email address</span>
          <span className="auth-input-shell">
            <span className="auth-input-icon" aria-hidden="true">@</span>
            <input
              id="register-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </span>
        </label>
        <label className="wide auth-field" htmlFor="register-country">
          <span className="auth-field-label">Country</span>
          <span className="auth-input-shell auth-select-shell">
            <span className="auth-input-icon" aria-hidden="true">◇</span>
            <select id="register-country" required autoComplete="country-name" value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="" disabled>Select your country</option>
              {countryOptions.map(({ code, name }) => <option key={code} value={name}>{countryFlag(code)} {name}</option>)}
            </select>
          </span>
        </label>
        <PasswordField id="register-password" label="Password" autoComplete="new-password" minLength={10} value={password} showStrength onChange={(event) => setPassword(event.target.value)} />
        <PasswordField id="register-confirm-password" label="Confirm password" autoComplete="new-password" minLength={10} value={confirm} matchValue={password} onChange={(event) => setConfirm(event.target.value)} />
        <p className="registration-notice auth-notice"><span aria-hidden="true">◇</span>Registration creates your secure client account only. Package review and payment happen separately after sign-in.</p>
        <div className="auth-form-status" aria-live="polite">
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <button className="primary-button auth-submit" type="submit" disabled={loading}>
          <span>{loading ? 'Creating account…' : 'Create secure account'}</span>
          <span className="auth-submit-icon" aria-hidden="true">↗</span>
        </button>
        <div className="auth-form-link auth-form-backlink"><Link href={authLink('/client-login', selectedPlan, next)}>Already registered? Sign in <span aria-hidden="true">→</span></Link></div>
    </form>
  );
}
