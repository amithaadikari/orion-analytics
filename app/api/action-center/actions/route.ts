import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { sendPaymentReceipt } from '@/lib/receipt-email';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve-registration'), id: z.string().uuid() }),
  z.object({ action: z.literal('verify-payment'), id: z.string().uuid() }),
  z.object({ action: z.literal('renew-license'), id: z.string().uuid(), extension_days: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional() }),
  z.object({ action: z.literal('reactivate-client'), id: z.string().uuid() }),
]);

type ActionResult = { ok?: boolean; code?: string; status?: string; message?: string };

export async function POST(request: Request) {
  const { user, admin } = await requireAdminApi();
  if (!user || !admin || admin.role !== 'admin') return jsonError('Admin access required', 403);
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid action');

  const db = createSupabaseAdminClient();
  const actor = admin.email || user.email || 'Orion administrator';
  const action = parsed.data;
  const rpc = action.action === 'approve-registration'
    ? await db.rpc('action_approve_registration', { p_client_id: action.id, p_actor: actor })
    : action.action === 'verify-payment'
      ? await db.rpc('action_verify_payment', { p_payment_id: action.id, p_payment_date: new Date().toISOString().slice(0, 10), p_actor: actor })
      : action.action === 'renew-license'
        ? await db.rpc('action_renew_license', { p_license_id: action.id, p_extension_days: action.extension_days ?? null, p_actor: actor })
        : await db.rpc('action_reactivate_client', { p_client_id: action.id, p_actor: actor });

  if (rpc.error) {
    const missingMigration = rpc.error.message.includes('function') || rpc.error.message.includes('schema cache');
    return jsonError(missingMigration ? 'Apply the Orion command-suite migration before using direct actions' : 'The direct action could not be completed safely', missingMigration ? 503 : 500);
  }
  const result = (rpc.data || {}) as ActionResult;
  if (!result.ok) return actionFailure(result);

  if (action.action === 'verify-payment') {
    const { data: payment } = await db.from('client_payments').select('*').eq('id', action.id).maybeSingle();
    if (payment) await sendPaymentReceipt(payment).catch(() => undefined);
  }
  return Response.json({ ok: true, message: result.message || 'Action completed.' }, { headers: { 'Cache-Control': 'no-store' } });
}

function actionFailure(result: ActionResult) {
  if (result.code === 'not_found') return jsonError('The selected record was not found', 404);
  if (result.code === 'already_reviewed') return jsonError('This registration has already been reviewed', 409);
  if (result.code === 'already_processed') return jsonError(`This payment is already marked ${result.status || 'processed'}`, 409);
  if (result.code === 'invalid_amount') return jsonError('A positive payment amount is required before verification', 409);
  if (result.code === 'not_suspended') return jsonError(`This client is currently ${result.status || 'not suspended'}`, 409);
  if (result.code === 'evidence_required') return jsonError('A completed payment and matching active license are required for this action', 409);
  if (result.code === 'invalid_extension') return jsonError('Choose a supported renewal period', 400);
  return jsonError('The direct action could not be completed', 409);
}
