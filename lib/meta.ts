import { createHash } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export type MetaEventInput = {
  eventName: 'PageView' | 'ViewContent' | 'Lead' | 'Contact' | 'Purchase';
  eventId: string;
  eventSourceUrl?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  visitorId?: string | null;
  customData?: Record<string, unknown>;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function sendMetaEvent(input: MetaEventInput) {
  const env = getEnv();
  const userData: Record<string, unknown> = {};
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.userAgent) userData.client_user_agent = input.userAgent.slice(0, 500);
  if (input.visitorId) userData.external_id = [sha256(input.visitorId)];
  const payload = {
    data: [{
      event_name: input.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      event_source_url: input.eventSourceUrl || undefined,
      action_source: 'website',
      user_data: userData,
      custom_data: input.customData
    }],
    ...(env.META_TEST_EVENT_CODE ? { test_event_code: env.META_TEST_EVENT_CODE } : {})
  };
  const response = await fetch(`https://graph.facebook.com/${env.META_API_VERSION}/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  try {
    const log = createSupabaseAdminClient();
    await log.from('meta_events').insert({ event_id: input.eventId, event_name: input.eventName, source: 'server', status: response.ok ? 'sent' : 'failed', error_message: response.ok ? null : `Meta API ${response.status}` });
  } catch (logError) { console.error('Meta event log failed', logError instanceof Error ? logError.message : 'unknown error'); }
  if (!response.ok) throw new Error(`Meta API ${response.status}: ${JSON.stringify(result).slice(0, 500)}`);
  return { ...result, eventId: input.eventId };
}
