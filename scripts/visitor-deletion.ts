import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';

/** Run from a protected scheduler, never from a browser. */
async function main() {
  const cutoff = new Date(Date.now() - getEnv().DATA_RETENTION_DAYS * 86400000).toISOString();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('visitors').delete().lt('last_seen', cutoff);
  if (error) throw error;
  console.log(`Deleted visitor records older than ${cutoff}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Deletion failed'); process.exitCode = 1; });
