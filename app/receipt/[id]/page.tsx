import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import PrintReceiptButton from '@/components/print-receipt-button';
import './receipt.css';

export const dynamic='force-dynamic';
export default async function ReceiptPage({params}:{params:Promise<{id:string}>}){
  const{id}=await params;const supabase=await createSupabaseServerClient();const{data:{user}}=await supabase.auth.getUser();if(!user)redirect(`/client-login?next=/receipt/${id}`);
  const[{data:admin},{data:client}]=await Promise.all([supabase.from('admins').select('id').eq('user_id',user.id).maybeSingle(),supabase.from('clients').select('id').eq('auth_user_id',user.id).maybeSingle()]);if(!admin&&!client)notFound();
  let query=supabase.from('client_payments').select('id,client_id,license_id,receipt_number,plan,method,status,amount,currency,payment_date,reference_id,created_at,clients(full_name,email,country),licenses(license_key,platform,account_number)').eq('id',id);if(!admin&&client)query=query.eq('client_id',client.id);
  const{data:payment}=await query.maybeSingle();if(!payment||!['Paid','Manually verified'].includes(payment.status))notFound();
  const customer=Array.isArray(payment.clients)?payment.clients[0]:payment.clients;const license=Array.isArray(payment.licenses)?payment.licenses[0]:payment.licenses;
  return <main className="receipt-page"><div className="receipt-actions"><a href={admin?'/dashboard?section=payments':'/portal'}>← Back</a><PrintReceiptButton/></div><article className="receipt-sheet"><header><div><p>ORION SCALPER</p><h1>PAYMENT RECEIPT</h1></div><span>PAID</span></header><section className="receipt-meta"><div><small>Receipt number</small><strong>{payment.receipt_number}</strong></div><div><small>Payment date</small><strong>{formatDate(payment.payment_date||payment.created_at)}</strong></div></section><section className="receipt-parties"><div><small>RECEIVED FROM</small><h2>{customer?.full_name||'Orion client'}</h2><p>{customer?.email||'No email'}<br/>{customer?.country||''}</p></div><div><small>PAYMENT DETAILS</small><p>Method: <b>{payment.method}</b><br/>Reference: <b>{payment.reference_id||'—'}</b></p></div></section><div className="receipt-line"><div><small>DESCRIPTION</small><strong>Orion {payment.plan} plan</strong>{license&&<p>{license.platform} · Account {license.account_number||'Not assigned'}<br/><code>{license.license_key}</code></p>}</div><strong>{money(Number(payment.amount),payment.currency)}</strong></div><footer><div><span>Total paid</span><strong>{money(Number(payment.amount),payment.currency)}</strong></div><p>Thank you for choosing Orion Scalper. This computer-generated receipt confirms the payment recorded in your Orion account.</p></footer></article></main>
}
function formatDate(value:string){return new Date(value.includes('T')?value:`${value}T00:00:00`).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}
function money(value:number,currency:string){return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value)}
