import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, sanitizeString, sanitizeUrl } from '@/lib/security';
import { sendMetaEvent } from '@/lib/meta';

export async function GET(request: Request) {
  const limit = rateLimit(request, 'join');
  if (!limit.allowed) return jsonError('Too many requests', 429);
  const env = getEnv();
  const url = new URL(request.url);
  const visitorId = sanitizeString(url.searchParams.get('visitor_id'), 180);
  const sessionId = sanitizeString(url.searchParams.get('session_id'), 180);
  const eventId = sanitizeString(url.searchParams.get('event_id'), 180) || `tg_${randomUUID()}`;
  const fbp = sanitizeString(url.searchParams.get('fbp'), 250);
  const fbc = sanitizeString(url.searchParams.get('fbc'), 250);
  const attribution = { utm_source: sanitizeString(url.searchParams.get('utm_source'), 120), utm_medium: sanitizeString(url.searchParams.get('utm_medium'), 120), utm_campaign: sanitizeString(url.searchParams.get('utm_campaign'), 180), utm_content: sanitizeString(url.searchParams.get('utm_content'), 180), utm_term: sanitizeString(url.searchParams.get('utm_term'), 180), fbclid: sanitizeString(url.searchParams.get('fbclid'), 250) };
  const sourceUrl = sanitizeUrl(url.searchParams.get('page_url')) || request.headers.get('referer');
  try {
    if (visitorId) {
      const supabase = createSupabaseAdminClient();
      await supabase.from('events').insert({ visitor_id: visitorId, session_id: sessionId, event_name: 'TelegramClick', event_id: eventId, page_url: sourceUrl, metadata: { source: 'tracked_redirect', ...attribution } });
    }
    await sendMetaEvent({ eventName: 'Lead', eventId, eventSourceUrl: sourceUrl, userAgent: request.headers.get('user-agent'), visitorId, fbp, fbc, customData: { content_name: 'Official Telegram', ...attribution } });
  } catch (error) {
    console.error('Join tracking failed', error instanceof Error ? error.message : 'unknown error');
  }
  return Response.redirect(env.TELEGRAM_CHANNEL_URL, 307);
}
