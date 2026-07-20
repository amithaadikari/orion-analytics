-- Client account-security foundations: authenticator assurance, forward-only
-- security activity, and a real license-reminder email preference.

create or replace function public.has_sufficient_auth_aal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      not exists (
        select 1
        from auth.mfa_factors as factor
        where factor.user_id = auth.uid()
          and factor.factor_type = 'totp'
          and factor.status = 'verified'
      )
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    );
$$;

revoke all on function public.has_sufficient_auth_aal() from public, anon;
grant execute on function public.has_sufficient_auth_aal() to authenticated;

-- Keep every policy which calls is_approved_admin protected when an enrolled
-- administrator is holding only an AAL1 session.
create or replace function public.is_approved_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_sufficient_auth_aal()
    and exists (
      select 1
      from public.admins
      where user_id = auth.uid()
        and role in ('admin', 'analyst')
    );
$$;

revoke all on function public.is_approved_admin() from public, anon;
grant execute on function public.is_approved_admin() to authenticated;

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select to authenticated
  using (user_id = auth.uid() and public.has_sufficient_auth_aal());

drop policy if exists clients_self_read on public.clients;
create policy clients_self_read on public.clients for select to authenticated
  using (auth_user_id = auth.uid() and public.has_sufficient_auth_aal());

drop policy if exists licenses_client_self_read on public.licenses;
create policy licenses_client_self_read on public.licenses for select to authenticated
  using (
    public.has_sufficient_auth_aal()
    and exists (
      select 1 from public.clients
      where clients.id = licenses.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

drop policy if exists client_payments_self_read on public.client_payments;
create policy client_payments_self_read on public.client_payments for select to authenticated
  using (
    public.has_sufficient_auth_aal()
    and exists (
      select 1 from public.clients
      where clients.id = client_payments.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

-- Defense in depth if this migration is applied to a database that still has
-- the pre-20260725 direct client release-source policy.
drop policy if exists product_releases_authenticated_read on public.product_releases;

create table if not exists public.client_account_preferences (
  client_id uuid primary key references public.clients(id) on delete cascade,
  email_license_reminders boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_security_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  session_id uuid,
  event_type text not null check (event_type in (
    'session_started',
    'password_changed',
    'mfa_enabled',
    'mfa_disabled',
    'other_sessions_signed_out'
  )),
  title text not null check (char_length(title) between 2 and 180),
  detail text check (detail is null or char_length(detail) <= 1000),
  browser text check (browser is null or char_length(browser) <= 40),
  os text check (os is null or char_length(os) <= 40),
  device text check (device is null or char_length(device) <= 40),
  country text check (country is null or char_length(country) <= 3),
  ip_hash text check (ip_hash is null or char_length(ip_hash) = 64),
  created_at timestamptz not null default now()
);

create index if not exists client_security_events_timeline_idx
  on public.client_security_events(client_id, created_at desc);
create unique index if not exists client_security_events_session_start_idx
  on public.client_security_events(client_id, session_id)
  where event_type = 'session_started' and session_id is not null;

drop trigger if exists client_account_preferences_updated_at on public.client_account_preferences;
create trigger client_account_preferences_updated_at
  before update on public.client_account_preferences
  for each row execute function public.set_updated_at();

alter table public.client_account_preferences enable row level security;
alter table public.client_security_events enable row level security;

drop policy if exists client_account_preferences_self_read on public.client_account_preferences;
create policy client_account_preferences_self_read on public.client_account_preferences
  for select to authenticated
  using (
    public.has_sufficient_auth_aal()
    and exists (
      select 1 from public.clients
      where clients.id = client_account_preferences.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

drop policy if exists client_account_preferences_admin_read on public.client_account_preferences;
create policy client_account_preferences_admin_read on public.client_account_preferences
  for select to authenticated using (public.is_approved_admin());

drop policy if exists client_security_events_self_read on public.client_security_events;
create policy client_security_events_self_read on public.client_security_events
  for select to authenticated
  using (
    public.has_sufficient_auth_aal()
    and exists (
      select 1 from public.clients
      where clients.id = client_security_events.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

drop policy if exists client_security_events_admin_read on public.client_security_events;
create policy client_security_events_admin_read on public.client_security_events
  for select to authenticated using (public.is_approved_admin());

-- There are deliberately no authenticated INSERT/UPDATE/DELETE policies.
-- Security mutations pass through the rate-limited server route.

-- Keep the canonical client/admin email aligned only after Auth commits an
-- actual email change. A pending Secure Email Change does not update new.email.
create or replace function public.sync_confirmed_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is distinct from new.email and new.email is not null then
    update public.clients
      set email = new.email, updated_at = now()
      where auth_user_id = new.id;
    update public.admins
      set email = new.email
      where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_confirmed_auth_email() from public, anon, authenticated;

drop trigger if exists sync_confirmed_auth_email_after_change on auth.users;
create trigger sync_confirmed_auth_email_after_change
  after update of email on auth.users
  for each row execute function public.sync_confirmed_auth_email();

comment on table public.client_security_events is
  'Forward-only Orion security activity. Never stores raw IPs, full user agents, passwords, OTPs, or TOTP secrets.';
comment on column public.client_security_events.ip_hash is
  'Salted SHA-256 correlation hash; the source IP is not retained.';

-- Event creation and its required notification are one transaction. This RPC
-- is callable only with the server-side service role; the browser never chooses
-- client ids, copy, device attributes, or notification destinations.
create or replace function public.record_client_security_event_atomic(
  p_client_id uuid,
  p_auth_user_id uuid,
  p_session_id uuid,
  p_event_type text,
  p_title text,
  p_detail text,
  p_browser text,
  p_os text,
  p_device text,
  p_country text,
  p_ip_hash text,
  p_notification text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_id uuid;
  was_created boolean;
begin
  if p_event_type not in ('session_started', 'password_changed', 'mfa_enabled', 'mfa_disabled', 'other_sessions_signed_out') then
    raise exception 'Unsupported security event' using errcode = '22023';
  end if;
  if p_event_type = 'session_started' and p_session_id is null then
    raise exception 'A verified session id is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clients
    where id = p_client_id and auth_user_id = p_auth_user_id
  ) then
    raise exception 'Client ownership mismatch' using errcode = '42501';
  end if;

  insert into public.client_security_events (
    client_id, auth_user_id, session_id, event_type, title, detail,
    browser, os, device, country, ip_hash
  ) values (
    p_client_id, p_auth_user_id, p_session_id, p_event_type, p_title, p_detail,
    p_browser, p_os, p_device, p_country, p_ip_hash
  )
  on conflict (client_id, session_id)
    where event_type = 'session_started' and session_id is not null
  do update set session_id = excluded.session_id
  returning id, (xmax = 0) into recorded_id, was_created;

  insert into public.client_notifications (
    client_id, kind, title, message, href, dedupe_key
  ) values (
    p_client_id, 'Security', p_title, p_notification,
    '/portal/settings', 'security-event:' || recorded_id::text
  ) on conflict (dedupe_key) do nothing;

  if was_created then
    insert into public.client_activity (client_id, action, details, actor_email)
    values (p_client_id, p_title, p_detail, p_actor_email);
  end if;

  return jsonb_build_object('id', recorded_id, 'created', was_created);
end;
$$;

revoke all on function public.record_client_security_event_atomic(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_client_security_event_atomic(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text)
  to service_role;

create or replace function public.purge_client_security_events(p_retain_days integer default 180)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count bigint;
begin
  if p_retain_days < 30 or p_retain_days > 730 then
    raise exception 'Retention must be between 30 and 730 days' using errcode = '22023';
  end if;
  delete from public.client_security_events
  where created_at < now() - make_interval(days => p_retain_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_client_security_events(integer) from public, anon, authenticated;
grant execute on function public.purge_client_security_events(integer) to service_role;
