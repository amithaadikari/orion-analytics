import ClientRegisterForm from '@/components/client-register-form';
import AuthLayout from '@/components/auth-layout';
import { normalizePlan, plans } from '@/lib/plans';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ClientRegisterPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedPlan = normalizePlan(first(params.plan));
  const plan = selectedPlan ? plans[selectedPlan] : null;

  return (
    <AuthLayout
      kind="client"
      wide
      mode="register"
      eyebrow="New client account"
      title="Create your secure Orion workspace."
      subtitle={plan
        ? `Your ${plan.name} selection stays attached through email confirmation, sign-in and final order review.`
        : 'Create your free account now. You can select an Orion edition before or after registration.'}
      footer="Registration does not activate a trading license. Paid access remains locked until Orion verifies payment and assigns the matching license."
    >
      <ClientRegisterForm initialPlan={selectedPlan} />
    </AuthLayout>
  );
}
