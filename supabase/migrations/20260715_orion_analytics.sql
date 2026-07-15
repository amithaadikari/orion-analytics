create extension if not exists pgcrypto;

create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null unique,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  country text, city text, device_type text, browser text, operating_system text, referrer text, landing_page text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, fbclid text, fbp text, fbc text,
  latest_utm_source text, latest_utm_medium text, latest_utm_campaign text, latest_utm_content text, latest_utm_term text, latest_fbclid text, latest_fbp text, latest_fbc text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(), visitor_id text not null references public.visitors(visitor_id) on delete cascade,
  session_id text not null unique, started_at timestamptz not null default now(), ended_at timestamptz,
  pages_viewed integer not null default 1 check (pages_viewed >= 0), duration_seconds integer not null default 0 check (duration_seconds >= 0), created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), visitor_id text not null references public.visitors(visitor_id) on delete cascade,
  session_id text references public.sessions(session_id) on delete set null,
  event_name text not null check (event_name in ('PageView','ViewContent','TelegramClick','SupportClick','Lead','Purchase')),
  event_id text not null unique, page_url text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(), visitor_id text not null references public.visitors(visitor_id) on delete cascade,
  name text, email text, telegram_username text, country text, utm_campaign text, created_at timestamptz not null default now()
);

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null, role text not null default 'analyst' check (role in ('admin','analyst')), created_at timestamptz not null default now()
);

create table if not exists public.meta_events (
  id uuid primary key default gen_random_uuid(), event_id text not null, event_name text not null,
  source text not null default 'server', status text not null check (status in ('sent','failed')),
  error_message text, sent_at timestamptz not null default now()
);

create index if not exists visitors_last_seen_idx on public.visitors(last_seen desc);
create index if not exists visitors_campaign_idx on public.visitors(utm_campaign);
create index if not exists events_created_at_idx on public.events(created_at desc);
create index if not exists events_name_idx on public.events(event_name);
create index if not exists events_visitor_idx on public.events(visitor_id);
create index if not exists meta_events_sent_at_idx on public.meta_events(sent_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists visitors_updated_at on public.visitors;
create trigger visitors_updated_at before update on public.visitors for each row execute function public.set_updated_at();

alter table public.visitors enable row level security;
alter table public.sessions enable row level security;
alter table public.events enable row level security;
alter table public.leads enable row level security;
alter table public.admins enable row level security;
alter table public.meta_events enable row level security;

create or replace function public.is_approved_admin() returns boolean language sql security definer set search_path = public as $$ select exists(select 1 from public.admins where user_id = auth.uid() and role in ('admin','analyst')); $$;
revoke all on function public.is_approved_admin() from public;
grant execute on function public.is_approved_admin() to authenticated;

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());
drop policy if exists visitors_admin_read on public.visitors;
create policy visitors_admin_read on public.visitors for select to authenticated using (public.is_approved_admin());
drop policy if exists sessions_admin_read on public.sessions;
create policy sessions_admin_read on public.sessions for select to authenticated using (public.is_approved_admin());
drop policy if exists events_admin_read on public.events;
create policy events_admin_read on public.events for select to authenticated using (public.is_approved_admin());
drop policy if exists leads_admin_read on public.leads;
create policy leads_admin_read on public.leads for select to authenticated using (public.is_approved_admin());
drop policy if exists meta_events_admin_read on public.meta_events;
create policy meta_events_admin_read on public.meta_events for select to authenticated using (public.is_approved_admin());

-- Public tracking uses the server-only service role, so there are intentionally no anon insert/read policies.
comment on table public.visitors is 'Anonymous visitor attribution; no raw IP is stored.';
