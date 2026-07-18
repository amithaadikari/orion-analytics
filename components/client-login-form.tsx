'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import Link from 'next/link';
import { checkoutPath, normalizePlan, planFromPath, safeAuthNext } from '@/lib/plans';

export default function ClientLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const directPlan = normalizePlan(params.get('plan'));
  const fallback = checkoutPath(directPlan);
  const next = safeAuthNext(params.get('next'), fallback);
  const selectedPlan = directPlan || planFromPath(next);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const registerParams = new URLSearchParams({ next });
  if (selectedPlan) registerParams.set('plan', selectedPlan);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createSupabaseBrowserClient();
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setError('Email or password is incorrect.');
      setLoading(false);
      return;
    }
    if (selectedPlan) {
      await supabase.auth.updateUser({ data: { selected_plan: selectedPlan } });
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form className="login-form orion-auth-form" onSubmit={submit} aria-busy={loading}>
      {selectedPlan && (
        <div className="login-plan-context auth-plan-context">
          <span className="auth-plan-context-icon" aria-hidden="true">✦</span>
          <span>Selected edition</span>
          <strong>{selectedPlan[0].toUpperCase() + selectedPlan.slice(1)}</strong>
          <small>Continue to order review after sign-in</small>
        </div>
      )}
      <label className="auth-field" htmlFor="client-email">
        <span className="auth-field-label">Email address</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">@</span>
          <input
            id="client-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </span>
      </label>
      <label className="auth-field" htmlFor="client-password">
        <span className="auth-field-label">Password</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">⌁</span>
          <input
            id="client-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </span>
      </label>
      <div className="auth-link-row auth-form-links">
        <Link href={`/client-register?${registerParams}`}>Create account</Link>
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
      <div className="auth-form-status" aria-live="polite">
        {params.get('error') === 'not-linked' && <p className="form-error" role="alert">Your account is not linked to an Orion client profile. Contact support.</p>}
        {params.get('reset') === 'success' && <p className="form-success" role="status">Password updated. Sign in with your new password.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="primary-button auth-submit" type="submit" disabled={loading}>
        <span>{loading ? 'Signing in…' : selectedPlan ? 'Sign in & review order' : 'Open client portal'}</span>
        <span className="auth-submit-icon" aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
