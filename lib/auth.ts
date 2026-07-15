import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: admin } = await supabase.from('admins').select('id, role, email').eq('user_id', user.id).maybeSingle();
  if (!admin || !['admin', 'analyst'].includes(admin.role)) redirect('/login?error=not-approved');
  return { supabase, user, admin };
}

export async function requireAdminApi() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, admin: null };
  const { data: admin } = await supabase.from('admins').select('id, role, email').eq('user_id', user.id).maybeSingle();
  return { supabase, user, admin: admin && ['admin', 'analyst'].includes(admin.role) ? admin : null };
}
