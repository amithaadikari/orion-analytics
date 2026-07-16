import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/security';

const requestSchema = z.object({ client_id: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.user || !auth.admin || auth.admin.role !== 'admin') return jsonError('Admin access required', 403);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid client');

  const db = createSupabaseAdminClient();
  const { data: client, error: clientError } = await db.from('clients').select('id,full_name,email,plan,auth_user_id').eq('id', parsed.data.client_id).single();
  if (clientError || !client) return jsonError('Client not found', 404);
  if (client.auth_user_id) return jsonError('This client already has portal access');
  const email = String(client.email || '').trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return jsonError('Add a valid client email before sending an invitation');

  const portalUrl = getEnv().CLIENT_PORTAL_URL.replace(/\/$/, '');
  const { data: invitation, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${portalUrl}/auth/callback?next=/reset-password`,
    data: { full_name: client.full_name, client_id: client.id, plan: client.plan }
  });
  if (inviteError || !invitation.user) {
    const message = inviteError?.message || 'Unable to create client invitation';
    if (/already|registered|exists/i.test(message)) return jsonError('An Auth user already exists with this email. Link that user UUID in the client record instead.', 409);
    if (/rate/i.test(message)) return jsonError('Email sending is temporarily rate limited. Try again later.', 429);
    return jsonError(message, 400);
  }

  const { error: linkError } = await db.from('clients').update({ auth_user_id: invitation.user.id }).eq('id', client.id).is('auth_user_id', null);
  if (linkError) {
    await db.auth.admin.deleteUser(invitation.user.id).catch(() => undefined);
    return jsonError('The invitation was created but could not be linked. Please try again.', 500);
  }
  await db.from('client_activity').insert({ client_id: client.id, action: 'Portal invitation sent', details: `${email} · ${client.plan}`, actor_email: auth.admin.email });
  return Response.json({ ok: true, auth_user_id: invitation.user.id, email });
}
