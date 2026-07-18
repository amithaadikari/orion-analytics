import ResetPasswordForm from '@/components/reset-password-form';
import AuthLayout from '@/components/auth-layout';

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      kind="client"
      eyebrow="Secure password update"
      title="Create a new password."
      subtitle="Choose a unique password with at least 10 characters to secure your Orion account."
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}
