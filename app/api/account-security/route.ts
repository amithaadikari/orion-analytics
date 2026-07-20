import { z } from 'zod';
import { getPortalSession } from '@/lib/portal-session';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError, readJson } from '@/lib/security';
import {
  accountSecurityEvents,
  accountSecurityRateLimit,
  isExactSameOrigin,
  isMissingAccountSecurityRelation,
  securityDeviceFromRequest,
  securityDeviceLabel,
  type AccountSecurityEventName,
} from '@/lib/client-security';

export const dynamic = 'force-dynamic';

const preferenceSchema = z.object({ licenseReminders: z.boolean() }).strict();
const eventSchema = z.object({ event: z.enum([
  'session_started',
  'password_changed',
  'mfa_enabled',
  'mfa_disabled',
  'other_sessions_signed_out',
]) }).strict();

export async function GET() {
  const session = await getPortalSession();
  const denied = sessionError(session);
  if (denied) return denied;
  const db = createSupabaseAdminClient();
  const [{ data: preference, error: preferenceError }, { data: activities, error: activityError }, claimsResult] = await Promise.all([
    db.from('client_account_preferences').select('email_license_reminders').eq('client_id', session.client!.id).maybeSingle(),
    db.from('client_security_events')
      .select('id,session_id,event_type,title,detail,browser,os,device,country,created_at')
      .eq('client_id', session.client!.id)
      .order('created_at', { ascending: false })
      .limit(12),
    session.supabase.auth.getClaims(),
  ]);
  if (preferenceError || activityError) {
    const missing = isMissingAccountSecurityRelation(preferenceError) || isMissingAccountSecurityRelation(activityError);
    return jsonError(missing ? 'Account security is waiting for its database migration.' : 'Account security is temporarily unavailable', missing ? 503 : 500);
  }
  const currentSessionId = typeof claimsResult.data?.claims?.session_id === 'string' ? claimsResult.data.claims.session_id : null;
  return privateJson({
    preferences: {
      licenseReminders: preference?.email_license_reminders !== false,
      securityAlerts: true,
    },
    activities: (activities || []).map((row) => publicActivity(row, currentSessionId)),
  });
}

export async function PATCH(request: Request) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const session = await getPortalSession();
  const denied = sessionError(session);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, session.user!.id)) return jsonError('Too many security changes. Please wait before trying again.', 429);
  const body = await safeBody(request);
  const parsed = preferenceSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid account preference');

  const db = createSupabaseAdminClient();
  const { data, error } = await db.from('client_account_preferences').upsert({
    client_id: session.client!.id,
    email_license_reminders: parsed.data.licenseReminders,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' }).select('email_license_reminders').single();
  if (error) {
    const missing = isMissingAccountSecurityRelation(error);
    return jsonError(missing ? 'Account security is waiting for its database migration.' : 'Unable to save account preferences', missing ? 503 : 500);
  }
  return privateJson({ preferences: { licenseReminders: data.email_license_reminders !== false, securityAlerts: true } });
}

export async function POST(request: Request) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const session = await getPortalSession();
  const denied = sessionError(session);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, session.user!.id)) return jsonError('Too many security updates. Please wait before trying again.', 429);
  const body = await safeBody(request);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return jsonError('Invalid security event');

  const event = parsed.data.event as AccountSecurityEventName;
  const db = createSupabaseAdminClient();
  const definition = accountSecurityEvents[event];
  const device = securityDeviceFromRequest(request);
  const { data: claimsData } = await session.supabase.auth.getClaims();
  const sessionId = typeof claimsData?.claims?.session_id === 'string' ? claimsData.claims.session_id : null;
  if (event === 'session_started' && !sessionId) return jsonError('A verified session could not be identified', 409);
  const hasVerifiedTotp = session.user!.factors?.some((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
  if (event === 'mfa_enabled' && !hasVerifiedTotp) {
    return jsonError('No verified authenticator is active', 409);
  }
  if (event === 'mfa_disabled' && hasVerifiedTotp) {
    return jsonError('An authenticator is still active', 409);
  }

  const notificationMessage = event === 'session_started'
    ? `${definition.notification} ${securityDeviceLabel(device)}.`
    : definition.notification;
  const { data: recorded, error } = await db.rpc('record_client_security_event_atomic', {
    p_client_id: session.client!.id,
    p_auth_user_id: session.user!.id,
    p_session_id: sessionId,
    p_event_type: event,
    p_title: definition.title,
    p_detail: definition.detail,
    p_browser: device.browser,
    p_os: device.os,
    p_device: device.device,
    p_country: device.country,
    p_ip_hash: device.ipHash,
    p_notification: notificationMessage.slice(0, 1000),
    p_actor_email: session.user!.email || null,
  });
  const eventId = recorded && typeof recorded === 'object' && !Array.isArray(recorded) && typeof recorded.id === 'string' ? recorded.id : null;
  if (error || !eventId) {
    const missing = isMissingAccountSecurityRelation(error);
    return jsonError(missing ? 'Account security is waiting for its database migration.' : 'Unable to record the security update', missing ? 503 : 500);
  }
  const { data: inserted, error: readError } = await db.from('client_security_events')
    .select('id,session_id,event_type,title,detail,browser,os,device,country,created_at')
    .eq('client_id', session.client!.id)
    .eq('id', eventId)
    .single();
  if (readError || !inserted) return jsonError('The security update was recorded but could not be reloaded', 500);
  const created = recorded && typeof recorded === 'object' && !Array.isArray(recorded) && recorded.created === true;
  return privateJson({ activity: publicActivity(inserted, sessionId) }, created ? 201 : 200);
}

function sessionError(session: Awaited<ReturnType<typeof getPortalSession>>) {
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);
  return null;
}

function mutationPreflight(request: Request) {
  if (!isExactSameOrigin(request)) return jsonError('Origin not allowed', 403);
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') return jsonError('JSON content is required', 415);
  return null;
}

async function safeBody(request: Request) {
  try { return await readJson(request, 2_000); } catch { return null; }
}

function publicActivity(row: Record<string, unknown>, currentSessionId: string | null) {
  return {
    id: String(row.id || ''),
    type: String(row.event_type || 'security_update'),
    title: String(row.title || 'Security update'),
    detail: typeof row.detail === 'string' ? row.detail : '',
    createdAt: String(row.created_at || ''),
    device: securityDeviceLabel(row),
    current: Boolean(currentSessionId && row.session_id === currentSessionId),
  };
}

function privateJson(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
