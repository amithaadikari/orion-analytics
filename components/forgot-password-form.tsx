'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    await createSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="auth-message auth-confirmation" role="status" aria-live="polite">
        <span className="auth-confirmation-icon" aria-hidden="true">✓</span>
        <strong>Check your email</strong>
        <p>If an Orion account exists for that address, Supabase has sent a secure password-reset link.</p>
        <Link href="/client-login">Return to sign in <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  return (
    <form className="login-form orion-auth-form" onSubmit={submit} aria-busy={loading}>
      <label className="auth-field" htmlFor="recovery-email">
        <span className="auth-field-label">Client email</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">@</span>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </span>
      </label>
      <button className="primary-button auth-submit" type="submit" disabled={loading}>
        <span>{loading ? 'Sending…' : 'Send reset link'}</span>
        <span className="auth-submit-icon" aria-hidden="true">↗</span>
      </button>
      <div className="auth-form-link auth-form-backlink">
        <Link href="/client-login"><span aria-hidden="true">←</span> Back to client login</Link>
      </div>
    </form>
  );
}
