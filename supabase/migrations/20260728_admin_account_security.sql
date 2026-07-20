-- Administrator profile, alert preferences and forward-only security activity.
-- Sensitive security event tables are server-only; browser responses are
-- sanitized by Orion API routes and never expose session or network hashes.

-- The client security API already reads through the server service role. Remove
-- direct authenticated table access so column-blind RLS cannot expose internal
-- correlation fields such as session_id or ip_hash.
drop policy if exists client_security_events_self_read on public.client_security_events;
drop policy if exists client_security_events_admin_read on public.client_security_events;
revoke all on table public.client_security_events from public, anon, authenticated;

create table if not exists public.admin_account_preferences (
  admin_id uuid primary key references public.admins(id) on delete cascade,
  display_name text check (
    display_name is null
    or (display_name = btrim(display_name) and char_length(display_name) between 2 and 80)
  ),
  avatar_key text not null default 'robot-core' check (avatar_key in (
    'forex-gold', 'forex-pulse', 'forex-wave',
    'crypto-bitcoin', 'crypto-coins', 'crypto-orbit',
    'robot-core', 'robot-radar', 'robot-cpu'
  )),
  dashboard_theme text not null default 'royal' check (dashboard_theme in ('royal', 'black')),
  registration_alerts boolean not null default true,
  payment_alerts boolean not null default true,
  license_alerts boolean not null default true,
  support_alerts boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_account_events (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admins(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  session_id uuid,
  event_type text not null check (event_type in (
    'session_started',
    'password_changed',
    'mfa_enabled',
    'mfa_disabled',
    'other_sessions_signed_out',
    'profile_updated',
    'preferences_updated'
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

create index if not exists admin_account_events_timeline_idx
  on public.admin_account_events(admin_id, created_at desc);
create unique index if not exists admin_account_events_session_start_idx
  on public.admin_account_events(auth_user_id, session_id)
  where event_type = 'session_started' and auth_user_id is not null and session_id is not null;
create unique index if not exists admin_account_events_session_security_event_idx
  on public.admin_account_events(auth_user_id, session_id, event_type)
  where event_type in (
    'session_started', 'password_changed', 'mfa_enabled', 'mfa_disabled', 'other_sessions_signed_out'
  ) and auth_user_id is not null and session_id is not null;

drop trigger if exists admin_account_preferences_updated_at on public.admin_account_preferences;
create trigger admin_account_preferences_updated_at
  before update on public.admin_account_preferences
  for each row execute function public.set_updated_at();

alter table public.admin_account_preferences enable row level security;
alter table public.admin_account_events enable row level security;

drop policy if exists admin_account_preferences_self_read on public.admin_account_preferences;
create policy admin_account_preferences_self_read on public.admin_account_preferences
  for select to authenticated
  using (
    public.has_sufficient_auth_aal()
    and exists (
      select 1 from public.admins
      where admins.id = admin_account_preferences.admin_id
        and admins.user_id = auth.uid()
        and admins.role in ('admin', 'analyst')
    )
  );

-- Preferences are safe for a user to read directly, but every mutation remains
-- server-scoped. Security events remain service-role-only because their table
-- includes correlation fields that must never be returned to a browser.
revoke all on table public.admin_account_preferences from public, anon, authenticated;
grant select on table public.admin_account_preferences to authenticated;
revoke all on table public.admin_account_events from public, anon, authenticated;

comment on table public.admin_account_events is
  'Forward-only administrator account activity. Raw IPs, full user agents, passwords, OTPs and TOTP secrets are never stored.';
comment on column public.admin_account_events.ip_hash is
  'Salted SHA-256 correlation hash; the source IP is not retained.';

create or replace function public.record_admin_account_event_atomic(
  p_admin_id uuid,
  p_auth_user_id uuid,
  p_session_id uuid,
  p_event_type text,
  p_browser text,
  p_os text,
  p_device text,
  p_country text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_id uuid;
  was_created boolean;
  event_title text;
  event_detail text;
  admin_email text;
begin
  if p_event_type not in (
    'session_started', 'password_changed', 'mfa_enabled', 'mfa_disabled',
    'other_sessions_signed_out', 'profile_updated', 'preferences_updated'
  ) then
    raise exception 'Unsupported administrator security event' using errcode = '22023';
  end if;
  if p_event_type = 'session_started' and p_session_id is null then
    raise exception 'A verified session id is required' using errcode = '22023';
  end if;

  select email into admin_email
  from public.admins
  where id = p_admin_id
    and user_id = p_auth_user_id
    and role in ('admin', 'analyst');
  if admin_email is null then
    raise exception 'Administrator ownership mismatch' using errcode = '42501';
  end if;

  event_title := case p_event_type
    when 'session_started' then 'New administrator sign-in'
    when 'password_changed' then 'Administrator password update reported'
    when 'mfa_enabled' then 'Authenticator protection enabled'
    when 'mfa_disabled' then 'Authenticator protection removed'
    when 'other_sessions_signed_out' then 'Other-session sign-out reported'
    when 'profile_updated' then 'Administrator profile updated'
    else 'Administrator preferences updated'
  end;
  event_detail := case p_event_type
    when 'session_started' then 'A successful Orion administrator session was opened.'
    when 'password_changed' then 'This Orion session reported a recent Supabase account password update. Supabase Auth logs remain authoritative.'
    when 'mfa_enabled' then 'A verified authenticator was added to the administrator account.'
    when 'mfa_disabled' then 'A verified authenticator was removed from the administrator account.'
    when 'other_sessions_signed_out' then 'This Orion session reported a successful request to revoke other refresh sessions. Supabase Auth logs remain authoritative.'
    when 'profile_updated' then 'The administrator display identity was updated.'
    else 'Administrator dashboard preferences were updated.'
  end;

  insert into public.admin_account_events (
    admin_id, auth_user_id, actor_email, session_id, event_type, title, detail,
    browser, os, device, country, ip_hash
  ) values (
    p_admin_id, p_auth_user_id, admin_email, p_session_id, p_event_type, event_title, event_detail,
    p_browser, p_os, p_device, p_country, p_ip_hash
  )
  on conflict do nothing
  returning id into recorded_id;

  was_created := recorded_id is not null;
  if recorded_id is null and p_session_id is not null then
    select id into recorded_id
    from public.admin_account_events
    where auth_user_id = p_auth_user_id
      and session_id = p_session_id
      and event_type = p_event_type
    order by created_at desc
    limit 1;
  end if;
  if recorded_id is null then
    raise exception 'Administrator event could not be recorded' using errcode = '23505';
  end if;

  return jsonb_build_object('id', recorded_id, 'created', was_created);
end;
$$;

revoke all on function public.record_admin_account_event_atomic(uuid, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_admin_account_event_atomic(uuid, uuid, uuid, text, text, text, text, text, text)
  to service_role;

create or replace function public.purge_admin_account_events(p_retain_days integer default 180)
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
  delete from public.admin_account_events
  where created_at < now() - make_interval(days => p_retain_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_admin_account_events(integer) from public, anon, authenticated;
grant execute on function public.purge_admin_account_events(integer) to service_role;
