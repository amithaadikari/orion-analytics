import { metaSchema } from '@/lib/validation';
import { corsHeaders, jsonError, optionsResponse, readJson, sanitizeUrl } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { sendMetaEvent } from '@/lib/meta';
import { getEnv } from '@/lib/env';

export async function POST(request: Request) {
  const limit = rateLimit(request, 'meta');
  if (!limit.allowed) return jsonError('Too many requests', 429);
  try {
    const parsed = metaSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('Invalid conversion payload');
    const input = parsed.data;
    if (input.event_name === 'Purchase' && request.headers.get('x-orion-internal-secret') !== getEnv().CONVERSION_INTERNAL_SECRET) return jsonError('Purchase events require backend confirmation', 403);
    await sendMetaEvent({ eventName: input.event_name, eventId: input.event_id, eventSourceUrl: sanitizeUrl(input.event_source_url), visitorId: input.visitor_id, fbp: input.fbp, fbc: input.fbc, customData: input.metadata });
    return Response.json({ ok: true, event_id: input.event_id }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } });
  } catch (error) {
    console.error('Meta conversion failed', error instanceof Error ? error.message : 'unknown error');
    return jsonError('Conversion could not be sent', 502);
  }
}

export function OPTIONS(request: Request) { return optionsResponse(request); }
