'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) { setError('Email or password is incorrect.'); setLoading(false); return; }
    router.replace('/dashboard'); router.refresh();
  }
  return <form className="login-form" onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{params.get('error') === 'not-approved' && <p className="form-error">Your account is not on the approved admin list.</p>}{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : 'Sign in securely'}<span>↗</span></button></form>;
}
