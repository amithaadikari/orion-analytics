'use client';

import type { PlanKey } from '@/lib/plans';
import { normalizeTrackingId } from '@/lib/plans';

export type FunnelEventName = 'PlanSelected' | 'RegistrationStarted' | 'RegistrationCompleted' | 'CheckoutStarted';

export type TrackingSeed = {
  enabled?: boolean;
  visitorId?: string | null;
  sessionId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

const visitorKey = 'orion_portal_visitor_id';
const sessionKey = 'orion_portal_session_id';
const fbpKey = 'orion_portal_fbp';
const fbcKey = 'orion_portal_fbc';
const enabledKey = 'orion_portal_tracking';

function createId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

function safeMetaId(value: unknown) {
  return typeof value === 'string' && value.length <= 250 ? value : null;
}

function trackingAllowed(seed: TrackingSeed = {}) {
  try {
    if (localStorage.getItem('orion_consent') === 'denied') return false;
    return seed.enabled === true || localStorage.getItem(enabledKey) === 'enabled' || localStorage.getItem('orion_consent') === 'accepted';
  } catch {
    return seed.enabled === true;
  }
}

export function primeTrackingContext(seed: TrackingSeed) {
  if (!trackingAllowed(seed)) return false;
  write(enabledKey, 'enabled');
  const visitorId = normalizeTrackingId(seed.visitorId);
  const sessionId = normalizeTrackingId(seed.sessionId);
  const fbp = safeMetaId(seed.fbp);
  const fbc = safeMetaId(seed.fbc);
  if (visitorId) write(visitorKey, visitorId);
  if (sessionId) write(sessionKey, sessionId);
  if (fbp) write(fbpKey, fbp);
  if (fbc) write(fbcKey, fbc);
  return true;
}

export function getTrackingState(seed: TrackingSeed = {}) {
  if (!trackingAllowed(seed)) return null;
  primeTrackingContext(seed);
  const visitorId = normalizeTrackingId(seed.visitorId) || normalizeTrackingId(read(visitorKey)) || createId('pv');
  const sessionId = normalizeTrackingId(seed.sessionId) || normalizeTrackingId(read(sessionKey)) || createId('ps');
  const fbp = safeMetaId(seed.fbp) || safeMetaId(read(fbpKey));
  const fbc = safeMetaId(seed.fbc) || safeMetaId(read(fbcKey));
  write(visitorKey, visitorId);
  write(sessionKey, sessionId);
  return { visitorId, sessionId, fbp, fbc };
}

function safePageUrl() {
  const url = new URL(window.location.href);
  ['visitor_id', 'session_id', 'source_event_id', 'fbp', 'fbc', 'tracking_consent'].forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  return url.toString();
}

export async function trackFunnelEvent(
  eventName: FunnelEventName,
  plan: PlanKey | null,
  seed: TrackingSeed = {},
  onceKey?: string,
) {
  const state = getTrackingState(seed);
  if (!state) return null;
  if (onceKey) {
    try {
      if (sessionStorage.getItem(onceKey)) return null;
      sessionStorage.setItem(onceKey, '1');
    } catch {}
  }

  const eventId = createId('funnel');
  try {
    await fetch('/api/track/funnel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitor_id: state.visitorId,
        session_id: state.sessionId,
        event_id: eventId,
        event_name: eventName,
        page_url: safePageUrl(),
        plan,
        fbp: state.fbp,
        fbc: state.fbc,
        metadata: { surface: 'client_portal', plan },
      }),
      keepalive: true,
    });
  } catch {}
  return eventId;
}
