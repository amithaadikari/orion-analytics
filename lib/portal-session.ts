import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAuthAssurance } from '@/lib/auth-assurance';

export async function getPortalSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, admin: null, client: null, mfaRequired: false };

  const assurance = await getAuthAssurance(supabase, user);
  if (assurance.requiresChallenge) {
    return { supabase, user, admin: null, client: null, mfaRequired: true };
  }

  const [{ data: adminRecord }, { data: client }] = await Promise.all([
    supabase.from('admins').select('id,role,email').eq('user_id', user.id).maybeSingle(),
    supabase.from('clients').select('id,full_name,email,telegram_username,phone,plan,status,membership_tier,membership_status,membership_started_at,membership_expires_at').eq('auth_user_id', user.id).maybeSingle(),
  ]);
  const admin = adminRecord && ['admin', 'analyst'].includes(adminRecord.role) ? adminRecord : null;

  return { supabase, user, admin, client, mfaRequired: false };
}

export type PortalSession = Awaited<ReturnType<typeof getPortalSession>>;
