'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 10) {
      setError('Use at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError('This reset link is invalid or expired. Request a new one.');
      setLoading(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace('/client-login?reset=success');
    router.refresh();
  }

  return (
    <form className="login-form orion-auth-form" onSubmit={submit} aria-busy={loading}>
      <label className="auth-field" htmlFor="new-password">
        <span className="auth-field-label">New password</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">⌁</span>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </span>
      </label>
      <label className="auth-field" htmlFor="confirm-password">
        <span className="auth-field-label">Confirm password</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">⌁</span>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </span>
      </label>
      <div className="auth-password-hint"><span aria-hidden="true">◇</span> At least 10 characters</div>
      <div className="auth-form-status" aria-live="polite">
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="primary-button auth-submit" type="submit" disabled={loading}>
        <span>{loading ? 'Updating…' : 'Update password'}</span>
        <span className="auth-submit-icon" aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
