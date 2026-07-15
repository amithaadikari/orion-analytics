import { Suspense } from 'react';
import LoginForm from '@/components/login-form';

export default function LoginPage() {
  return <main className="auth-shell"><div className="auth-card"><div className="brand"><span className="brand-mark">✦</span><span>ORION <em>ANALYTICS</em></span></div><p className="eyebrow">Private workspace</p><h1>See what turns attention into action.</h1><p className="auth-subtitle">Sign in to review anonymous landing-page activity, campaign performance and Telegram clicks.</p><Suspense fallback={<div className="muted">Loading secure sign-in…</div>}><LoginForm /></Suspense><p className="legal-note">Approved Orion administrators only. Visitor data is anonymous and access is protected by Supabase Auth.</p></div></main>;
}
