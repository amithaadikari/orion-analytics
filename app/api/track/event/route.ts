import { eventSchema } from '@/lib/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { corsHeaders, jsonError, optionsResponse, readJson, sanitizeUrl } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const limit = rateLimit(request, 'event');
  if (!limit.allowed) return jsonError('Too many requests', 429);
  try {
    const parsed = eventSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('Invalid event payload');
    const input = parsed.data;
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from('events').insert({ visitor_id: input.visitor_id, session_id: input.session_id || null, event_name: input.event_name, event_id: input.event_id, page_url: sanitizeUrl(input.page_url), metadata: input.metadata, created_at: new Date().toISOString() });
    if (error && !error.message.toLowerCase().includes('duplicate')) return jsonError('Unable to record event', 500);
    return Response.json({ ok: true, duplicate: Boolean(error) }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } });
  } catch (error) { return jsonError(error instanceof Error && error.message === 'Request too large' ? error.message : 'Malformed request'); }
}

export function OPTIONS(request: Request) { return optionsResponse(request); }
