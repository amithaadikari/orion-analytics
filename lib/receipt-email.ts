import { getEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

type PaymentReceipt = { id:string; client_id:string; receipt_number?:string|null; receipt_sent_at?:string|null; plan:string; method:string; status:string; amount:number; currency:string };
const completed = new Set(['Paid', 'Manually verified']);

export async function sendPaymentReceipt(payment: PaymentReceipt) {
  if (!completed.has(payment.status) || !payment.receipt_number || payment.receipt_sent_at) return;
  const env = getEnv();
  if (!env.RESEND_API_KEY) return;
  const db = createSupabaseAdminClient();
  const { data: client } = await db.from('clients').select('full_name,email').eq('id', payment.client_id).single();
  if (!client?.email) return;
  const receiptUrl = `${env.CLIENT_PORTAL_URL.replace(/\/$/, '')}/receipt/${payment.id}`;
  const amount = new Intl.NumberFormat('en-US', { style:'currency', currency:payment.currency }).format(Number(payment.amount));
  const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${env.RESEND_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({
    from:env.RENEWAL_EMAIL_FROM, to:[client.email], subject:`Orion payment receipt ${payment.receipt_number}`,
    html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;background:#080808;color:#fff;border-radius:18px"><p style="color:#e3bb4f;font-size:12px;letter-spacing:2px">ORION SCALPER</p><h1>Payment received</h1><p style="color:#bbb;line-height:1.7">Hello ${escapeHtml(client.full_name)}, your ${escapeHtml(payment.plan)} plan payment has been recorded.</p><div style="padding:20px;margin:24px 0;background:#111;border:1px solid #292929;border-radius:14px"><strong style="font-size:24px">${escapeHtml(amount)}</strong><p style="color:#aaa">Receipt ${escapeHtml(payment.receipt_number)} · ${escapeHtml(payment.method)}</p></div><a href="${receiptUrl}" style="display:inline-block;padding:13px 20px;background:#e3bb4f;color:#090909;text-decoration:none;border-radius:10px;font-weight:bold">View and download receipt</a></div>`
  }) });
  if (response.ok) await db.from('client_payments').update({ receipt_sent_at:new Date().toISOString() }).eq('id', payment.id);
}

function escapeHtml(value:string) { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]!); }
