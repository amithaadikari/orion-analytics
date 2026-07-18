import { Suspense } from 'react';
import ClientLoginForm from '@/components/client-login-form';
import AuthLayout from '@/components/auth-layout';

export default function ClientLoginPage() {
  return (
    <AuthLayout
      kind="client"
      eyebrow="Secure client portal"
      title="Welcome back."
      subtitle="Open your private workspace to manage your Orion license, account status, updates and support."
      footer="Your account only provides access to records assigned to your Orion client profile."
    >
      <Suspense fallback={<div className="auth-loading muted" role="status">Loading secure sign-in…</div>}>
        <ClientLoginForm />
      </Suspense>
    </AuthLayout>
  );
}
