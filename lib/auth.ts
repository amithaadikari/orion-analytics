import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeAuthNext } from '@/lib/plans';
import { getAuthAssurance } from '@/lib/auth-assurance';

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const assurance = await getAuthAssurance(supabase, user);
  if (assurance.requiresChallenge) redirect('/mfa?next=%2Fdashboard');
  const { data: admin } = await supabase.from('admins').select('id, role, email').eq('user_id', user.id).maybeSingle();
  if (!admin || !['admin', 'analyst'].includes(admin.role)) redirect('/login?error=not-approved');
  return { supabase, user, admin };
}

export async function requireAdminApi() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, admin: null, mfaRequired: false };
  const assurance = await getAuthAssurance(supabase, user);
  if (assurance.requiresChallenge) return { supabase, user, admin: null, mfaRequired: true };
  const { data: admin } = await supabase.from('admins').select('id, role, email').eq('user_id', user.id).maybeSingle();
  return { supabase, user, admin: admin && ['admin', 'analyst'].includes(admin.role) ? admin : null, mfaRequired: false };
}

export async function requireClient(nextPath = '/portal') {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const next = safeAuthNext(nextPath, '/portal');
  if (!user) redirect(`/client-login?next=${encodeURIComponent(next)}`);
  const assurance = await getAuthAssurance(supabase, user);
  if (assurance.requiresChallenge) redirect(`/mfa?next=${encodeURIComponent(next)}`);
  const { data: client } = await supabase.from('clients').select('id,full_name,email,telegram_username,phone,country,plan,status,created_at').eq('auth_user_id', user.id).maybeSingle();
  if (!client) redirect('/client-login?error=not-linked');
  return { supabase, user, client };
}
