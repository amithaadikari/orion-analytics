import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { jsonError } from '@/lib/security';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { readClientProfile } from '@/lib/client-profile';

const clientIdSchema = z.string().uuid();
const writeSchema = z.discriminatedUnion('action', [
  z.object({ action:z.literal('update-notes'), notes:z.string().trim().max(2000) }),
  z.object({ action:z.literal('create-reminder'), title:z.string().trim().min(2).max(180), notes:z.string().trim().max(1000).optional(), due_at:z.string().datetime() }),
  z.object({ action:z.literal('set-reminder-status'), reminder_id:z.string().uuid(), status:z.enum(['Open','Done','Dismissed']) }),
  z.object({ action:z.literal('add-communication'), channel:z.enum(['Email','Telegram','Phone','Portal','System','Other']), direction:z.enum(['Inbound','Outbound','Internal']), subject:z.string().trim().min(2).max(180), body:z.string().trim().max(4000).optional(), occurred_at:z.string().datetime() }),
]);

export async function GET(_request:Request,{params}:{params:Promise<{clientId:string}>}){
  const auth=await requireAdminApi();
  if(!auth.user||!auth.admin)return jsonError('Unauthorized',401);
  const id=clientIdSchema.safeParse((await params).clientId);
  if(!id.success)return jsonError('Invalid client',400);
  const db=createSupabaseAdminClient();
  const [clientResult,licensesResult,paymentsResult,activityResult,remindersResult,communicationsResult,downloadsResult,ticketsResult,messagesResult]=await Promise.all([
    db.from('clients').select('id,auth_user_id,full_name,email,telegram_username,phone,country,plan,status,notes,reviewed_at,created_at,updated_at').eq('id',id.data).single(),
    db.from('licenses').select('id,license_key,platform,account_number,plan,status,issued_at,expires_at,created_at').eq('client_id',id.data).order('created_at',{ascending:false}).limit(500),
    db.from('client_payments').select('id,plan,method,status,amount,currency,payment_date,reference_id,receipt_number,created_at').eq('client_id',id.data).order('created_at',{ascending:false}).limit(500),
    db.from('client_activity').select('id,action,details,actor_email,created_at').eq('client_id',id.data).order('created_at',{ascending:false}).limit(1000),
    db.from('client_reminders').select('id,title,notes,due_at,status,created_by,completed_at,created_at').eq('client_id',id.data).order('due_at',{ascending:true}).limit(300),
    db.from('client_communications').select('id,channel,direction,subject,body,occurred_at,actor_email,created_at').eq('client_id',id.data).order('occurred_at',{ascending:false}).limit(500),
    db.from('download_events').select('id,release_id,version,platform,downloaded_at').eq('client_id',id.data).order('downloaded_at',{ascending:false}).limit(500),
    db.from('support_tickets').select('id,subject,category,priority,status,created_at,updated_at').eq('client_id',id.data).order('updated_at',{ascending:false}).limit(200),
    db.from('support_ticket_messages').select('id,ticket_id,author_type,author_email,body,created_at').eq('client_id',id.data).order('created_at',{ascending:false}).limit(1000),
  ]);
  if(clientResult.error||!clientResult.data)return jsonError('Client not found',404);
  const related=[licensesResult,paymentsResult,activityResult,remindersResult,communicationsResult,downloadsResult,ticketsResult,messagesResult];
  if(related.some(result=>result.error))return jsonError('Client 360 data is unavailable. Apply the command-suite migration.',500);
  const client=clientResult.data,licenses=licensesResult.data||[],payments=paymentsResult.data||[],reminders=remindersResult.data||[];
  const clientView={id:client.id,full_name:client.full_name,email:client.email,telegram_username:client.telegram_username,phone:client.phone,country:client.country,plan:client.plan,status:client.status,notes:client.notes,reviewed_at:client.reviewed_at,created_at:client.created_at,updated_at:client.updated_at};
  const canViewPortalProfile=auth.admin.role==='admin';
  let profileMetadata:unknown=null,profileAvailable=canViewPortalProfile;
  if(client.auth_user_id&&canViewPortalProfile){
    const {data:authUser,error:profileError}=await db.auth.admin.getUserById(client.auth_user_id);
    profileAvailable=!profileError&&Boolean(authUser?.user);
    profileMetadata=authUser?.user?.user_metadata||null;
  }
  const lastProfileUpdate=(activityResult.data||[]).find(row=>row.action==='Client profile updated')?.created_at||null;
  const profile={
    ...readClientProfile(profileMetadata,{telegramUsername:client.telegram_username,phoneNumber:client.phone}),
    updatedAt:lastProfileUpdate,
    linked:Boolean(client.auth_user_id),
    available:profileAvailable,
    visible:canViewPortalProfile,
  };
  const timeline=[
    {id:`registration:${client.id}`,type:'registration',title:'Client registered',detail:`${client.plan} plan · ${client.status}`,date:client.created_at,tone:'cyan'},
    ...licenses.map(row=>({id:`license:${row.id}`,type:'license',title:'License issued',detail:`${row.platform} ${row.plan} · ${row.status} · ${row.license_key}`,date:row.created_at||row.issued_at,tone:'gold'})),
    ...payments.map(row=>({id:`payment:${row.id}`,type:'payment',title:`Payment ${row.status}`,detail:`${row.currency} ${Number(row.amount).toLocaleString()} · ${row.method}`,date:row.created_at,tone:['Paid','Manually verified'].includes(row.status)?'green':['Failed','Refunded','Disputed'].includes(row.status)?'red':'orange'})),
    ...(activityResult.data||[]).map(row=>({id:`activity:${row.id}`,type:'activity',title:row.action,detail:row.details||'Operational record updated',date:row.created_at,tone:'blue'})),
    ...(communicationsResult.data||[]).map(row=>({id:`communication:${row.id}`,type:'communication',title:row.subject,detail:`${row.channel} · ${row.direction}`,date:row.occurred_at,tone:'purple'})),
    ...(downloadsResult.data||[]).map(row=>({id:`download:${row.id}`,type:'download',title:`Downloaded Orion ${row.version||'release'}`,detail:row.platform||'Product download',date:row.downloaded_at,tone:'cyan'})),
    ...(ticketsResult.data||[]).map(row=>({id:`ticket:${row.id}`,type:'ticket',title:`Support: ${row.subject}`,detail:`${row.category} · ${row.status}`,date:row.created_at,tone:'orange'})),
    ...(messagesResult.data||[]).map(row=>({id:`ticket-message:${row.id}`,type:'communication',title:`${row.author_type} support message`,detail:String(row.body).slice(0,180),date:row.created_at,tone:row.author_type==='Admin'?'green':'purple'})),
  ].filter(row=>row.date).sort((left,right)=>String(right.date).localeCompare(String(left.date))).slice(0,1200);
  return Response.json({client:clientView,profile,licenses,payments,activity:activityResult.data||[],reminders,communications:communicationsResult.data||[],downloads:downloadsResult.data||[],tickets:ticketsResult.data||[],timeline,health:healthSummary(client,licenses,payments,reminders)}, {headers:{'Cache-Control':'private, no-store'}});
}

export async function POST(request:Request,{params}:{params:Promise<{clientId:string}>}){
  const auth=await requireAdminApi();
  if(!auth.user||!auth.admin||auth.admin.role!=='admin')return jsonError('Admin access required',403);
  const id=clientIdSchema.safeParse((await params).clientId),body=writeSchema.safeParse(await request.json().catch(()=>null));
  if(!id.success)return jsonError('Invalid client',400);
  if(!body.success)return jsonError(body.error.issues[0]?.message||'Invalid action',400);
  const db=createSupabaseAdminClient(),actor=auth.admin.email||auth.user.email||'Orion administrator';
  const {data:client}=await db.from('clients').select('id').eq('id',id.data).maybeSingle();
  if(!client)return jsonError('Client not found',404);
  let error:null|{message:string}=null,activity='Client 360 updated',details='';
  if(body.data.action==='update-notes'){
    ({error}=await db.from('clients').update({notes:body.data.notes||null}).eq('id',id.data));activity='Internal notes updated';details=body.data.notes?'Notes saved':'Notes cleared';
  }else if(body.data.action==='create-reminder'){
    ({error}=await db.from('client_reminders').insert({client_id:id.data,title:body.data.title,notes:body.data.notes||null,due_at:body.data.due_at,created_by:actor}));activity='Admin reminder created';details=`${body.data.title} · due ${body.data.due_at.slice(0,10)}`;
  }else if(body.data.action==='set-reminder-status'){
    ({error}=await db.from('client_reminders').update({status:body.data.status,completed_at:body.data.status==='Done'?new Date().toISOString():null}).eq('id',body.data.reminder_id).eq('client_id',id.data));activity='Admin reminder updated';details=`Reminder marked ${body.data.status}`;
  }else{
    ({error}=await db.from('client_communications').insert({client_id:id.data,channel:body.data.channel,direction:body.data.direction,subject:body.data.subject,body:body.data.body||null,occurred_at:body.data.occurred_at,actor_email:actor}));activity='Communication logged';details=`${body.data.channel} · ${body.data.direction} · ${body.data.subject}`;
  }
  if(error)return jsonError(error.message.includes('does not exist')?'Apply the command-suite migration first.':'Unable to save Client 360 record',500);
  await db.from('client_activity').insert({client_id:id.data,action:activity,details,actor_email:actor});
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}

function healthSummary(client:{status:string;plan:string},licenses:{status:string;expires_at?:string|null}[],payments:{status:string}[],reminders:{status:string;due_at:string}[]){
  let score=100;const reasons:string[]=[];const now=Date.now();
  if(client.status==='Suspended'){score-=65;reasons.push('Account is suspended')}else if(client.status==='Expired'){score-=45;reasons.push('Account is expired')}else if(client.status==='Pending'){score-=20;reasons.push('Account approval is pending')}
  const activeLicense=licenses.some(license=>license.status==='Active'&&(!license.expires_at||new Date(license.expires_at).getTime()>=now));
  if(client.plan!=='Free'&&!activeLicense){score-=25;reasons.push('No current active license')}
  if(payments.some(payment=>payment.status==='Pending')){score-=10;reasons.push('Payment awaiting verification')}
  if(payments.some(payment=>['Failed','Refunded','Disputed'].includes(payment.status))){score-=15;reasons.push('Payment record needs attention')}
  if(reminders.some(reminder=>reminder.status==='Open'&&new Date(reminder.due_at).getTime()<now)){score-=10;reasons.push('Admin reminder is overdue')}
  score=Math.max(0,Math.min(100,score));
  return {score,label:score>=85?'Healthy':score>=60?'Monitor':score>=35?'Needs attention':'Critical',tone:score>=85?'green':score>=60?'gold':score>=35?'orange':'red',reasons:reasons.length?reasons:['No operational issues detected']};
}
