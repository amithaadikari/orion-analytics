'use client';

import React, { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { recordAccountSecurityEvent, recordAdminAccountSecurityEvent } from '@/lib/account-security-client';

type Props = {
  factors: Array<{ id: string; label: string }>;
  next: string;
  signInPath: '/login' | '/client-login';
};

export default function MfaChallengeForm({ factors, next, signInPath }: Props) {
  const router = useRouter();
  const [factorId, setFactorId] = useState(factors[0]?.id || '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanCode = code.replace(/\D/g, '').slice(0, 6);
    if (cleanCode.length !== 6) {
      setError('Enter the complete six-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: cleanCode });
    if (verifyError) {
      setError('That code is incorrect or has expired. Check your authenticator and try again.');
      setLoading(false);
      return;
    }
    setCode('');
    await (signInPath === '/login' ? recordAdminAccountSecurityEvent : recordAccountSecurityEvent)('session_started');
    router.replace(next);
    router.refresh();
  }

  async function restart() {
    await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
    router.replace(signInPath);
    router.refresh();
  }

  return (
    <form className="login-form orion-auth-form" onSubmit={submit} aria-busy={loading}>
      <div className="auth-plan-context" role="status">
        <span className="auth-plan-context-icon" aria-hidden="true"><ShieldCheck size={15} /></span>
        <span>Second factor</span>
        <strong>Authenticator protected</strong>
        <small>The code refreshes every 30 seconds.</small>
      </div>
      <label className="auth-field" htmlFor="mfa-code">
        <span className="auth-field-label">Six-digit authenticator code</span>
        <span className="auth-input-shell">
          <span className="auth-input-icon" aria-hidden="true">#</span>
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
          />
        </span>
      </label>
      {factors.length > 1 && <label className="auth-field" htmlFor="mfa-factor"><span className="auth-field-label">Authenticator</span><span className="auth-input-shell auth-select-shell"><span className="auth-input-icon" aria-hidden="true">◇</span><select id="mfa-factor" value={factorId} onChange={(event) => setFactorId(event.target.value)}>{factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.label}</option>)}</select></span></label>}
      <div className="auth-form-status" aria-live="polite">
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <button className="primary-button auth-submit" type="submit" disabled={loading}>
        <span>{loading ? 'Verifying…' : 'Verify & continue'}</span>
        <span className="auth-submit-icon" aria-hidden="true">→</span>
      </button>
      <div className="auth-link-row auth-form-links">
        <button type="button" className="auth-inline-button" disabled={loading} onClick={() => void restart()}>Use another account</button>
        <span>Lost your authenticator? Contact Orion support for identity-verified recovery.</span>
      </div>
    </form>
  );
}
