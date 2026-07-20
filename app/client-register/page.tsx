import ClientRegisterForm from '@/components/client-register-form';
import AuthLayout from '@/components/auth-layout';
import { normalizePlan } from '@/lib/plans';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ClientRegisterPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedPlan = normalizePlan(first(params.plan));

  return (
    <AuthLayout
      kind="client"
      mode="register"
      eyebrow="New client account"
      title="Create your secure Orion workspace."
      subtitle="Create your account first. Package review and payment happen separately after secure sign-in."
      footer="Registration creates a client account only. It does not collect payment or activate a trading license."
    >
      <ClientRegisterForm initialPlan={selectedPlan} />
    </AuthLayout>
  );
}
