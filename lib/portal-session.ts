import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function getPortalSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, admin: null, client: null };

  const [{ data: adminRecord }, { data: client }] = await Promise.all([
    supabase.from('admins').select('id,role,email').eq('user_id', user.id).maybeSingle(),
    supabase.from('clients').select('id,full_name,email,plan,status').eq('auth_user_id', user.id).maybeSingle(),
  ]);
  const admin = adminRecord && ['admin', 'analyst'].includes(adminRecord.role) ? adminRecord : null;

  return { supabase, user, admin, client };
}

export type PortalSession = Awaited<ReturnType<typeof getPortalSession>>;
