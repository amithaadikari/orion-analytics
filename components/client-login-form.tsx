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
    <form className="login-form" onSubmit={submit}>
      {selectedPlan && <div className="login-plan-context"><span>Selected edition</span><strong>{selectedPlan[0].toUpperCase() + selectedPlan.slice(1)}</strong><small>Continue to order review after sign-in</small></div>}
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <div className="auth-link-row"><Link href={`/client-register?${registerParams}`}>Create account</Link><Link href="/forgot-password">Forgot password?</Link></div>
      {params.get('error') === 'not-linked' && <p className="form-error">Your account is not linked to an Orion client profile. Contact support.</p>}
      {params.get('reset') === 'success' && <p className="form-success">Password updated. Sign in with your new password.</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : selectedPlan ? 'Sign in & review order' : 'Open client portal'}<span>↗</span></button>
    </form>
  );
}
