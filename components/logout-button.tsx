'use client';

import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function LogoutButton({ redirectTo = '/login' }: { redirectTo?: string }) {
  const router = useRouter();
  return <button className="ghost-button" onClick={async () => { await createSupabaseBrowserClient().auth.signOut(); router.replace(redirectTo); router.refresh(); }}>Log out</button>;
}
