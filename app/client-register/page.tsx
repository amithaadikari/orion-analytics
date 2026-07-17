import ClientRegisterForm from '@/components/client-register-form';
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
    <main className="auth-shell client-auth register-shell">
      <div className="auth-card register-card">
        <div className="brand"><span className="brand-mark">✦</span><span>ORION <em>CLIENT</em></span></div>
        <p className="eyebrow">Create your account</p>
        <h1>Create your Orion account.</h1>
        <p className="auth-subtitle">
          {plan
            ? 'Your selected edition stays attached through email confirmation, sign-in, and the final order review.'
            : 'Create your free account now. You can select an Orion edition before or after registration.'}
        </p>
        <ClientRegisterForm
          initialPlan={selectedPlan}
        />
        <p className="legal-note">Registration does not activate a trading license. Paid access remains locked until Orion verifies payment and assigns the matching license.</p>
      </div>
    </main>
  );
}
