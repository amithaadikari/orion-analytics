import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

export async function createSupabaseServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values: { name: string; value: string; options: CookieOptions }[]) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* Server components cannot always write cookies. */ }
      }
    }
  });
}

/** Server-only client. Import this module only from server code or route handlers. */
export function createSupabaseAdminClient() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
