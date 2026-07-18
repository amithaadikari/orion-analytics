import { Suspense } from 'react';
import LoginForm from '@/components/login-form';
import AuthLayout from '@/components/auth-layout';

export default function LoginPage() {
  return (
    <AuthLayout
      kind="admin"
      eyebrow="Private workspace"
      title="Welcome back to Orion."
      subtitle="Sign in to review acquisition, customer operations and conversion performance."
      footer="Approved Orion administrators only. Visitor data is anonymous and access is protected by Supabase Auth."
    >
      <Suspense fallback={<div className="auth-loading muted" role="status">Loading secure sign-in…</div>}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
