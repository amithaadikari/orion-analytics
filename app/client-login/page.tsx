import { Suspense } from 'react';
import ClientLoginForm from '@/components/client-login-form';
import AuthLayout from '@/components/auth-layout';

export default function ClientLoginPage() {
  return (
    <AuthLayout
      kind="client"
      mode="login"
      eyebrow="Secure client access"
      title="Your Orion workspace is ready."
      subtitle="Sign in to see your setup progress, licenses, downloads, payment records, notifications, and official support."
      footer="Your account only provides access to records assigned to your Orion client profile."
    >
      <Suspense fallback={<div className="auth-loading muted" role="status">Loading secure sign-in…</div>}>
        <ClientLoginForm />
      </Suspense>
    </AuthLayout>
  );
}
