-- Orion command-suite foundations: actionable reviews, Client 360, revenue
-- goals, client notifications, support tickets and protected-download history.

alter table public.clients
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

create table if not exists public.revenue_goals (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  currency text not null check (char_length(currency) = 3),
  target_amount numeric(14,2) not null check (target_amount > 0),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_month, currency),
  check (period_month = date_trunc('month', period_month)::date)
);

create table if not exists public.client_reminders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 180),
  notes text,
  due_at timestamptz not null,
  status text not null default 'Open' check (status in ('Open','Done','Dismissed')),
  created_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_communications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  channel text not null check (channel in ('Email','Telegram','Phone','Portal','System','Other')),
  direction text not null default 'Internal' check (direction in ('Inbound','Outbound','Internal')),
  subject text not null check (char_length(subject) between 2 and 180),
  body text,
  occurred_at timestamptz not null default now(),
  actor_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null default 'Account',
  title text not null check (char_length(title) between 2 and 180),
  message text not null check (char_length(message) between 2 and 1000),
  href text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  subject text not null check (char_length(subject) between 4 and 180),
  category text not null default 'General' check (category in ('General','License','Payment','Setup','Technical')),
  priority text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  status text not null default 'Open' check (status in ('Open','Waiting on client','In progress','Resolved','Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  author_type text not null check (author_type in ('Client','Admin','System')),
  author_email text,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_id_client_unique') then
    alter table public.support_tickets add constraint support_tickets_id_client_unique unique (id, client_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_ticket_owner_fk') then
    alter table public.support_ticket_messages
      add constraint support_messages_ticket_owner_fk
      foreign key (ticket_id, client_id) references public.support_tickets(id, client_id) on delete cascade;
  end if;
end;
$$;

create table if not exists public.download_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid references public.product_releases(id) on delete set null,
  version text,
  platform text,
  user_agent text,
  downloaded_at timestamptz not null default now()
);

create index if not exists clients_reviewed_idx on public.clients(reviewed_at, created_at desc);
create index if not exists revenue_goals_period_idx on public.revenue_goals(period_month desc, currency);
create index if not exists client_reminders_due_idx on public.client_reminders(client_id, status, due_at);
create index if not exists client_communications_timeline_idx on public.client_communications(client_id, occurred_at desc);
create index if not exists client_notifications_timeline_idx on public.client_notifications(client_id, read_at, created_at desc);
create index if not exists support_tickets_client_idx on public.support_tickets(client_id, status, updated_at desc);
create index if not exists support_ticket_messages_timeline_idx on public.support_ticket_messages(ticket_id, created_at);
create index if not exists download_events_client_idx on public.download_events(client_id, downloaded_at desc);

drop trigger if exists revenue_goals_updated_at on public.revenue_goals;
create trigger revenue_goals_updated_at before update on public.revenue_goals for each row execute function public.set_updated_at();
drop trigger if exists client_reminders_updated_at on public.client_reminders;
create trigger client_reminders_updated_at before update on public.client_reminders for each row execute function public.set_updated_at();
drop trigger if exists support_tickets_updated_at on public.support_tickets;
create trigger support_tickets_updated_at before update on public.support_tickets for each row execute function public.set_updated_at();

alter table public.revenue_goals enable row level security;
alter table public.client_reminders enable row level security;
alter table public.client_communications enable row level security;
alter table public.client_notifications enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.download_events enable row level security;

drop policy if exists revenue_goals_admin_read on public.revenue_goals;
create policy revenue_goals_admin_read on public.revenue_goals for select to authenticated using (public.is_approved_admin());
drop policy if exists client_reminders_admin_read on public.client_reminders;
create policy client_reminders_admin_read on public.client_reminders for select to authenticated using (public.is_approved_admin());
drop policy if exists client_communications_admin_read on public.client_communications;
create policy client_communications_admin_read on public.client_communications for select to authenticated using (public.is_approved_admin());
drop policy if exists client_notifications_admin_read on public.client_notifications;
create policy client_notifications_admin_read on public.client_notifications for select to authenticated using (public.is_approved_admin());
drop policy if exists support_tickets_admin_read on public.support_tickets;
create policy support_tickets_admin_read on public.support_tickets for select to authenticated using (public.is_approved_admin());
drop policy if exists support_ticket_messages_admin_read on public.support_ticket_messages;
create policy support_ticket_messages_admin_read on public.support_ticket_messages for select to authenticated using (public.is_approved_admin());
drop policy if exists download_events_admin_read on public.download_events;
create policy download_events_admin_read on public.download_events for select to authenticated using (public.is_approved_admin());

-- Keep portal visibility aligned with the UI and download gateway: a license
-- remains valid through the end of its recorded calendar expiry date.
drop policy if exists product_releases_authenticated_read on public.product_releases;
create policy product_releases_authenticated_read on public.product_releases for select to authenticated
  using (
    published = true and exists (
      select 1
      from public.clients c
      join public.licenses l on l.client_id = c.id
      where c.auth_user_id = auth.uid()
        and c.status = 'Active'
        and l.status = 'Active'
        and (l.expires_at is null or l.expires_at::date >= current_date)
        and (product_releases.platform = 'Both' or product_releases.platform = l.platform)
    )
  );

-- A manually suspended account must never be reactivated by a payment or
-- license trigger. Reactivation is an explicit admin action.
create or replace function public.sync_client_paid_access(target_client uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_plan text;
  changed_count integer;
begin
  select l.plan
    into matched_plan
  from public.licenses l
  join public.client_payments p
    on p.client_id = l.client_id
   and p.plan = l.plan
   and (p.license_id is null or p.license_id = l.id)
  where l.client_id = target_client
    and l.status = 'Active'
    and (l.expires_at is null or l.expires_at::date >= current_date)
    and p.status in ('Paid', 'Manually verified')
  order by case l.plan when 'Lifetime' then 3 when 'Premium' then 2 when 'Basic' then 1 else 0 end desc,
    p.payment_date desc nulls last, p.created_at desc
  limit 1;

  if matched_plan is null then return; end if;

  update public.clients
     set plan = matched_plan,
         status = 'Active',
         updated_at = now()
   where id = target_client
     and status <> 'Suspended'
     and (plan is distinct from matched_plan or status is distinct from 'Active');

  get diagnostics changed_count = row_count;
  if changed_count > 0 then
    insert into public.client_activity (client_id, action, details, actor_email)
    values (target_client, 'Client access activated automatically', matched_plan || ' plan · completed payment and active license verified', 'system');
  end if;
end;
$$;

-- Action Center mutations run inside database transactions so the business
-- change and its audit record always succeed or fail together.
create or replace function public.action_approve_registration(p_client_id uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.clients%rowtype;
  evidence_plan text;
  next_status text;
begin
  select * into target from public.clients where id = p_client_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if target.reviewed_at is not null then return jsonb_build_object('ok', false, 'code', 'already_reviewed'); end if;

  next_status := target.status;
  if target.plan <> 'Free' then
    select l.plan into evidence_plan
    from public.licenses l
    join public.client_payments p
      on p.client_id = l.client_id
     and p.plan = l.plan
     and (p.license_id is null or p.license_id = l.id)
    where l.client_id = target.id
      and l.plan = target.plan
      and l.status = 'Active'
      and (l.expires_at is null or l.expires_at::date >= current_date)
      and p.status in ('Paid', 'Manually verified')
    limit 1;
    if evidence_plan is null then return jsonb_build_object('ok', false, 'code', 'evidence_required'); end if;
    next_status := 'Active';
  end if;

  update public.clients
  set status = next_status, reviewed_at = now(), reviewed_by = p_actor
  where id = target.id;
  insert into public.client_activity (client_id, action, details, actor_email)
  values (target.id, 'Registration approved', target.plan || ' plan · ' || next_status, p_actor);
  return jsonb_build_object('ok', true, 'message', case when target.plan = 'Free' then 'Registration marked as reviewed.' else 'Registration approved and activated.' end);
end;
$$;

create or replace function public.action_verify_payment(p_payment_id uuid, p_payment_date date, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target public.client_payments%rowtype;
begin
  select * into target from public.client_payments where id = p_payment_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if target.status <> 'Pending' then return jsonb_build_object('ok', false, 'code', 'already_processed', 'status', target.status); end if;
  if target.amount <= 0 then return jsonb_build_object('ok', false, 'code', 'invalid_amount'); end if;

  update public.client_payments
  set status = 'Manually verified', payment_date = coalesce(target.payment_date, p_payment_date)
  where id = target.id;
  insert into public.client_activity (client_id, action, details, actor_email)
  values (target.client_id, 'Payment verified from action center', target.currency || ' ' || target.amount::text || ' · ' || target.method, p_actor);
  return jsonb_build_object('ok', true, 'message', 'Payment verified and the client record was refreshed.');
end;
$$;

create or replace function public.action_renew_license(p_license_id uuid, p_extension_days integer, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.licenses%rowtype;
  extension_days integer;
  next_expiry timestamptz;
  renewal_label text;
begin
  select * into target from public.licenses where id = p_license_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  extension_days := coalesce(p_extension_days, case target.plan when 'Premium' then 90 when 'Lifetime' then null else 30 end);
  if extension_days is not null and extension_days not in (30, 90, 365) then
    return jsonb_build_object('ok', false, 'code', 'invalid_extension');
  end if;
  if extension_days is null then
    next_expiry := null;
    renewal_label := 'Lifetime access';
  else
    next_expiry := (greatest(coalesce(target.expires_at::date, current_date), current_date) + extension_days)::timestamptz + interval '1 day' - interval '1 millisecond';
    renewal_label := extension_days::text || '-day extension';
  end if;

  update public.licenses set status = 'Active', expires_at = next_expiry where id = target.id;
  insert into public.client_activity (client_id, action, details, actor_email)
  values (target.client_id, 'License renewed from action center', target.license_key || ' · ' || renewal_label, p_actor);
  return jsonb_build_object('ok', true, 'message', case when extension_days is null then 'Lifetime license reactivated.' else 'License extended by ' || extension_days::text || ' days.' end);
end;
$$;

create or replace function public.action_reactivate_client(p_client_id uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.clients%rowtype;
  evidence_plan text;
begin
  select * into target from public.clients where id = p_client_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if target.status <> 'Suspended' then return jsonb_build_object('ok', false, 'code', 'not_suspended', 'status', target.status); end if;

  select l.plan into evidence_plan
  from public.licenses l
  join public.client_payments p
    on p.client_id = l.client_id
   and p.plan = l.plan
   and (p.license_id is null or p.license_id = l.id)
  where l.client_id = target.id
    and l.status = 'Active'
    and (l.expires_at is null or l.expires_at::date >= current_date)
    and p.status in ('Paid', 'Manually verified')
  order by case l.plan when 'Lifetime' then 3 when 'Premium' then 2 when 'Basic' then 1 else 0 end desc,
    p.payment_date desc nulls last, p.created_at desc
  limit 1;
  if evidence_plan is null then return jsonb_build_object('ok', false, 'code', 'evidence_required'); end if;

  update public.clients set status = 'Active', plan = evidence_plan where id = target.id;
  insert into public.client_activity (client_id, action, details, actor_email)
  values (target.id, 'Client reactivated from action center', evidence_plan || ' plan · eligibility verified', p_actor);
  return jsonb_build_object('ok', true, 'message', 'Client reactivated after payment and license checks passed.');
end;
$$;

revoke all on function public.action_approve_registration(uuid, text) from public, anon, authenticated;
revoke all on function public.action_verify_payment(uuid, date, text) from public, anon, authenticated;
revoke all on function public.action_renew_license(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.action_reactivate_client(uuid, text) from public, anon, authenticated;
grant execute on function public.action_approve_registration(uuid, text) to service_role;
grant execute on function public.action_verify_payment(uuid, date, text) to service_role;
grant execute on function public.action_renew_license(uuid, integer, text) to service_role;
grant execute on function public.action_reactivate_client(uuid, text) to service_role;

create or replace function public.create_support_ticket_atomic(
  p_client_id uuid,
  p_subject text,
  p_category text,
  p_priority text,
  p_author_type text,
  p_author_email text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_ticket_id uuid;
begin
  insert into public.support_tickets (client_id, subject, category, priority, status)
  values (p_client_id, p_subject, p_category, p_priority, 'Open')
  returning id into new_ticket_id;
  insert into public.support_ticket_messages (ticket_id, client_id, author_type, author_email, body)
  values (new_ticket_id, p_client_id, p_author_type, p_author_email, p_message);
  insert into public.client_activity (client_id, action, details, actor_email)
  values (p_client_id, 'Support ticket opened', p_category || ' · ' || p_subject, coalesce(p_author_email, lower(p_author_type)));
  return new_ticket_id;
end;
$$;

create or replace function public.update_support_ticket_atomic(
  p_ticket_id uuid,
  p_client_id uuid,
  p_message text,
  p_author_type text,
  p_author_email text,
  p_status text,
  p_priority text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_status text;
begin
  select status into current_status from public.support_tickets where id = p_ticket_id and client_id = p_client_id for update;
  if not found then return false; end if;
  if p_author_type = 'Client' and current_status = 'Closed' and p_message is not null then return false; end if;
  if p_message is not null then
    insert into public.support_ticket_messages (ticket_id, client_id, author_type, author_email, body)
    values (p_ticket_id, p_client_id, p_author_type, p_author_email, p_message);
  end if;
  update public.support_tickets
  set status = p_status,
      priority = p_priority,
      closed_at = case when p_status = 'Closed' then now() else null end
  where id = p_ticket_id and client_id = p_client_id;
  insert into public.client_activity (client_id, action, details, actor_email)
  values (p_client_id, case when p_message is null then 'Support ticket updated' else 'Support ticket replied' end, p_status, coalesce(p_author_email, lower(p_author_type)));
  return true;
end;
$$;

revoke all on function public.create_support_ticket_atomic(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_support_ticket_atomic(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_support_ticket_atomic(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.update_support_ticket_atomic(uuid, uuid, text, text, text, text, text) to service_role;

create or replace function public.notify_client_payment_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
    values (
      new.client_id,
      'Payment',
      case when new.status in ('Paid','Manually verified') then 'Payment confirmed' else 'Payment status updated' end,
      'Your ' || new.plan || ' payment is now marked ' || new.status || '.',
      '/portal#payments',
      'payment:' || new.id::text || ':' || lower(replace(new.status, ' ', '-'))
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_client_after_payment_change on public.client_payments;
create trigger notify_client_after_payment_change after insert or update of status on public.client_payments
for each row execute function public.notify_client_payment_status();

create or replace function public.notify_client_license_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status or old.expires_at is distinct from new.expires_at then
    insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
    values (
      new.client_id,
      'License',
      case when tg_op = 'INSERT' then 'License assigned' when new.status = 'Active' then 'License updated' else 'License status updated' end,
      'Your ' || new.platform || ' ' || new.plan || ' license is now ' || new.status || '.',
      '/portal#licenses',
      'license:' || new.id::text || ':' || lower(new.status) || ':' || coalesce(to_char(new.expires_at, 'YYYY-MM-DD'), 'lifetime')
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_client_after_license_change on public.licenses;
create trigger notify_client_after_license_change after insert or update of status, expires_at on public.licenses
for each row execute function public.notify_client_license_change();

create or replace function public.notify_client_ticket_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_type = 'Admin' then
    insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
    values (new.client_id, 'Support', 'New support reply', 'Orion support replied to your ticket.', '/portal#support', 'ticket-message:' || new.id::text)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_client_after_ticket_reply on public.support_ticket_messages;
create trigger notify_client_after_ticket_reply after insert on public.support_ticket_messages
for each row execute function public.notify_client_ticket_reply();

-- Existing non-pending clients are operational records, not unreviewed leads.
-- Future registrations keep reviewed_at null and enter the Action Center queue.
update public.clients
set reviewed_at = coalesce(reviewed_at, updated_at, created_at),
    reviewed_by = coalesce(reviewed_by, 'system-backfill')
where status <> 'Pending' and reviewed_at is null;
