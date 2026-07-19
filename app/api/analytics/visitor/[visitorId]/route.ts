import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { jsonError } from '@/lib/security';
import { EVENT_LABELS } from '@/lib/utils';

const visitorIdSchema = z.string().regex(/^[a-zA-Z0-9._:-]{8,180}$/);

export async function GET(_request: Request, { params }: { params: Promise<{ visitorId: string }> }) {
  const { supabase, user, admin } = await requireAdminApi();
  if (!user || !admin) return jsonError('Unauthorized', 401);

  const parsed = visitorIdSchema.safeParse((await params).visitorId);
  if (!parsed.success) return jsonError('Invalid visitor', 400);

  const { data: visitor, error: visitorError } = await supabase
    .from('visitors')
    .select('visitor_id,first_seen,last_seen,country,city,device_type,browser,operating_system,utm_source,utm_medium,utm_campaign,landing_page,referrer')
    .eq('visitor_id', parsed.data)
    .maybeSingle();
  if (visitorError) return jsonError('Unable to load visitor journey', 500);
  if (!visitor) return jsonError('Visitor not found', 404);

  const [eventsResult, sessionsResult] = await Promise.all([
    supabase.from('events')
      .select('event_name,session_id,page_url,metadata,created_at')
      .eq('visitor_id', parsed.data)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase.from('sessions')
      .select('session_id,started_at,ended_at,pages_viewed,duration_seconds')
      .eq('visitor_id', parsed.data)
      .order('started_at', { ascending: true })
      .limit(200),
  ]);
  if (eventsResult.error || sessionsResult.error) return jsonError('Unable to load visitor journey', 500);

  const events = (eventsResult.data || []).map((event, index) => {
    const funnelName = typeof event.metadata?.funnel_event === 'string' ? event.metadata.funnel_event : event.event_name;
    return {
      id: `event-${index + 1}`,
      type: 'event' as const,
      name: funnelName,
      label: EVENT_LABELS[funnelName] || funnelName,
      session: maskId(event.session_id),
      page: projectUrl(event.page_url),
      metadata: projectMetadata(event.metadata),
      occurredAt: event.created_at,
    };
  });
  const sessions = (sessionsResult.data || []).map((session, index) => ({
    id: `session-${index + 1}`,
    type: 'session' as const,
    session: maskId(session.session_id),
    startedAt: session.started_at,
    endedAt: session.ended_at,
    pagesViewed: Number(session.pages_viewed || 0),
    durationSeconds: Number(session.duration_seconds || 0),
  }));

  const timeline = [
    ...sessions.map((session) => ({
      id: session.id,
      type: session.type,
      label: 'Session started',
      detail: `${session.pagesViewed} page${session.pagesViewed === 1 ? '' : 's'} · ${session.durationSeconds}s`,
      occurredAt: session.startedAt,
      session: session.session,
    })),
    ...events.map((event) => ({
      id: event.id,
      type: event.type,
      label: event.label,
      detail: event.page || metadataDetail(event.metadata),
      occurredAt: event.occurredAt,
      session: event.session,
    })),
  ].filter((item) => item.occurredAt).sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));

  return Response.json({
    visitor: {
      token: maskId(visitor.visitor_id),
      firstSeen: visitor.first_seen,
      lastSeen: visitor.last_seen,
      country: visitor.country || 'Unknown',
      city: visitor.city || null,
      device: visitor.device_type || 'Unknown',
      browser: visitor.browser || 'Unknown',
      operatingSystem: visitor.operating_system || 'Unknown',
      campaign: visitor.utm_campaign || 'Organic',
      source: visitor.utm_source || null,
      medium: visitor.utm_medium || null,
      landingPage: projectUrl(visitor.landing_page),
      referrer: projectUrl(visitor.referrer),
    },
    sessions,
    events,
    timeline,
  }, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function maskId(value?: string | null) {
  if (!value) return null;
  return value.length <= 14 ? value : `${value.slice(0, 10)}…${value.slice(-4)}`;
}

function projectUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

function projectMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const output: Record<string, string> = {};
  ['plan', 'label', 'surface', 'funnel_event'].forEach((key) => {
    if (typeof source[key] === 'string') output[key] = String(source[key]).slice(0, 100);
  });
  return output;
}

function metadataDetail(metadata: Record<string, string>) {
  return metadata.plan || metadata.label || metadata.surface || 'Tracked interaction';
}
