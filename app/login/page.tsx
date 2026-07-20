import { Suspense } from 'react';
import LoginForm from '@/components/login-form';
import AuthLayout from '@/components/auth-layout';

export default function LoginPage() {
  return (
    <AuthLayout
      kind="admin"
      mode="login"
      eyebrow="Administrator access"
      title="Enter the Orion command center."
      subtitle="Sign in through the protected administrator route to review live performance and manage Orion operations."
      footer="Approved Orion administrators only. Visitor data is anonymous and access is protected by Supabase Auth."
    >
      <Suspense fallback={<div className="auth-loading muted" role="status">Loading secure sign-in…</div>}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
