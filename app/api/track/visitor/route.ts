import { visitorSchema } from '@/lib/validation';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { corsHeaders, geoFromRequest, jsonError, optionsResponse, readJson, sanitizeString } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const limit = rateLimit(request, 'visitor');
  if (!limit.allowed) return jsonError('Too many requests', 429);
  try {
    const parsed = visitorSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('Invalid visitor payload');
    const input = parsed.data;
    const supabase = createSupabaseAdminClient();
    const { data: existing, error: readError } = await supabase.from('visitors').select('visitor_id, first_seen, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, fbp, fbc').eq('visitor_id', input.visitor_id).maybeSingle();
    if (readError) return jsonError('Unable to record visitor', 500);
    const geo = geoFromRequest(request);
    const now = new Date().toISOString();
    const latest = {
      visitor_id: input.visitor_id, last_seen: now, updated_at: now,
      country: geo.country, city: geo.city, device_type: sanitizeString(input.device_type, 30), browser: sanitizeString(input.browser, 80), operating_system: sanitizeString(input.operating_system, 80),
      referrer: sanitizeString(input.referrer, 2000), landing_page: sanitizeString(input.landing_page, 2000),
      latest_utm_source: sanitizeString(input.utm_source, 120), latest_utm_medium: sanitizeString(input.utm_medium, 120), latest_utm_campaign: sanitizeString(input.utm_campaign, 180), latest_utm_content: sanitizeString(input.utm_content, 180), latest_utm_term: sanitizeString(input.utm_term, 180), latest_fbclid: sanitizeString(input.fbclid, 250), latest_fbp: sanitizeString(input.fbp, 250), latest_fbc: sanitizeString(input.fbc, 250)
    };
    if (existing) {
      const { error } = await supabase.from('visitors').update(latest).eq('visitor_id', input.visitor_id);
      if (error) return jsonError('Unable to update visitor', 500);
    } else {
      const { error } = await supabase.from('visitors').insert({ ...latest, first_seen: now, utm_source: latest.latest_utm_source, utm_medium: latest.latest_utm_medium, utm_campaign: latest.latest_utm_campaign, utm_content: latest.latest_utm_content, utm_term: latest.latest_utm_term, fbclid: latest.latest_fbclid, fbp: latest.latest_fbp, fbc: latest.latest_fbc });
      if (error) return jsonError('Unable to create visitor', 500);
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } });
  } catch (error) {
    return jsonError(error instanceof Error && error.message === 'Request too large' ? error.message : 'Malformed request');
  }
}

export function OPTIONS(request: Request) { return optionsResponse(request); }
