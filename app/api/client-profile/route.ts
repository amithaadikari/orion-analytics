import { getPortalSession } from '@/lib/portal-session';
import { rateLimit } from '@/lib/rate-limit';
import { jsonError, readJson } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { clientProfileSchema } from '@/lib/validation';
import { serializeClientProfile, type ClientProfile } from '@/lib/client-profile';

export async function PATCH(request: Request) {
  const session = await getPortalSession();
  if (!session.user) return jsonError('Authentication required', 401);
  if (!session.client) return jsonError('A linked Orion client account is required', 403);
  if (!rateLimit(request, `client-profile:${session.user.id}`).allowed) return jsonError('Too many profile updates. Please wait a moment.', 429);

  let body: unknown;
  try { body = await readJson(request, 10_000); } catch { return jsonError('Invalid profile update'); }
  const parsed = clientProfileSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid profile details');

  const profile: ClientProfile = parsed.data;
  const previousTelegram = session.client.telegram_username || null;
  const previousPhone = session.client.phone || null;
  const nextTelegram = profile.telegramUsername || null;
  const nextPhone = profile.phoneNumber || null;
  const contactsChanged = nextTelegram !== previousTelegram || nextPhone !== previousPhone;
  const db = createSupabaseAdminClient();
  if (contactsChanged) {
    const { data: updatedClient, error: contactError } = await db.from('clients')
      .update({ telegram_username: nextTelegram, phone: nextPhone })
      .eq('id', session.client.id)
      .eq('auth_user_id', session.user.id)
      .select('id')
      .maybeSingle();
    if (contactError || !updatedClient) return jsonError('Unable to update your contact details', 500);
  }

  const { error: metadataError } = await session.supabase.auth.updateUser({
    data: { orion_profile: serializeClientProfile(profile) },
  });
  if (metadataError) {
    const rollback = contactsChanged
      ? await db.from('clients').update({ telegram_username: previousTelegram, phone: previousPhone })
        .eq('id', session.client.id).eq('auth_user_id', session.user.id)
      : { error: null };
    if (rollback.error) return jsonError('Profile preferences could not be saved and contact changes could not be fully restored. Refresh your profile before retrying.', 500);
    return jsonError('Unable to save your profile preferences', 500);
  }

  try {
    await db.from('client_activity').insert({
      client_id: session.client.id,
      action: 'Client profile updated',
      details: 'Portal profile preferences refreshed',
      actor_email: session.user.email || null,
    });
  } catch { /* Profile saving should not fail only because the activity log is unavailable. */ }

  return Response.json({ profile }, { headers: { 'Cache-Control': 'private, no-store' } });
}
