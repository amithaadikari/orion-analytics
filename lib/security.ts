import { getEnv } from '@/lib/env';

const clean = (value: unknown, max = 500) => typeof value === 'string' ? value.replace(/[<>\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : null;

export function sanitizeString(value: unknown, max = 500) { return clean(value, max); }
export function sanitizeUrl(value: unknown) {
  const raw = clean(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export function geoFromRequest(request: Request) {
  return {
    country: clean(request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry'), 3),
    city: clean(request.headers.get('x-vercel-ip-city') || request.headers.get('x-city'), 120)
  };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(request: Request, maxBytes = 32_000) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('Request too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Request too large');
  return JSON.parse(text) as unknown;
}

export function corsHeaders(request: Request) {
  const allowed = allowedTrackingOrigins();
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

export function allowedTrackingOrigins() {
  return getEnv().TRACKING_ALLOWED_ORIGINS.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean);
}

export function isAllowedTrackingOrigin(request: Request) {
  const origin = request.headers.get('origin')?.replace(/\/$/, '');
  return Boolean(origin && allowedTrackingOrigins().includes(origin));
}

export function requireTrackingOrigin(request: Request) {
  if (isAllowedTrackingOrigin(request)) return null;
  return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin' } });
}

export function optionsResponse(request: Request) {
  const denied = requireTrackingOrigin(request);
  return denied || new Response(null, { status: 204, headers: corsHeaders(request) });
}
