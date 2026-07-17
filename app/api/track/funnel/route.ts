import { createHmac } from 'node:crypto';
import { after } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { funnelEventSchema } from '@/lib/validation';
import { corsHeaders, jsonError, optionsResponse, readJson, requireTrackingOrigin, sanitizeTrackingUrl } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { sendMetaEvent } from '@/lib/meta';
import { getEnv } from '@/lib/env';
import { plans } from '@/lib/plans';

const authenticatedEvents = new Set(['RegistrationCompleted', 'CheckoutStarted']);

function secureEventId(userId: string, eventName: string, plan: string | null) {
  const scope = eventName === 'RegistrationCompleted' ? `${userId}:${eventName}` : `${userId}:${eventName}:${plan || 'none'}`;
  const digest = createHmac('sha256', getEnv().CONVERSION_INTERNAL_SECRET).update(scope).digest('hex').slice(0, 48);
  return `secure_${digest}`;
}

function isDuplicate(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')));
}

function isConstraintMismatch(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === '23514' || error.message?.toLowerCase().includes('check constraint')));
}

export async function POST(request: Request) {
  const denied = requireTrackingOrigin(request);
  if (denied) return denied;
  const limit = rateLimit(request, 'funnel');
  if (!limit.allowed) return jsonError('Too many requests', 429);

  try {
    const parsed = funnelEventSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('Invalid funnel event payload');
    const input = parsed.data;
    let eventId = input.event_id;

    if (authenticatedEvents.has(input.event_name)) {
      const auth = await createSupabaseServerClient();
      const { data: { user } } = await auth.auth.getUser();
      if (!user) return jsonError('Authentication required', 401);
      const { data: client } = await auth.from('clients').select('id').eq('auth_user_id', user.id).maybeSingle();
      if (!client) return jsonError('Client profile required', 403);
      if (input.event_name === 'RegistrationCompleted' && user.user_metadata?.registration_source !== 'orion_client_portal') {
        return jsonError('Registration source not eligible', 403);
      }
      eventId = secureEventId(user.id, input.event_name, input.plan || null);
    }

    const db = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const pageUrl = sanitizeTrackingUrl(input.page_url);
    const { data: visitor } = await db.from('visitors').select('visitor_id').eq('visitor_id', input.visitor_id).maybeSingle();
    if (visitor) {
      await db.from('visitors').update({ last_seen: now }).eq('visitor_id', input.visitor_id);
    } else {
      const { error: visitorError } = await db.from('visitors').insert({
        visitor_id: input.visitor_id,
        first_seen: now,
        last_seen: now,
        landing_page: pageUrl,
        fbp: input.fbp || null,
        fbc: input.fbc || null,
      });
      if (visitorError && !isDuplicate(visitorError)) return jsonError('Unable to record funnel visitor', 500);
    }

    if (input.session_id) {
      const { data: session } = await db.from('sessions').select('session_id').eq('session_id', input.session_id).maybeSingle();
      if (!session) {
        const { error: sessionError } = await db.from('sessions').insert({
          visitor_id: input.visitor_id,
          session_id: input.session_id,
          started_at: now,
          pages_viewed: 1,
        });
        if (sessionError && !isDuplicate(sessionError)) return jsonError('Unable to record funnel session', 500);
      }
    }

    const metadata = { ...input.metadata, funnel_event: input.event_name, plan: input.plan || null };
    const row = {
      visitor_id: input.visitor_id,
      session_id: input.session_id || null,
      event_name: input.event_name,
      event_id: eventId,
      page_url: pageUrl,
      metadata,
      created_at: now,
    };
    let storedAs: string = input.event_name;
    let { error } = await db.from('events').insert(row);

    if (isDuplicate(error)) {
      return Response.json({ ok: true, duplicate: true, stored_as: storedAs }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } });
    }
    if (isConstraintMismatch(error)) {
      storedAs = 'ViewContent';
      ({ error } = await db.from('events').insert({ ...row, event_name: storedAs }));
    }
    if (isDuplicate(error)) {
      return Response.json({ ok: true, duplicate: true, stored_as: storedAs }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } });
    }
    if (error) return jsonError('Unable to record funnel event', 500);

    const metaName = input.event_name === 'RegistrationCompleted'
      ? 'CompleteRegistration'
      : input.event_name === 'CheckoutStarted'
        ? 'InitiateCheckout'
        : null;
    if (metaName) {
      const selected = input.plan ? plans[input.plan] : null;
      after(async () => {
        await sendMetaEvent({
          eventName: metaName,
          eventId,
          eventSourceUrl: pageUrl,
          visitorId: input.visitor_id,
          fbp: input.fbp,
          fbc: input.fbc,
          customData: selected ? {
            content_name: `Orion ${selected.name}`,
            content_type: 'product',
            value: selected.price,
            currency: 'USD',
          } : undefined,
        }).catch(() => undefined);
      });
    }

    return Response.json(
      { ok: true, duplicate: false, stored_as: storedAs },
      { headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) } },
    );
  } catch (error) {
    return jsonError(error instanceof Error && error.message === 'Request too large' ? error.message : 'Malformed request');
  }
}

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}
