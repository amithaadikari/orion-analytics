'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setError('Email or password is incorrect.');
      setLoading(false);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <form className="login-form orion-auth-form" onSubmit={submit} aria-busy={loading}>
      <label className="auth-field" htmlFor="admin-email">
        <span className="auth-field-label">Email address</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">@</span>
          <input
            id="admin-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </span>
      </label>
      <label className="auth-field" htmlFor="admin-password">
        <span className="auth-field-label">Password</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">⌁</span>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </span>
      </label>
      <div className="auth-form-status" aria-live="polite">
        {params.get('error') === 'not-approved' && <p className="form-error" role="alert">Your account is not on the approved admin list.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="primary-button auth-submit" type="submit" disabled={loading}>
        <span>{loading ? 'Signing in…' : 'Sign in securely'}</span>
        <span className="auth-submit-icon" aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
