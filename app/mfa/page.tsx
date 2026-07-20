import { redirect } from 'next/navigation';
import AuthLayout from '@/components/auth-layout';
import MfaChallengeForm from '@/components/mfa-challenge-form';
import { getAuthAssurance } from '@/lib/auth-assurance';
import { safeMfaNext } from '@/lib/plans';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function MfaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedNext = first(params.next);
  const next = safeMfaNext(requestedNext, requestedNext === '/dashboard' ? '/dashboard' : '/portal');
  const adminJourney = next.startsWith('/dashboard');
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const signInPath = adminJourney ? '/login' : '/client-login';
    redirect(`${signInPath}?next=${encodeURIComponent(next)}`);
  }

  const assurance = await getAuthAssurance(supabase, user);
  if (!assurance.requiresChallenge) redirect(next);
  const factors = (user.factors || [])
    .filter((entry) => entry.factor_type === 'totp' && entry.status === 'verified')
    .map((entry, index) => ({ id: entry.id, label: entry.friendly_name || `Authenticator ${index + 1}` }));
  if (!factors.length) redirect(`${adminJourney ? '/login' : '/client-login'}?error=mfa-unavailable`);

  return (
    <AuthLayout
      kind={adminJourney ? 'admin' : 'client'}
      mode="login"
      eyebrow="Identity verification"
      title="Confirm it’s really you."
      subtitle="Enter the six-digit code from your authenticator app to finish this protected sign-in."
      footer="Your one-time code is verified directly by Supabase and is never stored by Orion."
    >
      <MfaChallengeForm factors={factors} next={next} signInPath={adminJourney ? '/login' : '/client-login'} />
    </AuthLayout>
  );
}
