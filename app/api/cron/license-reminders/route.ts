import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';
import { jsonError } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return jsonError('Unauthorized', 401);
  if (!env.RESEND_API_KEY) return jsonError('RESEND_API_KEY is not configured', 503);
  const db = createSupabaseAdminClient();
  const { data: licenses, error } = await db.from('licenses').select('id,client_id,license_key,platform,plan,status,expires_at').not('expires_at', 'is', null);
  if (error) return jsonError('Unable to load licenses', 500);
  const clientIds = [...new Set((licenses || []).map(row => row.client_id))];
  const { data: clients } = clientIds.length ? await db.from('clients').select('id,full_name,email,plan,status').in('id', clientIds) : { data: [] };
  const clientMap = new Map((clients || []).map(client => [client.id, client]));
  const today = new Date(), todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let expired = 0, sent = 0, skipped = 0, failed = 0;

  for (const license of licenses || []) {
    const expiresOn = String(license.expires_at).slice(0, 10);
    const days = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - todayUtc) / 86400000);
    const client = clientMap.get(license.client_id);
    if (days < 0) {
      if (license.status !== 'Expired') {
        await db.from('licenses').update({ status: 'Expired' }).eq('id', license.id);
        await db.from('client_activity').insert({ client_id: license.client_id, action: 'License expired automatically', details: `${license.license_key} · ${license.plan} · expired ${expiresOn}`, actor_email: 'system' });
        expired++;
      }
      if (client && client.plan !== 'Free') {
        const { data: active } = await db.from('licenses').select('id').eq('client_id', client.id).eq('status', 'Active').or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`).limit(1);
        if (!active?.length) await db.from('clients').update({ status: 'Expired' }).eq('id', client.id);
      }
      continue;
    }
    if (![30, 7, 1, 0].includes(days) || license.status !== 'Active' || !client?.email) continue;
    const { data: existing } = await db.from('license_reminders').select('id,sent_at').eq('license_id', license.id).eq('expires_on', expiresOn).eq('reminder_days', days).maybeSingle();
    if (existing?.sent_at) { skipped++; continue; }
    const subject = days === 0 ? `Your Orion ${license.plan} license expires today` : `Your Orion license expires in ${days} day${days === 1 ? '' : 's'}`;
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.RENEWAL_EMAIL_FROM, to: [client.email], subject, html: renewalEmail({ name: client.full_name, plan: license.plan, platform: license.platform, key: license.license_key, expiresOn, days, portalUrl: env.CLIENT_PORTAL_URL }) }) });
    const responseBody = await response.json().catch(() => ({}));
    if (response.ok) {
      await db.from('license_reminders').upsert({ license_id: license.id, expires_on: expiresOn, reminder_days: days, recipient_email: client.email, sent_at: new Date().toISOString(), last_error: null }, { onConflict: 'license_id,expires_on,reminder_days' });
      await db.from('client_activity').insert({ client_id: client.id, action: 'License renewal reminder sent', details: `${license.license_key} · ${days === 0 ? 'expires today' : `${days} days remaining`}`, actor_email: 'system' });
      sent++;
    } else {
      await db.from('license_reminders').upsert({ license_id: license.id, expires_on: expiresOn, reminder_days: days, recipient_email: client.email, sent_at: null, last_error: String(responseBody?.message || 'Resend delivery failed').slice(0, 1000) }, { onConflict: 'license_id,expires_on,reminder_days' });
      failed++;
    }
  }
  return Response.json({ ok: true, checked: licenses?.length || 0, expired, remindersSent: sent, duplicatesSkipped: skipped, failed });
}

function renewalEmail({name,plan,platform,key,expiresOn,days,portalUrl}:{name:string;plan:string;platform:string;key:string;expiresOn:string;days:number;portalUrl:string}) {
  const safe = (value:string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] || character));
  return `<div style="background:#050505;color:#f5f5f5;padding:32px;font-family:Arial,sans-serif"><div style="max-width:560px;margin:auto;background:#0c0c0c;border:1px solid #222;border-radius:18px;padding:30px"><p style="color:#d7b85a;letter-spacing:2px;font-size:11px">ORION SCALPER</p><h1 style="font-size:25px">License renewal reminder</h1><p>Hello ${safe(name)},</p><p>Your <strong>${safe(plan)} ${safe(platform)}</strong> license ${days === 0 ? 'expires today' : `will expire in ${days} day${days === 1 ? '' : 's'}`}.</p><div style="background:#080808;border:1px solid #222;border-radius:12px;padding:16px;margin:22px 0"><p>License: <strong>${safe(key)}</strong></p><p>Expiry date: <strong>${safe(expiresOn)}</strong></p></div><p>Contact Orion support to renew before access ends.</p><a href="${safe(portalUrl)}" style="display:inline-block;margin-top:12px;background:#d7b85a;color:#050505;padding:12px 18px;border-radius:9px;text-decoration:none;font-weight:bold">Open client portal</a></div></div>`;
}
