'use client';

import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function LogoutButton() {
  const router = useRouter();
  return <button className="ghost-button" onClick={async () => { await createSupabaseBrowserClient().auth.signOut(); router.replace('/login'); router.refresh(); }}>Log out</button>;
}
