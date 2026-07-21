import { requireAdminApi } from '@/lib/auth';
import { loadAdminTradingMonitor, publicAdminTradingMonitorError } from '@/lib/admin-trading-monitor-server';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.user) return jsonError('Authentication required', 401);
  if (auth.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!auth.admin) return jsonError('Administrator access required', 403);
  try {
    const payload = await loadAdminTradingMonitor(createSupabaseAdminClient());
    return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const mapped = publicAdminTradingMonitorError(error);
    return jsonError(mapped.message, mapped.status);
  }
}
