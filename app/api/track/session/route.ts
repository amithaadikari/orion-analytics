import { sessionSchema } from '@/lib/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { corsHeaders, jsonError, optionsResponse, readJson, requireTrackingOrigin } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const denied = requireTrackingOrigin(request); if (denied) return denied;
  const limit = rateLimit(request, 'session');
  if (!limit.allowed) return jsonError('Too many requests', 429);
  try {
    const parsed = sessionSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('Invalid session payload');
    const input = parsed.data;
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from('sessions').upsert({ visitor_id: input.visitor_id, session_id: input.session_id, started_at: input.started_at || new Date().toISOString(), ended_at: input.ended_at || null, pages_viewed: input.pages_viewed || 1, duration_seconds: input.duration_seconds || 0 }, { onConflict: 'session_id' });
    if (error) return jsonError('Unable to record session', 500);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } });
  } catch (error) { return jsonError(error instanceof Error && error.message === 'Request too large' ? error.message : 'Malformed request'); }
}

export function OPTIONS(request: Request) { return optionsResponse(request); }
