import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { readJson, jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  adminAvatarKeys,
  isMissingAdminAccountRelation,
  readAdminPreferences,
  readAdminProfile,
} from '@/lib/admin-account';
import {
  accountSecurityRateLimit,
  isExactSameOrigin,
  securityDeviceFromRequest,
  securityDeviceLabel,
  type AccountSecurityEventName,
} from '@/lib/client-security';

export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  action: z.literal('profile'),
  displayName: z.string().trim().min(2).max(80),
  avatarKey: z.enum(adminAvatarKeys),
}).strict();

const preferencesSchema = z.object({
  action: z.literal('preferences'),
  registrationAlerts: z.boolean(),
  paymentAlerts: z.boolean(),
  licenseAlerts: z.boolean(),
  supportAlerts: z.boolean(),
}).strict();

const themeSchema = z.object({
  action: z.literal('theme'),
  theme: z.enum(['royal', 'black']),
}).strict();

const updateSchema = z.discriminatedUnion('action', [profileSchema, preferencesSchema, themeSchema]);
const eventSchema = z.object({ event: z.enum([
  'session_started',
  'password_changed',
  'mfa_enabled',
  'mfa_disabled',
  'other_sessions_signed_out',
]) }).strict();

type AdminSession = Awaited<ReturnType<typeof requireAdminApi>>;

export async function GET(request: Request) {
  const session = await requireAdminApi();
  const denied = sessionError(session);
  if (denied) return denied;

  const db = createSupabaseAdminClient();
  const [preferenceResult, activityResult, claimsResult] = await Promise.all([
    db.from('admin_account_preferences')
      .select('display_name,avatar_key,dashboard_theme,registration_alerts,payment_alerts,license_alerts,support_alerts')
      .eq('admin_id', session.admin!.id)
      .maybeSingle(),
    db.from('admin_account_events')
      .select('id,session_id,event_type,title,detail,browser,os,device,country,created_at')
      .eq('admin_id', session.admin!.id)
      .order('created_at', { ascending: false })
      .limit(12),
    session.supabase.auth.getClaims(),
  ]);

  if (preferenceResult.error || activityResult.error) {
    const missing = isMissingAdminAccountRelation(preferenceResult.error)
      || isMissingAdminAccountRelation(activityResult.error);
    return jsonError(missing ? 'Administrator settings are waiting for their database migration.' : 'Administrator settings are temporarily unavailable', missing ? 503 : 500);
  }

  const row = preferenceResult.data as Record<string, unknown> | null;
  const profile = readAdminProfile(row, session.user!.email);
  const preferences = readAdminPreferences(row);
  const currentSessionId = typeof claimsResult.data?.claims?.session_id === 'string'
    ? claimsResult.data.claims.session_id
    : null;
  const device = securityDeviceFromRequest(request);
  const verifiedFactor = session.user!.factors?.some((factor) => factor.factor_type === 'totp' && factor.status === 'verified') || false;

  return privateJson({
    account: {
      email: session.user!.email || session.admin!.email || '',
      emailVerified: Boolean(session.user!.email_confirmed_at),
      pendingEmail: session.user!.new_email || null,
      role: session.admin!.role,
      createdAt: session.user!.created_at,
      lastSignInAt: session.user!.last_sign_in_at || null,
    },
    profile,
    preferences,
    security: {
      mfaEnabled: verifiedFactor,
      currentDevice: securityDeviceLabel(device),
    },
    activities: (activityResult.data || []).map((activity) => publicActivity(activity, currentSessionId)),
  });
}

export async function PATCH(request: Request) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  const denied = sessionError(session);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, session.user!.id, { scope: 'admin-preferences', limit: 30 })) return jsonError('Too many administrator settings changes. Please wait before trying again.', 429);

  const parsed = updateSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid administrator setting');

  const values: Record<string, unknown> = { admin_id: session.admin!.id, updated_at: new Date().toISOString() };
  let event: 'profile_updated' | 'preferences_updated' = 'preferences_updated';
  if (parsed.data.action === 'profile') {
    values.display_name = parsed.data.displayName;
    values.avatar_key = parsed.data.avatarKey;
    event = 'profile_updated';
  } else if (parsed.data.action === 'theme') {
    values.dashboard_theme = parsed.data.theme;
  } else {
    values.registration_alerts = parsed.data.registrationAlerts;
    values.payment_alerts = parsed.data.paymentAlerts;
    values.license_alerts = parsed.data.licenseAlerts;
    values.support_alerts = parsed.data.supportAlerts;
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.from('admin_account_preferences')
    .upsert(values, { onConflict: 'admin_id' })
    .select('display_name,avatar_key,dashboard_theme,registration_alerts,payment_alerts,license_alerts,support_alerts')
    .single();
  if (error || !data) {
    const missing = isMissingAdminAccountRelation(error);
    return jsonError(missing ? 'Administrator settings are waiting for their database migration.' : 'Unable to save administrator settings', missing ? 503 : 500);
  }

  try { await recordEvent(db, session, request, event); } catch { /* The saved setting remains authoritative if the auxiliary activity feed is temporarily unavailable. */ }
  return privateJson({
    profile: readAdminProfile(data as Record<string, unknown>, session.user!.email),
    preferences: readAdminPreferences(data as Record<string, unknown>),
  });
}

export async function POST(request: Request) {
  const preflight = mutationPreflight(request);
  if (preflight) return preflight;
  const session = await requireAdminApi();
  const denied = sessionError(session);
  if (denied) return denied;
  if (!accountSecurityRateLimit(request, session.user!.id, { scope: 'admin-security-events', limit: 12 })) return jsonError('Too many administrator security updates. Please wait before trying again.', 429);

  const parsed = eventSchema.safeParse(await safeBody(request));
  if (!parsed.success) return jsonError('Invalid administrator security event');
  const event = parsed.data.event as AccountSecurityEventName;
  const hasVerifiedTotp = session.user!.factors?.some((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
  if (event === 'mfa_enabled' && !hasVerifiedTotp) return jsonError('No verified authenticator is active', 409);
  if (event === 'mfa_disabled' && hasVerifiedTotp) return jsonError('An authenticator is still active', 409);
  if (event === 'password_changed') {
    const updatedAt = Date.parse(session.user!.updated_at || '');
    if (!Number.isFinite(updatedAt) || Math.abs(Date.now() - updatedAt) > 2 * 60_000) return jsonError('A recent Supabase account update could not be verified', 409);
  }

  const db = createSupabaseAdminClient();
  const recorded = await recordEvent(db, session, request, event);
  if (recorded.response) return recorded.response;
  if (!recorded.activity) return jsonError('Unable to record the administrator security update', 500);
  return privateJson({ activity: recorded.activity }, recorded.created ? 201 : 200);
}

function sessionError(session: AdminSession) {
  if (!session.user) return jsonError('Authentication required', 401);
  if (session.mfaRequired) return jsonError('Authenticator verification required', 403);
  if (!session.admin) return jsonError('Approved administrator access required', 403);
  return null;
}

function mutationPreflight(request: Request) {
  if (!isExactSameOrigin(request)) return jsonError('Origin not allowed', 403);
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') return jsonError('JSON content is required', 415);
  return null;
}

async function safeBody(request: Request) {
  try { return await readJson(request, 3_000); } catch { return null; }
}

async function recordEvent(
  db: ReturnType<typeof createSupabaseAdminClient>,
  session: AdminSession,
  request: Request,
  event: AccountSecurityEventName | 'profile_updated' | 'preferences_updated',
) {
  const device = securityDeviceFromRequest(request);
  const { data: claimsData } = await session.supabase.auth.getClaims();
  const sessionId = typeof claimsData?.claims?.session_id === 'string' ? claimsData.claims.session_id : null;
  if (event === 'session_started' && !sessionId) {
    return { response: jsonError('A verified administrator session could not be identified', 409), activity: null, created: false };
  }
  const { data: result, error } = await db.rpc('record_admin_account_event_atomic', {
    p_admin_id: session.admin!.id,
    p_auth_user_id: session.user!.id,
    p_session_id: sessionId,
    p_event_type: event,
    p_browser: device.browser,
    p_os: device.os,
    p_device: device.device,
    p_country: device.country,
    p_ip_hash: device.ipHash,
  });
  const eventId = result && typeof result === 'object' && !Array.isArray(result) && typeof result.id === 'string' ? result.id : null;
  if (error || !eventId) {
    const missing = isMissingAdminAccountRelation(error);
    return {
      response: jsonError(missing ? 'Administrator settings are waiting for their database migration.' : 'Unable to record the administrator security update', missing ? 503 : 500),
      activity: null,
      created: false,
    };
  }
  const { data: activity, error: readError } = await db.from('admin_account_events')
    .select('id,session_id,event_type,title,detail,browser,os,device,country,created_at')
    .eq('admin_id', session.admin!.id)
    .eq('id', eventId)
    .single();
  return {
    response: readError || !activity ? jsonError('The administrator update was recorded but could not be reloaded', 500) : null,
    activity: activity ? publicActivity(activity, sessionId) : null,
    created: Boolean(result && typeof result === 'object' && !Array.isArray(result) && result.created === true),
  };
}

function publicActivity(row: Record<string, unknown>, currentSessionId: string | null) {
  return {
    id: String(row.id || ''),
    type: String(row.event_type || 'security_update'),
    title: String(row.title || 'Administrator account update'),
    detail: typeof row.detail === 'string' ? row.detail : '',
    createdAt: String(row.created_at || ''),
    device: securityDeviceLabel(row),
    current: Boolean(currentSessionId && row.session_id === currentSessionId),
  };
}

function privateJson(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
