import ForgotPasswordForm from '@/components/forgot-password-form';
import AuthLayout from '@/components/auth-layout';

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      kind="client"
      eyebrow="Account recovery"
      title="Recover your access."
      subtitle="Enter the email connected to your Orion client account and we will send a secure reset link."
      footer="For your security, the page shows the same confirmation whether or not an account exists."
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
