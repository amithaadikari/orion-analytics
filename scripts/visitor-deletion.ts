import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';
import { isMissingAccountSecurityRelation } from '@/lib/client-security';

/** Run from a protected scheduler, never from a browser. */
async function main() {
  const cutoff = new Date(Date.now() - getEnv().DATA_RETENTION_DAYS * 86400000).toISOString();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('visitors').delete().lt('last_seen', cutoff);
  if (error) throw error;
  const securityCutoff = new Date(Date.now() - 180 * 86400000).toISOString();
  const { error: securityError } = await supabase.from('client_security_events').delete().lt('created_at', securityCutoff);
  if (securityError && !isMissingAccountSecurityRelation(securityError)) throw securityError;
  console.log(`Deleted visitor records older than ${cutoff}`);
  if (!securityError) console.log(`Deleted client security events older than ${securityCutoff}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Deletion failed'); process.exitCode = 1; });
