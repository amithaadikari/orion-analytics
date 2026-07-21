-- Orion V5.2 live trading telemetry.
--
-- The MT5 endpoint is intentionally write-only and untrusted. It never supplies
-- a client, license, plan, database account, or installation row identifier.
-- One security-definer RPC validates the existing license binding and commits a
-- complete account snapshot, complete open-position snapshot, and raw MT5 deal
-- page atomically. Browser roles cannot read or write these tables directly.

create extension if not exists pgcrypto;

-- Prove the platform as well as the owner when a Real account is attached to a
-- telemetry scope. The id is already unique, so this is additive and safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_trading_accounts'::regclass
      and conname = 'trading_accounts_id_client_platform_unique'
  ) then
    alter table public.client_trading_accounts
      add constraint trading_accounts_id_client_platform_unique
      unique (id, client_id, platform);
  end if;
end;
$$;

create table if not exists public.orion_telemetry_account_scopes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  account_type text not null,
  trading_account_id uuid,
  demo_account_id uuid,
  account_number text not null,
  broker_server text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orion_telemetry_scopes_client_fk
    foreign key (client_id) references public.clients(id) on delete cascade,
  constraint orion_telemetry_scopes_license_owner_fk
    foreign key (license_id, client_id, platform)
    references public.licenses(id, client_id, platform)
    on update no action on delete no action deferrable initially deferred,
  constraint orion_telemetry_scopes_real_owner_fk
    foreign key (trading_account_id, client_id, platform)
    references public.client_trading_accounts(id, client_id, platform)
    on update no action on delete no action deferrable initially deferred,
  constraint orion_telemetry_scopes_demo_owner_fk
    foreign key (demo_account_id, license_id, client_id, platform)
    references public.license_demo_accounts(id, license_id, client_id, platform)
    on update no action on delete no action deferrable initially deferred,
  constraint orion_telemetry_scopes_platform_check
    check (platform in ('MT4', 'MT5')),
  constraint orion_telemetry_scopes_type_check
    check (account_type in ('Demo', 'Real')),
  constraint orion_telemetry_scopes_account_check
    check (account_number = btrim(account_number) and account_number ~ '^[0-9]{4,24}$'),
  constraint orion_telemetry_scopes_broker_check
    check (broker_server = btrim(broker_server) and char_length(broker_server) between 2 and 160),
  constraint orion_telemetry_scopes_identity_check
    check (
      (account_type = 'Real' and trading_account_id is not null and demo_account_id is null)
      or
      (account_type = 'Demo' and trading_account_id is null and demo_account_id is not null)
    ),
  constraint orion_telemetry_scopes_id_owner_unique
    unique (id, client_id, license_id, platform)
);

create unique index if not exists orion_telemetry_scopes_real_unique_idx
  on public.orion_telemetry_account_scopes(license_id, trading_account_id)
  where account_type = 'Real';
create unique index if not exists orion_telemetry_scopes_demo_unique_idx
  on public.orion_telemetry_account_scopes(license_id, demo_account_id)
  where account_type = 'Demo';
create index if not exists orion_telemetry_scopes_client_idx
  on public.orion_telemetry_account_scopes(client_id, last_seen_at desc);

create table if not exists public.orion_telemetry_streams (
  id uuid primary key default gen_random_uuid(),
  account_scope_id uuid not null,
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  installation_id uuid not null,
  binding_version integer not null,
  status text not null default 'Active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_captured_at timestamptz,
  last_sequence bigint not null default 0,
  ea_version text not null,
  terminal_build integer not null,
  terminal_connected boolean not null default false,
  terminal_trade_allowed boolean not null default false,
  mql_trade_allowed boolean not null default false,
  chart_symbol text not null,
  chart_period_minutes integer not null,
  license_state text not null,
  currency text,
  balance numeric(24,8),
  equity numeric(24,8),
  margin numeric(24,8),
  margin_level numeric(24,8),
  floating_profit numeric(24,8),
  open_position_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orion_telemetry_streams_scope_owner_fk
    foreign key (account_scope_id, client_id, license_id, platform)
    references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_telemetry_streams_installation_owner_fk
    foreign key (installation_id, license_id, client_id, platform)
    references public.license_installations(id, license_id, client_id, platform)
    on update no action on delete no action deferrable initially deferred,
  constraint orion_telemetry_streams_platform_check check (platform in ('MT4', 'MT5')),
  constraint orion_telemetry_streams_binding_check check (binding_version >= 0),
  constraint orion_telemetry_streams_status_check check (status in ('Active', 'Superseded')),
  constraint orion_telemetry_streams_sequence_check check (last_sequence >= 0),
  constraint orion_telemetry_streams_version_check
    check (ea_version = btrim(ea_version) and char_length(ea_version) between 1 and 24),
  constraint orion_telemetry_streams_terminal_build_check check (terminal_build > 0),
  constraint orion_telemetry_streams_chart_symbol_check
    check (chart_symbol = btrim(chart_symbol) and char_length(chart_symbol) between 1 and 64),
  constraint orion_telemetry_streams_chart_period_check check (chart_period_minutes > 0),
  constraint orion_telemetry_streams_license_state_check
    check (license_state = btrim(license_state) and char_length(license_state) between 1 and 64),
  constraint orion_telemetry_streams_currency_check
    check (currency is null or currency ~ '^[A-Z0-9]{3,8}$'),
  constraint orion_telemetry_streams_position_count_check
    check (open_position_count between 0 and 100),
  constraint orion_telemetry_streams_scope_binding_unique
    unique (account_scope_id, binding_version),
  constraint orion_telemetry_streams_id_owner_unique
    unique (id, account_scope_id, client_id, license_id)
);

create index if not exists orion_telemetry_streams_client_live_idx
  on public.orion_telemetry_streams(client_id, last_seen_at desc)
  where status = 'Active';
create index if not exists orion_telemetry_streams_license_idx
  on public.orion_telemetry_streams(license_id, binding_version desc);

create table if not exists public.orion_telemetry_batches (
  request_id text primary key,
  stream_id uuid not null,
  account_scope_id uuid not null,
  client_id uuid not null,
  license_id uuid not null,
  sequence bigint not null,
  payload_hash text not null,
  position_snapshot_id text not null,
  sent_at timestamptz not null,
  received_at timestamptz not null default now(),
  plan_at_ingest text not null,
  position_count integer not null,
  deal_count integer not null,
  ack_deal_time_msc numeric(20,0) not null,
  ack_deal_ticket numeric(20,0) not null,
  constraint orion_telemetry_batches_stream_owner_fk
    foreign key (stream_id, account_scope_id, client_id, license_id)
    references public.orion_telemetry_streams(id, account_scope_id, client_id, license_id)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_telemetry_batches_request_check check (request_id ~ '^[0-9a-f]{64}$'),
  constraint orion_telemetry_batches_sequence_check check (sequence > 0),
  constraint orion_telemetry_batches_payload_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint orion_telemetry_batches_snapshot_check check (position_snapshot_id ~ '^[0-9a-f]{64}$'),
  constraint orion_telemetry_batches_plan_check check (plan_at_ingest in ('Basic', 'Premium', 'Lifetime')),
  constraint orion_telemetry_batches_position_count_check check (position_count between 0 and 100),
  constraint orion_telemetry_batches_deal_count_check check (deal_count between 0 and 40),
  constraint orion_telemetry_batches_cursor_check
    check (ack_deal_time_msc >= 0 and ack_deal_ticket >= 0),
  constraint orion_telemetry_batches_stream_sequence_unique unique (stream_id, sequence),
  constraint orion_telemetry_batches_scope_snapshot_unique unique (account_scope_id, position_snapshot_id)
);

create index if not exists orion_telemetry_batches_stream_idx
  on public.orion_telemetry_batches(stream_id, received_at desc);
create index if not exists orion_telemetry_batches_received_idx
  on public.orion_telemetry_batches(received_at);

create table if not exists public.orion_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  stream_id uuid not null,
  account_scope_id uuid not null,
  client_id uuid not null,
  license_id uuid not null,
  plan_at_ingest text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  currency text not null,
  leverage integer not null,
  balance numeric(24,8) not null,
  equity numeric(24,8) not null,
  credit numeric(24,8) not null,
  margin numeric(24,8) not null,
  free_margin numeric(24,8) not null,
  margin_level numeric(24,8) not null,
  floating_profit numeric(24,8) not null,
  constraint orion_account_snapshots_stream_owner_fk
    foreign key (stream_id, account_scope_id, client_id, license_id)
    references public.orion_telemetry_streams(id, account_scope_id, client_id, license_id)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_account_snapshots_request_check check (request_id ~ '^[0-9a-f]{64}$'),
  constraint orion_account_snapshots_plan_check check (plan_at_ingest in ('Basic', 'Premium', 'Lifetime')),
  constraint orion_account_snapshots_currency_check check (currency ~ '^[A-Z0-9]{3,8}$'),
  constraint orion_account_snapshots_leverage_check check (leverage between 0 and 10000000)
);

create index if not exists orion_account_snapshots_client_idx
  on public.orion_account_snapshots(client_id, observed_at desc);
create index if not exists orion_account_snapshots_scope_idx
  on public.orion_account_snapshots(account_scope_id, observed_at desc);
create index if not exists orion_account_snapshots_observed_brin_idx
  on public.orion_account_snapshots using brin(observed_at);

create table if not exists public.orion_open_positions (
  account_scope_id uuid not null,
  position_ticket text not null,
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  stream_id uuid not null,
  last_seen_request_id text not null,
  position_id text not null,
  symbol text not null,
  side text not null,
  magic text not null,
  opened_at timestamptz not null,
  volume numeric(24,8) not null,
  open_price numeric(28,10) not null,
  current_price numeric(28,10) not null,
  stop_loss numeric(28,10) not null,
  take_profit numeric(28,10) not null,
  swap numeric(24,8) not null,
  profit numeric(24,8) not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_scope_id, position_ticket),
  constraint orion_open_positions_scope_owner_fk
    foreign key (account_scope_id, client_id, license_id, platform)
    references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_open_positions_stream_owner_fk
    foreign key (stream_id, account_scope_id, client_id, license_id)
    references public.orion_telemetry_streams(id, account_scope_id, client_id, license_id)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_open_positions_ticket_check check (position_ticket ~ '^(0|[1-9][0-9]{0,19})$'),
  constraint orion_open_positions_position_id_check check (position_id ~ '^(0|[1-9][0-9]{0,19})$'),
  constraint orion_open_positions_platform_check check (platform in ('MT4', 'MT5')),
  constraint orion_open_positions_symbol_check
    check (symbol = btrim(symbol) and char_length(symbol) between 1 and 64),
  constraint orion_open_positions_side_check check (side in ('Buy', 'Sell')),
  constraint orion_open_positions_magic_check check (magic ~ '^-?(0|[1-9][0-9]{0,18})$'),
  constraint orion_open_positions_volume_check check (volume > 0),
  constraint orion_open_positions_prices_check
    check (open_price >= 0 and current_price >= 0 and stop_loss >= 0 and take_profit >= 0),
  constraint orion_open_positions_request_check check (last_seen_request_id ~ '^[0-9a-f]{64}$')
);

create index if not exists orion_open_positions_client_idx
  on public.orion_open_positions(client_id, opened_at desc);
create index if not exists orion_open_positions_scope_idx
  on public.orion_open_positions(account_scope_id, opened_at desc);

create table if not exists public.orion_closed_deals (
  id uuid primary key default gen_random_uuid(),
  account_scope_id uuid not null,
  deal_ticket text not null,
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  first_seen_stream_id uuid not null,
  first_seen_request_id text not null,
  plan_at_ingest text not null,
  order_ticket text not null,
  position_id text not null,
  deal_time_msc numeric(20,0) not null,
  deal_time timestamptz not null,
  symbol text not null,
  side text not null,
  entry text not null,
  reason text not null,
  magic text not null,
  volume numeric(24,8) not null,
  price numeric(28,10) not null,
  stop_loss numeric(28,10) not null,
  take_profit numeric(28,10) not null,
  commission numeric(24,8) not null,
  swap numeric(24,8) not null,
  fee numeric(24,8) not null,
  profit numeric(24,8) not null,
  net_profit numeric(24,8) generated always as (commission + swap + fee + profit) stored,
  received_at timestamptz not null default now(),
  constraint orion_closed_deals_scope_owner_fk
    foreign key (account_scope_id, client_id, license_id, platform)
    references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_closed_deals_stream_owner_fk
    foreign key (first_seen_stream_id, account_scope_id, client_id, license_id)
    references public.orion_telemetry_streams(id, account_scope_id, client_id, license_id)
    on update no action on delete cascade deferrable initially deferred,
  constraint orion_closed_deals_scope_ticket_unique unique (account_scope_id, deal_ticket),
  constraint orion_closed_deals_ticket_check check (deal_ticket ~ '^(0|[1-9][0-9]{0,19})$'),
  constraint orion_closed_deals_order_check check (order_ticket ~ '^(0|[1-9][0-9]{0,19})$'),
  constraint orion_closed_deals_position_check check (position_id ~ '^(0|[1-9][0-9]{0,19})$'),
  constraint orion_closed_deals_time_check check (deal_time_msc >= 0),
  constraint orion_closed_deals_platform_check check (platform in ('MT4', 'MT5')),
  constraint orion_closed_deals_symbol_check
    check (symbol = btrim(symbol) and char_length(symbol) between 1 and 64),
  constraint orion_closed_deals_side_check check (side in ('Buy', 'Sell')),
  constraint orion_closed_deals_entry_check check (entry in ('In', 'Out', 'InOut', 'OutBy')),
  constraint orion_closed_deals_reason_check
    check (reason = btrim(reason) and char_length(reason) between 1 and 64),
  constraint orion_closed_deals_magic_check check (magic ~ '^-?(0|[1-9][0-9]{0,18})$'),
  constraint orion_closed_deals_volume_check check (volume >= 0),
  constraint orion_closed_deals_prices_check
    check (price >= 0 and stop_loss >= 0 and take_profit >= 0),
  constraint orion_closed_deals_request_check check (first_seen_request_id ~ '^[0-9a-f]{64}$'),
  constraint orion_closed_deals_plan_check check (plan_at_ingest in ('Basic', 'Premium', 'Lifetime'))
);

create index if not exists orion_closed_deals_client_idx
  on public.orion_closed_deals(client_id, deal_time desc, deal_time_msc desc);
create index if not exists orion_closed_deals_scope_idx
  on public.orion_closed_deals(account_scope_id, deal_time_msc desc);
create index if not exists orion_closed_deals_time_brin_idx
  on public.orion_closed_deals using brin(deal_time);

create table if not exists public.orion_telemetry_rate_limits (
  dimension text not null,
  identifier_hash text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (dimension, identifier_hash),
  constraint orion_telemetry_rate_dimension_check
    check (dimension in ('IP', 'License', 'Installation')),
  constraint orion_telemetry_rate_hash_check check (identifier_hash ~ '^[0-9a-f]{64}$'),
  constraint orion_telemetry_rate_count_check check (attempt_count >= 1)
);

create index if not exists orion_telemetry_rate_updated_idx
  on public.orion_telemetry_rate_limits(updated_at);

create table if not exists public.orion_telemetry_rejections (
  id bigint generated always as identity primary key,
  rejected_at timestamptz not null default now(),
  code text not null,
  request_ip_hash text not null,
  key_hash text not null,
  installation_hash text not null,
  constraint orion_telemetry_rejections_code_check check (code in (
    'INVALID_REQUEST', 'INVALID_LICENSE', 'LICENSE_INACTIVE',
    'INSTALLATION_NOT_REGISTERED', 'INSTALLATION_MISMATCH',
    'ACCOUNT_NOT_REGISTERED', 'ACCOUNT_MISMATCH',
    'DEMO_ACCOUNT_NOT_REGISTERED', 'DEMO_ACCOUNT_MISMATCH',
    'BINDING_CHANGED', 'STALE_SEQUENCE', 'REQUEST_ID_CONFLICT',
    'PAYLOAD_TIME_INVALID', 'POSITION_SNAPSHOT_CONFLICT', 'DEAL_CONFLICT',
    'TELEMETRY_RATE_LIMIT'
  )),
  constraint orion_telemetry_rejections_ip_check check (request_ip_hash ~ '^[0-9a-f]{64}$'),
  constraint orion_telemetry_rejections_key_check check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint orion_telemetry_rejections_installation_check check (installation_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists orion_telemetry_rejections_time_idx
  on public.orion_telemetry_rejections(rejected_at);
create index if not exists orion_telemetry_rejections_code_idx
  on public.orion_telemetry_rejections(code, rejected_at desc);

drop trigger if exists orion_telemetry_scopes_updated_at on public.orion_telemetry_account_scopes;
create trigger orion_telemetry_scopes_updated_at
before update on public.orion_telemetry_account_scopes
for each row execute function public.set_updated_at();

drop trigger if exists orion_telemetry_streams_updated_at on public.orion_telemetry_streams;
create trigger orion_telemetry_streams_updated_at
before update on public.orion_telemetry_streams
for each row execute function public.set_updated_at();

drop trigger if exists orion_open_positions_updated_at on public.orion_open_positions;
create trigger orion_open_positions_updated_at
before update on public.orion_open_positions
for each row execute function public.set_updated_at();

create or replace function public.enforce_orion_telemetry_scope_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.client_id is distinct from old.client_id
    or new.license_id is distinct from old.license_id
    or new.platform is distinct from old.platform
    or new.account_type is distinct from old.account_type
    or new.trading_account_id is distinct from old.trading_account_id
    or new.demo_account_id is distinct from old.demo_account_id
    or new.account_number is distinct from old.account_number
    or new.broker_server is distinct from old.broker_server then
    raise exception using errcode = 'P0001', message = 'TELEMETRY_SCOPE_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_orion_telemetry_scope_identity on public.orion_telemetry_account_scopes;
create trigger enforce_orion_telemetry_scope_identity
before update on public.orion_telemetry_account_scopes
for each row execute function public.enforce_orion_telemetry_scope_identity();

create or replace function public.supersede_orion_telemetry_streams()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.orion_telemetry_streams
  set status = 'Superseded', updated_at = clock_timestamp()
  where license_id = new.id
    and status = 'Active'
    and (
      binding_version <> new.binding_version
      or new.status <> 'Active'
      or new.revoked_at is not null
      or new.client_id is distinct from old.client_id
      or new.platform is distinct from old.platform
    );
  return new;
end;
$$;

drop trigger if exists supersede_orion_telemetry_streams on public.licenses;
create trigger supersede_orion_telemetry_streams
after update of binding_version, status, revoked_at, client_id, platform
on public.licenses
for each row execute function public.supersede_orion_telemetry_streams();

alter table public.orion_telemetry_account_scopes enable row level security;
alter table public.orion_telemetry_streams enable row level security;
alter table public.orion_telemetry_batches enable row level security;
alter table public.orion_account_snapshots enable row level security;
alter table public.orion_open_positions enable row level security;
alter table public.orion_closed_deals enable row level security;
alter table public.orion_telemetry_rate_limits enable row level security;
alter table public.orion_telemetry_rejections enable row level security;

revoke all on table public.orion_telemetry_account_scopes from public, anon, authenticated, service_role;
revoke all on table public.orion_telemetry_streams from public, anon, authenticated, service_role;
revoke all on table public.orion_telemetry_batches from public, anon, authenticated, service_role;
revoke all on table public.orion_account_snapshots from public, anon, authenticated, service_role;
revoke all on table public.orion_open_positions from public, anon, authenticated, service_role;
revoke all on table public.orion_closed_deals from public, anon, authenticated, service_role;
revoke all on table public.orion_telemetry_rate_limits from public, anon, authenticated, service_role;
revoke all on table public.orion_telemetry_rejections from public, anon, authenticated, service_role;

grant select on table public.orion_telemetry_account_scopes to service_role;
grant select on table public.orion_telemetry_streams to service_role;
grant select on table public.orion_telemetry_batches to service_role;
grant select on table public.orion_account_snapshots to service_role;
grant select on table public.orion_open_positions to service_role;
grant select on table public.orion_closed_deals to service_role;
grant select on table public.orion_telemetry_rejections to service_role;

create or replace function public.consume_orion_telemetry_rate_limit(
  p_dimension text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_window timestamptz;
begin
  if p_dimension not in ('IP', 'License', 'Installation')
    or p_identifier_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400 then
    return query select false, v_now + interval '5 minutes';
    return;
  end if;

  insert into public.orion_telemetry_rate_limits (
    dimension, identifier_hash, window_started_at, attempt_count, updated_at
  ) values (
    p_dimension, p_identifier_hash, v_now, 1, v_now
  )
  on conflict (dimension, identifier_hash) do update
  set window_started_at = case
        when orion_telemetry_rate_limits.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
          then v_now
        else orion_telemetry_rate_limits.window_started_at
      end,
      attempt_count = case
        when orion_telemetry_rate_limits.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
          then 1
        else orion_telemetry_rate_limits.attempt_count + 1
      end,
      updated_at = v_now
  returning attempt_count, window_started_at into v_count, v_window;

  return query select
    v_count <= p_limit,
    v_window + make_interval(secs => p_window_seconds);
end;
$$;

create or replace function public.record_orion_telemetry_rejection(
  p_code text,
  p_request_ip_hash text,
  p_key_hash text,
  p_installation_hash text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.orion_telemetry_rejections (
    code, request_ip_hash, key_hash, installation_hash
  ) values (
    p_code, p_request_ip_hash, p_key_hash, p_installation_hash
  );
end;
$$;

create or replace function public.orion_telemetry_result(
  p_accepted boolean,
  p_code text,
  p_server_time timestamptz,
  p_ack_deal_time_msc numeric,
  p_ack_deal_ticket numeric,
  p_send_after_seconds integer
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'accepted', p_accepted,
    'code', p_code,
    'serverTime', p_server_time,
    'ackDealTimeMsc', greatest(coalesce(p_ack_deal_time_msc, 0), 0)::text,
    'ackDealTicket', greatest(coalesce(p_ack_deal_ticket, 0), 0)::text,
    'sendAfterSeconds', greatest(coalesce(p_send_after_seconds, 0), 0)
  );
$$;

create or replace function public.ingest_orion_trading_telemetry(
  p_key_hash text,
  p_account_number text,
  p_broker_server text,
  p_platform text,
  p_account_type text,
  p_installation_hash text,
  p_binding_version integer,
  p_request_id text,
  p_sequence text,
  p_sent_at text,
  p_payload_hash text,
  p_request_ip_hash text,
  p_heartbeat jsonb,
  p_account_snapshot jsonb,
  p_open_positions jsonb,
  p_closed_deals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_sequence bigint;
  v_sent_at timestamptz;
  v_observed_at timestamptz;
  v_positions_observed_at timestamptz;
  v_validation jsonb;
  v_code text;
  v_license record;
  v_installation_id uuid;
  v_account_id uuid;
  v_account_number text;
  v_broker_server text;
  v_scope public.orion_telemetry_account_scopes%rowtype;
  v_stream public.orion_telemetry_streams%rowtype;
  v_stream_exists boolean := false;
  v_existing_batch public.orion_telemetry_batches%rowtype;
  v_existing_snapshot_request text;
  v_position_count integer;
  v_deal_count integer;
  v_position_snapshot_id text;
  v_cursor_time numeric(20,0);
  v_cursor_ticket numeric(20,0);
  v_ack_time numeric(20,0);
  v_ack_ticket numeric(20,0);
  v_item_time numeric(20,0);
  v_item_ticket numeric(20,0);
  v_currency text;
  v_leverage integer;
  v_balance numeric(24,8);
  v_equity numeric(24,8);
  v_credit numeric(24,8);
  v_margin numeric(24,8);
  v_free_margin numeric(24,8);
  v_margin_level numeric(24,8);
  v_floating_profit numeric(24,8);
  v_ip_allowed boolean;
  v_license_allowed boolean;
  v_installation_allowed boolean;
  v_ip_retry timestamptz;
  v_license_retry timestamptz;
  v_installation_retry timestamptz;
  v_retry timestamptz;
  v_retry_seconds integer;
begin
  -- Route validation is strict, but the database remains fail-closed if this
  -- RPC is ever called from another service-role process.
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_installation_hash !~ '^[0-9a-f]{64}$'
    or p_request_ip_hash !~ '^[0-9a-f]{64}$'
    or p_request_id !~ '^[0-9a-f]{64}$'
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_platform not in ('MT4', 'MT5')
    or p_account_type not in ('Demo', 'Real')
    or p_binding_version is null
    or p_binding_version < 0 then
    return public.orion_telemetry_result(false, 'INVALID_REQUEST', v_now, 0, 0, 300);
  end if;

  if p_sequence !~ '^[1-9][0-9]{0,18}$'
    or p_sent_at !~ '^(0|[1-9][0-9]{0,11})$' then
    perform public.record_orion_telemetry_rejection(
      'INVALID_REQUEST', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'INVALID_REQUEST', v_now, 0, 0, 300);
  end if;
  if p_sequence::numeric > 9223372036854775807
    or p_sent_at::numeric > 253402300799 then
    perform public.record_orion_telemetry_rejection(
      'INVALID_REQUEST', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'INVALID_REQUEST', v_now, 0, 0, 300);
  end if;

  v_sequence := p_sequence::bigint;
  v_sent_at := to_timestamp(p_sent_at::double precision);
  if v_sent_at < v_now - interval '15 minutes'
    or v_sent_at > v_now + interval '2 minutes' then
    perform public.record_orion_telemetry_rejection(
      'PAYLOAD_TIME_INVALID', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'PAYLOAD_TIME_INVALID', v_now, 0, 0, 300);
  end if;

  if jsonb_typeof(p_heartbeat) <> 'object'
    or jsonb_typeof(p_account_snapshot) <> 'object'
    or jsonb_typeof(p_open_positions) <> 'object'
    or jsonb_typeof(p_open_positions -> 'items') <> 'array'
    or coalesce(p_open_positions ->> 'complete', '') <> 'true'
    or jsonb_typeof(p_closed_deals) <> 'object'
    or jsonb_typeof(p_closed_deals -> 'cursor') <> 'object'
    or jsonb_typeof(p_closed_deals -> 'items') <> 'array' then
    perform public.record_orion_telemetry_rejection(
      'INVALID_REQUEST', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'INVALID_REQUEST', v_now, 0, 0, 300);
  end if;

  v_position_count := jsonb_array_length(p_open_positions -> 'items');
  v_deal_count := jsonb_array_length(p_closed_deals -> 'items');
  v_position_snapshot_id := coalesce(p_open_positions ->> 'snapshotId', '');
  if v_position_count > 100
    or v_deal_count > 40
    or v_position_snapshot_id !~ '^[0-9a-f]{64}$'
    or coalesce(p_account_snapshot ->> 'observedAt', '') !~ '^(0|[1-9][0-9]{0,11})$'
    or coalesce(p_open_positions ->> 'observedAt', '') !~ '^(0|[1-9][0-9]{0,11})$'
    or coalesce(p_closed_deals -> 'cursor' ->> 'timeMsc', '') !~ '^(0|[1-9][0-9]{0,19})$'
    or coalesce(p_closed_deals -> 'cursor' ->> 'dealTicket', '') !~ '^(0|[1-9][0-9]{0,19})$' then
    perform public.record_orion_telemetry_rejection(
      'INVALID_REQUEST', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'INVALID_REQUEST', v_now, 0, 0, 300);
  end if;

  v_observed_at := to_timestamp((p_account_snapshot ->> 'observedAt')::double precision);
  v_positions_observed_at := to_timestamp((p_open_positions ->> 'observedAt')::double precision);
  if v_observed_at < v_sent_at - interval '15 minutes'
    or v_observed_at > v_sent_at + interval '2 minutes'
    or v_positions_observed_at < v_sent_at - interval '15 minutes'
    or v_positions_observed_at > v_sent_at + interval '2 minutes' then
    perform public.record_orion_telemetry_rejection(
      'PAYLOAD_TIME_INVALID', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'PAYLOAD_TIME_INVALID', v_now, 0, 0, 300);
  end if;

  v_cursor_time := (p_closed_deals -> 'cursor' ->> 'timeMsc')::numeric;
  v_cursor_ticket := (p_closed_deals -> 'cursor' ->> 'dealTicket')::numeric;
  v_ack_time := v_cursor_time;
  v_ack_ticket := v_cursor_ticket;

  select allowed, retry_at into v_ip_allowed, v_ip_retry
  from public.consume_orion_telemetry_rate_limit('IP', p_request_ip_hash, 300, 300);
  select allowed, retry_at into v_license_allowed, v_license_retry
  from public.consume_orion_telemetry_rate_limit('License', p_key_hash, 60, 300);
  select allowed, retry_at into v_installation_allowed, v_installation_retry
  from public.consume_orion_telemetry_rate_limit('Installation', p_installation_hash, 60, 300);

  if not v_ip_allowed or not v_license_allowed or not v_installation_allowed then
    v_retry := greatest(v_ip_retry, v_license_retry, v_installation_retry);
    v_retry_seconds := greatest(15, least(3600, ceil(extract(epoch from (v_retry - v_now)))::integer));
    -- Do not append one rejection row for every throttled retry. The durable
    -- bucket already records attempts; avoiding another write prevents an
    -- attacker from turning a rate limit into unbounded audit-table growth.
    return public.orion_telemetry_result(
      false, 'TELEMETRY_RATE_LIMIT', v_now, v_cursor_time, v_cursor_ticket, v_retry_seconds
    );
  end if;

  -- A request id is global. Serialize it before taking the license lock so two
  -- clients cannot race the same id into the receipt table.
  perform pg_advisory_xact_lock(hashtextextended('orion-telemetry-request:' || p_request_id, 0));

  -- The existing validator locks the exact license row FOR UPDATE and validates
  -- active client/license, expiry, registered account, exact broker server,
  -- platform, active installation, and installation hash. Because this is a
  -- nested call, that lock is retained until this ingestion transaction ends.
  v_validation := public.validate_orion_license_runtime(
    p_key_hash,
    p_account_number,
    p_broker_server,
    p_platform,
    p_account_type,
    p_installation_hash
  );
  if coalesce(v_validation ->> 'valid', 'false') <> 'true' then
    v_code := coalesce(v_validation ->> 'code', 'INVALID_LICENSE');
    if v_code not in (
      'INVALID_REQUEST', 'INVALID_LICENSE', 'LICENSE_INACTIVE',
      'INSTALLATION_NOT_REGISTERED', 'INSTALLATION_MISMATCH',
      'ACCOUNT_NOT_REGISTERED', 'ACCOUNT_MISMATCH',
      'DEMO_ACCOUNT_NOT_REGISTERED', 'DEMO_ACCOUNT_MISMATCH'
    ) then
      v_code := 'INVALID_LICENSE';
    end if;
    perform public.record_orion_telemetry_rejection(
      v_code, p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, v_code, v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  select
    licensed.id,
    licensed.client_id,
    licensed.plan,
    licensed.platform,
    licensed.binding_version,
    licensed.trading_account_id
  into v_license
  from public.licenses as licensed
  where licensed.key_hash = p_key_hash
  for update;
  if not found then
    perform public.record_orion_telemetry_rejection(
      'INVALID_LICENSE', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'INVALID_LICENSE', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  if v_license.binding_version <> p_binding_version
    or coalesce((v_validation ->> 'bindingVersion')::integer, -1) <> p_binding_version then
    perform public.record_orion_telemetry_rejection(
      'BINDING_CHANGED', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'BINDING_CHANGED', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  select installation.id into v_installation_id
  from public.license_installations as installation
  where installation.license_id = v_license.id
    and installation.client_id = v_license.client_id
    and installation.platform = v_license.platform
    and installation.installation_hash = p_installation_hash
    and installation.status = 'Active';
  if not found then
    perform public.record_orion_telemetry_rejection(
      'INSTALLATION_MISMATCH', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'INSTALLATION_MISMATCH', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  if p_account_type = 'Real' then
    select account.id, account.account_number, account.broker_server
      into v_account_id, v_account_number, v_broker_server
    from public.client_trading_accounts as account
    where account.id = v_license.trading_account_id
      and account.client_id = v_license.client_id
      and account.platform = v_license.platform
      and account.account_type = 'Real'
      and account.status = 'Active'
      and account.verified_at is not null;
  else
    select account.id, account.account_number, account.broker_server
      into v_account_id, v_account_number, v_broker_server
    from public.license_demo_accounts as account
    where account.license_id = v_license.id
      and account.client_id = v_license.client_id
      and account.platform = v_license.platform
      and account.status = 'Active';
  end if;
  if not found then
    v_code := case when p_account_type = 'Real' then 'ACCOUNT_NOT_REGISTERED' else 'DEMO_ACCOUNT_NOT_REGISTERED' end;
    perform public.record_orion_telemetry_rejection(
      v_code, p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, v_code, v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  select * into v_scope
  from public.orion_telemetry_account_scopes as scope
  where scope.license_id = v_license.id
    and (
      (p_account_type = 'Real' and scope.account_type = 'Real' and scope.trading_account_id = v_account_id)
      or
      (p_account_type = 'Demo' and scope.account_type = 'Demo' and scope.demo_account_id = v_account_id)
    )
  for update;

  if not found then
    insert into public.orion_telemetry_account_scopes (
      client_id, license_id, platform, account_type,
      trading_account_id, demo_account_id, account_number, broker_server,
      first_seen_at, last_seen_at
    ) values (
      v_license.client_id, v_license.id, v_license.platform, p_account_type,
      case when p_account_type = 'Real' then v_account_id else null end,
      case when p_account_type = 'Demo' then v_account_id else null end,
      v_account_number, v_broker_server, v_now, v_now
    ) returning * into v_scope;
  elsif v_scope.account_number <> v_account_number
    or lower(btrim(v_scope.broker_server)) <> lower(btrim(v_broker_server)) then
    v_code := case when p_account_type = 'Real' then 'ACCOUNT_MISMATCH' else 'DEMO_ACCOUNT_MISMATCH' end;
    perform public.record_orion_telemetry_rejection(
      v_code, p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, v_code, v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  update public.orion_telemetry_streams
  set status = 'Superseded', updated_at = v_now
  where license_id = v_license.id
    and status = 'Active'
    and binding_version <> p_binding_version;

  select * into v_stream
  from public.orion_telemetry_streams as stream
  where stream.account_scope_id = v_scope.id
    and stream.binding_version = p_binding_version
  for update;
  v_stream_exists := found;
  if v_stream_exists and v_stream.installation_id <> v_installation_id then
    perform public.record_orion_telemetry_rejection(
      'BINDING_CHANGED', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'BINDING_CHANGED', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  select * into v_existing_batch
  from public.orion_telemetry_batches
  where request_id = p_request_id;
  if found then
    if v_stream_exists
      and v_existing_batch.stream_id = v_stream.id
      and v_existing_batch.sequence = v_sequence
      and v_existing_batch.payload_hash = p_payload_hash then
      return public.orion_telemetry_result(
        true, 'ACCEPTED', v_now,
        v_existing_batch.ack_deal_time_msc,
        v_existing_batch.ack_deal_ticket,
        60
      );
    end if;
    perform public.record_orion_telemetry_rejection(
      'REQUEST_ID_CONFLICT', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'REQUEST_ID_CONFLICT', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  if v_stream_exists and v_sequence <= v_stream.last_sequence then
    perform public.record_orion_telemetry_rejection(
      'STALE_SEQUENCE', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'STALE_SEQUENCE', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  select request_id into v_existing_snapshot_request
  from public.orion_telemetry_batches
  where account_scope_id = v_scope.id
    and position_snapshot_id = v_position_snapshot_id;
  if found then
    perform public.record_orion_telemetry_rejection(
      'POSITION_SNAPSHOT_CONFLICT', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'POSITION_SNAPSHOT_CONFLICT', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  -- A broker ticket is immutable inside one stable account scope. Repeated raw
  -- pages are harmless, but the same ticket with different source fields is a
  -- conflict and rejects the entire batch before any telemetry row is written.
  if exists (
    select 1
    from jsonb_to_recordset(p_closed_deals -> 'items') as item(
      "dealTicket" text, "orderTicket" text, "positionId" text,
      "timeMsc" text, symbol text, side text, entry text, reason text,
      magic text, volume numeric, price numeric, "stopLoss" numeric,
      "takeProfit" numeric, commission numeric, swap numeric, fee numeric,
      profit numeric
    )
    join public.orion_closed_deals as existing
      on existing.account_scope_id = v_scope.id
      and existing.deal_ticket = item."dealTicket"
    where existing.order_ticket is distinct from item."orderTicket"
      or existing.position_id is distinct from item."positionId"
      or existing.deal_time_msc is distinct from item."timeMsc"::numeric
      or existing.symbol is distinct from item.symbol
      or existing.side is distinct from item.side
      or existing.entry is distinct from item.entry
      or existing.reason is distinct from item.reason
      or existing.magic is distinct from item.magic
      or existing.volume is distinct from item.volume
      or existing.price is distinct from item.price
      or existing.stop_loss is distinct from item."stopLoss"
      or existing.take_profit is distinct from item."takeProfit"
      or existing.commission is distinct from item.commission
      or existing.swap is distinct from item.swap
      or existing.fee is distinct from item.fee
      or existing.profit is distinct from item.profit
  ) then
    perform public.record_orion_telemetry_rejection(
      'DEAL_CONFLICT', p_request_ip_hash, p_key_hash, p_installation_hash
    );
    return public.orion_telemetry_result(false, 'DEAL_CONFLICT', v_now, v_cursor_time, v_cursor_ticket, 300);
  end if;

  select item."timeMsc"::numeric, item."dealTicket"::numeric
    into v_item_time, v_item_ticket
  from jsonb_to_recordset(p_closed_deals -> 'items') as item(
    "dealTicket" text, "timeMsc" text
  )
  order by item."timeMsc"::numeric desc, item."dealTicket"::numeric desc
  limit 1;
  if found and (v_item_time, v_item_ticket) > (v_ack_time, v_ack_ticket) then
    v_ack_time := v_item_time;
    v_ack_ticket := v_item_ticket;
  end if;

  v_currency := upper(p_account_snapshot ->> 'currency');
  v_leverage := (p_account_snapshot ->> 'leverage')::integer;
  v_balance := (p_account_snapshot ->> 'balance')::numeric;
  v_equity := (p_account_snapshot ->> 'equity')::numeric;
  v_credit := (p_account_snapshot ->> 'credit')::numeric;
  v_margin := (p_account_snapshot ->> 'margin')::numeric;
  v_free_margin := (p_account_snapshot ->> 'freeMargin')::numeric;
  v_margin_level := (p_account_snapshot ->> 'marginLevel')::numeric;
  v_floating_profit := (p_account_snapshot ->> 'floatingProfit')::numeric;

  -- Create or reactivate the stream only after every idempotency, cursor and
  -- immutable-deal check passed. Rejected batches therefore cannot appear as a
  -- live terminal in client or administrator read models.
  if not v_stream_exists then
    insert into public.orion_telemetry_streams (
      account_scope_id, client_id, license_id, platform, installation_id,
      binding_version, status, first_seen_at, last_seen_at,
      ea_version, terminal_build, terminal_connected, terminal_trade_allowed,
      mql_trade_allowed, chart_symbol, chart_period_minutes, license_state
    ) values (
      v_scope.id, v_license.client_id, v_license.id, v_license.platform, v_installation_id,
      p_binding_version, 'Active', v_now, v_now,
      p_heartbeat ->> 'eaVersion', (p_heartbeat ->> 'terminalBuild')::integer,
      (p_heartbeat ->> 'terminalConnected')::boolean,
      (p_heartbeat ->> 'terminalTradeAllowed')::boolean,
      (p_heartbeat ->> 'mqlTradeAllowed')::boolean,
      p_heartbeat ->> 'chartSymbol', (p_heartbeat ->> 'chartPeriodMinutes')::integer,
      p_heartbeat ->> 'licenseState'
    ) returning * into v_stream;
  else
    update public.orion_telemetry_streams
    set status = 'Active'
    where id = v_stream.id
    returning * into v_stream;
  end if;

  insert into public.orion_telemetry_batches (
    request_id, stream_id, account_scope_id, client_id, license_id,
    sequence, payload_hash, position_snapshot_id, sent_at, received_at,
    plan_at_ingest, position_count, deal_count,
    ack_deal_time_msc, ack_deal_ticket
  ) values (
    p_request_id, v_stream.id, v_scope.id, v_license.client_id, v_license.id,
    v_sequence, p_payload_hash, v_position_snapshot_id, v_sent_at, v_now,
    v_license.plan, v_position_count, v_deal_count,
    v_ack_time, v_ack_ticket
  );

  insert into public.orion_account_snapshots (
    request_id, stream_id, account_scope_id, client_id, license_id,
    plan_at_ingest, observed_at, received_at, currency, leverage,
    balance, equity, credit, margin, free_margin, margin_level, floating_profit
  ) values (
    p_request_id, v_stream.id, v_scope.id, v_license.client_id, v_license.id,
    v_license.plan, v_observed_at, v_now, v_currency, v_leverage,
    v_balance, v_equity, v_credit, v_margin, v_free_margin, v_margin_level, v_floating_profit
  );

  insert into public.orion_open_positions (
    account_scope_id, position_ticket, client_id, license_id, platform,
    stream_id, last_seen_request_id, position_id, symbol, side, magic,
    opened_at, volume, open_price, current_price, stop_loss, take_profit,
    swap, profit, observed_at
  )
  select
    v_scope.id, item."positionTicket", v_license.client_id, v_license.id, v_license.platform,
    v_stream.id, p_request_id, item."positionId", item.symbol, item.side, item.magic,
    to_timestamp(item."openedAtMsc"::double precision / 1000.0),
    item.volume, item."openPrice", item."currentPrice", item."stopLoss", item."takeProfit",
    item.swap, item.profit, v_positions_observed_at
  from jsonb_to_recordset(p_open_positions -> 'items') as item(
    "positionTicket" text, "positionId" text, symbol text, side text,
    magic text, "openedAtMsc" text, volume numeric, "openPrice" numeric,
    "currentPrice" numeric, "stopLoss" numeric, "takeProfit" numeric,
    swap numeric, profit numeric
  )
  on conflict (account_scope_id, position_ticket) do update
  set client_id = excluded.client_id,
      license_id = excluded.license_id,
      platform = excluded.platform,
      stream_id = excluded.stream_id,
      last_seen_request_id = excluded.last_seen_request_id,
      position_id = excluded.position_id,
      symbol = excluded.symbol,
      side = excluded.side,
      magic = excluded.magic,
      opened_at = excluded.opened_at,
      volume = excluded.volume,
      open_price = excluded.open_price,
      current_price = excluded.current_price,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      swap = excluded.swap,
      profit = excluded.profit,
      observed_at = excluded.observed_at,
      updated_at = v_now;

  delete from public.orion_open_positions
  where account_scope_id = v_scope.id
    and last_seen_request_id <> p_request_id;

  insert into public.orion_closed_deals (
    account_scope_id, deal_ticket, client_id, license_id, platform,
    first_seen_stream_id, first_seen_request_id, plan_at_ingest,
    order_ticket, position_id, deal_time_msc, deal_time,
    symbol, side, entry, reason, magic, volume, price, stop_loss,
    take_profit, commission, swap, fee, profit, received_at
  )
  select
    v_scope.id, item."dealTicket", v_license.client_id, v_license.id, v_license.platform,
    v_stream.id, p_request_id, v_license.plan,
    item."orderTicket", item."positionId", item."timeMsc"::numeric,
    to_timestamp(item."timeMsc"::double precision / 1000.0),
    item.symbol, item.side, item.entry, item.reason, item.magic,
    item.volume, item.price, item."stopLoss", item."takeProfit",
    item.commission, item.swap, item.fee, item.profit, v_now
  from jsonb_to_recordset(p_closed_deals -> 'items') as item(
    "dealTicket" text, "orderTicket" text, "positionId" text,
    "timeMsc" text, symbol text, side text, entry text, reason text,
    magic text, volume numeric, price numeric, "stopLoss" numeric,
    "takeProfit" numeric, commission numeric, swap numeric, fee numeric,
    profit numeric
  )
  on conflict (account_scope_id, deal_ticket) do nothing;

  update public.orion_telemetry_streams
  set status = 'Active',
      last_seen_at = v_now,
      last_captured_at = v_observed_at,
      last_sequence = v_sequence,
      ea_version = p_heartbeat ->> 'eaVersion',
      terminal_build = (p_heartbeat ->> 'terminalBuild')::integer,
      terminal_connected = (p_heartbeat ->> 'terminalConnected')::boolean,
      terminal_trade_allowed = (p_heartbeat ->> 'terminalTradeAllowed')::boolean,
      mql_trade_allowed = (p_heartbeat ->> 'mqlTradeAllowed')::boolean,
      chart_symbol = p_heartbeat ->> 'chartSymbol',
      chart_period_minutes = (p_heartbeat ->> 'chartPeriodMinutes')::integer,
      license_state = p_heartbeat ->> 'licenseState',
      currency = v_currency,
      balance = v_balance,
      equity = v_equity,
      margin = v_margin,
      margin_level = v_margin_level,
      floating_profit = v_floating_profit,
      open_position_count = v_position_count,
      updated_at = v_now
  where id = v_stream.id;

  update public.orion_telemetry_account_scopes
  set last_seen_at = v_now, updated_at = v_now
  where id = v_scope.id;

  return public.orion_telemetry_result(
    true, 'ACCEPTED', v_now, v_ack_time, v_ack_ticket, 60
  );
end;
$$;

-- Read helpers stay service-role-only. They prove client ownership again even
-- though the Next.js route already derives the client from the authenticated
-- portal session. Aggregation in PostgreSQL avoids PostgREST row caps and keeps
-- keyset pagination accurate as telemetry history grows.
create or replace function public.read_orion_trading_equity(
  p_client_id uuid,
  p_account_scope_id uuid,
  p_since timestamptz,
  p_max_points integer default 240
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint := 0;
  v_points jsonb := '[]'::jsonb;
  v_drawdown_money numeric := null;
  v_drawdown_percent numeric := null;
begin
  if p_client_id is null
    or p_account_scope_id is null
    or p_max_points is null
    or p_max_points not between 10 and 500
    or not exists (
      select 1
      from public.orion_telemetry_account_scopes
      where id = p_account_scope_id
        and client_id = p_client_id
    ) then
    return jsonb_build_object(
      'points', '[]'::jsonb,
      'sampleCount', 0,
      'maxDrawdownMoney', null,
      'maxDrawdownPercent', null
    );
  end if;

  select count(*) into v_count
  from public.orion_account_snapshots
  where client_id = p_client_id
    and account_scope_id = p_account_scope_id
    and (p_since is null or observed_at >= p_since);

  if v_count > 0 then
    with bucketed as (
      select
        observed_at,
        balance,
        equity,
        ntile(least(p_max_points::bigint, v_count)::integer)
          over (order by observed_at, id) as sample_bucket
      from public.orion_account_snapshots
      where client_id = p_client_id
        and account_scope_id = p_account_scope_id
        and (p_since is null or observed_at >= p_since)
    ), sampled as (
      select distinct on (sample_bucket)
        sample_bucket, observed_at, balance, equity
      from bucketed
      order by sample_bucket, observed_at desc
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'at', observed_at,
          'balance', balance,
          'equity', equity
        ) order by observed_at
      ),
      '[]'::jsonb
    ) into v_points
    from sampled;

    with series as (
      select
        equity,
        max(equity) over (
          order by observed_at, id
          rows between unbounded preceding and current row
        ) as peak_equity
      from public.orion_account_snapshots
      where client_id = p_client_id
        and account_scope_id = p_account_scope_id
        and (p_since is null or observed_at >= p_since)
    )
    select
      max(greatest(peak_equity - equity, 0)),
      max(
        case when peak_equity > 0
          then greatest(peak_equity - equity, 0) / peak_equity * 100
          else 0
        end
      )
    into v_drawdown_money, v_drawdown_percent
    from series;
  end if;

  return jsonb_build_object(
    'points', v_points,
    'sampleCount', v_count,
    'maxDrawdownMoney', case when v_count >= 2 then v_drawdown_money else null end,
    'maxDrawdownPercent', case when v_count >= 2 then v_drawdown_percent else null end
  );
end;
$$;

create or replace function public.orion_closed_trade_rows(
  p_client_id uuid,
  p_account_scope_id uuid
)
returns table (
  position_id text,
  ticket text,
  symbol text,
  side text,
  volume numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  entry_price numeric,
  exit_price numeric,
  profit numeric,
  swap numeric,
  commission numeric,
  net_profit numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with grouped as (
    select
      deal.position_id,
      (array_agg(deal.order_ticket order by deal.deal_time_msc desc)
        filter (where deal.entry in ('Out', 'OutBy', 'InOut')))[1] as ticket,
      (array_agg(deal.symbol order by deal.deal_time_msc)
        filter (where deal.entry in ('In', 'InOut')))[1] as symbol,
      (array_agg(deal.side order by deal.deal_time_msc)
        filter (where deal.entry in ('In', 'InOut')))[1] as side,
      sum(deal.volume) filter (where deal.entry in ('Out', 'OutBy', 'InOut')) as volume,
      min(deal.deal_time) filter (where deal.entry in ('In', 'InOut')) as opened_at,
      max(deal.deal_time) filter (where deal.entry in ('Out', 'OutBy', 'InOut')) as closed_at,
      sum(deal.price * deal.volume) filter (where deal.entry in ('In', 'InOut'))
        / nullif(sum(deal.volume) filter (where deal.entry in ('In', 'InOut')), 0) as entry_price,
      sum(deal.price * deal.volume) filter (where deal.entry in ('Out', 'OutBy', 'InOut'))
        / nullif(sum(deal.volume) filter (where deal.entry in ('Out', 'OutBy', 'InOut')), 0) as exit_price,
      sum(deal.profit) as profit,
      sum(deal.swap) as swap,
      sum(deal.commission + deal.fee) as commission,
      sum(deal.net_profit) as net_profit,
      bool_or(deal.entry = 'InOut') as has_netting_reversal
    from public.orion_closed_deals as deal
    where deal.client_id = p_client_id
      and deal.account_scope_id = p_account_scope_id
      and exists (
        select 1
        from public.orion_telemetry_account_scopes as scope
        where scope.id = p_account_scope_id
          and scope.client_id = p_client_id
      )
    group by deal.position_id
  )
  select
    grouped.position_id,
    grouped.ticket,
    grouped.symbol,
    grouped.side,
    grouped.volume,
    grouped.opened_at,
    grouped.closed_at,
    grouped.entry_price,
    grouped.exit_price,
    grouped.profit,
    grouped.swap,
    grouped.commission,
    grouped.net_profit
  from grouped
  where grouped.opened_at is not null
    and grouped.closed_at is not null
    and grouped.symbol is not null
    and grouped.side in ('Buy', 'Sell')
    and not grouped.has_netting_reversal
    and not exists (
      select 1
      from public.orion_open_positions as position
      where position.client_id = p_client_id
        and position.account_scope_id = p_account_scope_id
        and position.position_id = grouped.position_id
    );
$$;

create or replace function public.read_orion_trading_performance(
  p_client_id uuid,
  p_account_scope_id uuid,
  p_since timestamptz,
  p_cursor_closed_at timestamptz,
  p_cursor_position_id text,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_realized numeric := 0;
  v_wins bigint := 0;
  v_losses bigint := 0;
  v_closed bigint := 0;
  v_gross_profit numeric := 0;
  v_gross_loss numeric := 0;
  v_today numeric := 0;
  v_seven_days numeric := 0;
  v_thirty_days numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_netting_reversals_excluded boolean := false;
begin
  if p_client_id is null
    or p_account_scope_id is null
    or p_page_size is null
    or p_page_size not between 1 and 100
    or ((p_cursor_closed_at is null) <> (p_cursor_position_id is null))
    or (p_cursor_position_id is not null and p_cursor_position_id !~ '^(0|[1-9][0-9]{0,19})$')
    or not exists (
      select 1
      from public.orion_telemetry_account_scopes
      where id = p_account_scope_id
        and client_id = p_client_id
    ) then
    return jsonb_build_object(
      'metrics', jsonb_build_object(
        'realizedNet', 0,
        'winRate', null,
        'profitFactor', null,
        'closedTrades', 0
      ),
      'limitations', jsonb_build_object(
        'nettingReversalsExcluded', false
      ),
      'summaries', jsonb_build_object(
        'todayNet', 0,
        'sevenDayNet', 0,
        'thirtyDayNet', 0
      ),
      'items', '[]'::jsonb,
      'hasMore', false
    );
  end if;

  select exists (
    select 1
    from public.orion_closed_deals as deal
    where deal.client_id = p_client_id
      and deal.account_scope_id = p_account_scope_id
      and deal.entry = 'InOut'
  ) into v_netting_reversals_excluded;

  select
    count(*),
    count(*) filter (where trade.net_profit > 0),
    count(*) filter (where trade.net_profit < 0),
    coalesce(sum(trade.net_profit), 0),
    coalesce(sum(trade.net_profit) filter (where trade.net_profit > 0), 0),
    abs(coalesce(sum(trade.net_profit) filter (where trade.net_profit < 0), 0))
  into v_closed, v_wins, v_losses, v_realized, v_gross_profit, v_gross_loss
  from public.orion_closed_trade_rows(p_client_id, p_account_scope_id) as trade
  where p_since is null or trade.closed_at >= p_since;

  select
    coalesce(sum(trade.net_profit) filter (
      where trade.closed_at >= date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
    ), 0),
    coalesce(sum(trade.net_profit) filter (where trade.closed_at >= v_now - interval '7 days'), 0),
    coalesce(sum(trade.net_profit) filter (where trade.closed_at >= v_now - interval '30 days'), 0)
  into v_today, v_seven_days, v_thirty_days
  from public.orion_closed_trade_rows(p_client_id, p_account_scope_id) as trade;

  with candidates as (
    select trade.*
    from public.orion_closed_trade_rows(p_client_id, p_account_scope_id) as trade
    where (p_since is null or trade.closed_at >= p_since)
      and (
        p_cursor_closed_at is null
        or (trade.closed_at, trade.position_id) < (p_cursor_closed_at, p_cursor_position_id)
      )
    order by trade.closed_at desc, trade.position_id desc
    limit p_page_size + 1
  ), page as (
    select *
    from candidates
    order by closed_at desc, position_id desc
    limit p_page_size
  )
  select
    (select count(*) > p_page_size from candidates),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', position_id,
          'ticket', ticket,
          'symbol', symbol,
          'side', side,
          'volume', volume,
          'openedAt', opened_at,
          'closedAt', closed_at,
          'entryPrice', entry_price,
          'exitPrice', exit_price,
          'profit', profit,
          'swap', swap,
          'commission', commission,
          'netProfit', net_profit
        ) order by closed_at desc, position_id desc
      ),
      '[]'::jsonb
    )
  into v_has_more, v_items
  from page;

  return jsonb_build_object(
    'metrics', jsonb_build_object(
      'realizedNet', v_realized,
      'winRate', case when v_closed > 0 then v_wins::numeric / v_closed * 100 else null end,
      'profitFactor', case when v_gross_loss > 0 then v_gross_profit / v_gross_loss else null end,
      'closedTrades', v_closed
    ),
    'limitations', jsonb_build_object(
      'nettingReversalsExcluded', v_netting_reversals_excluded
    ),
    'summaries', jsonb_build_object(
      'todayNet', v_today,
      'sevenDayNet', v_seven_days,
      'thirtyDayNet', v_thirty_days
    ),
    'items', v_items,
    'hasMore', v_has_more
  );
end;
$$;

create or replace function public.cleanup_orion_trading_telemetry()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_rejections integer := 0;
  v_rate_limits integer := 0;
  v_batches integer := 0;
  v_snapshots integer := 0;
  v_deals integer := 0;
  v_positions integer := 0;
  v_deleted integer := 0;
begin
  loop
    with stale as (
      select id
      from public.orion_telemetry_rejections
      where rejected_at < v_now - interval '30 days'
      order by rejected_at, id
      limit 5000
      for update skip locked
    )
    delete from public.orion_telemetry_rejections as rejection
    using stale
    where rejection.id = stale.id;
    get diagnostics v_deleted = row_count;
    v_rejections := v_rejections + v_deleted;
    exit when v_deleted < 5000;
  end loop;

  loop
    with stale as (
      select dimension, identifier_hash
      from public.orion_telemetry_rate_limits
      where updated_at < v_now - interval '2 days'
      order by updated_at, dimension, identifier_hash
      limit 5000
      for update skip locked
    )
    delete from public.orion_telemetry_rate_limits as bucket
    using stale
    where bucket.dimension = stale.dimension
      and bucket.identifier_hash = stale.identifier_hash;
    get diagnostics v_deleted = row_count;
    v_rate_limits := v_rate_limits + v_deleted;
    exit when v_deleted < 5000;
  end loop;

  loop
    with stale as (
      select id
      from public.orion_account_snapshots
      where observed_at < v_now - case plan_at_ingest
        when 'Basic' then interval '90 days'
        when 'Premium' then interval '365 days'
        else interval '1095 days'
      end
      order by observed_at, id
      limit 5000
      for update skip locked
    )
    delete from public.orion_account_snapshots as snapshot
    using stale
    where snapshot.id = stale.id;
    get diagnostics v_deleted = row_count;
    v_snapshots := v_snapshots + v_deleted;
    exit when v_deleted < 5000;
  end loop;

  loop
    with stale as (
      select id
      from public.orion_closed_deals
      where deal_time < v_now - case plan_at_ingest
        when 'Basic' then interval '365 days'
        when 'Premium' then interval '730 days'
        else interval '1825 days'
      end
      order by deal_time, id
      limit 5000
      for update skip locked
    )
    delete from public.orion_closed_deals as deal
    using stale
    where deal.id = stale.id;
    get diagnostics v_deleted = row_count;
    v_deals := v_deals + v_deleted;
    exit when v_deleted < 5000;
  end loop;

  loop
    with stale as (
      select request_id
      from public.orion_telemetry_batches
      where received_at < v_now - interval '30 days'
      order by received_at, request_id
      limit 5000
      for update skip locked
    )
    delete from public.orion_telemetry_batches as batch
    using stale
    where batch.request_id = stale.request_id;
    get diagnostics v_deleted = row_count;
    v_batches := v_batches + v_deleted;
    exit when v_deleted < 5000;
  end loop;

  loop
    with stale as (
      select position.account_scope_id, position.position_ticket
      from public.orion_open_positions as position
      where position.updated_at < v_now - interval '90 days'
        and not exists (
          select 1
          from public.orion_telemetry_streams as stream
          where stream.account_scope_id = position.account_scope_id
            and stream.status = 'Active'
            and stream.last_seen_at >= v_now - interval '90 days'
        )
      order by position.updated_at, position.account_scope_id, position.position_ticket
      limit 5000
      for update of position skip locked
    )
    delete from public.orion_open_positions as position
    using stale
    where position.account_scope_id = stale.account_scope_id
      and position.position_ticket = stale.position_ticket;
    get diagnostics v_deleted = row_count;
    v_positions := v_positions + v_deleted;
    exit when v_deleted < 5000;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'rejectionsDeleted', v_rejections,
    'rateLimitsDeleted', v_rate_limits,
    'batchesDeleted', v_batches,
    'snapshotsDeleted', v_snapshots,
    'dealsDeleted', v_deals,
    'positionsDeleted', v_positions
  );
end;
$$;

revoke all on function public.enforce_orion_telemetry_scope_identity() from public, anon, authenticated, service_role;
revoke all on function public.supersede_orion_telemetry_streams() from public, anon, authenticated, service_role;
revoke all on function public.consume_orion_telemetry_rate_limit(text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.record_orion_telemetry_rejection(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.orion_telemetry_result(boolean, text, timestamptz, numeric, numeric, integer) from public, anon, authenticated, service_role;
revoke all on function public.ingest_orion_trading_telemetry(text, text, text, text, text, text, integer, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.read_orion_trading_equity(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.orion_closed_trade_rows(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_orion_trading_performance(uuid, uuid, timestamptz, timestamptz, text, integer) from public, anon, authenticated;
revoke all on function public.cleanup_orion_trading_telemetry() from public, anon, authenticated;

grant execute on function public.ingest_orion_trading_telemetry(text, text, text, text, text, text, integer, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.read_orion_trading_equity(uuid, uuid, timestamptz, integer) to service_role;
grant execute on function public.read_orion_trading_performance(uuid, uuid, timestamptz, timestamptz, text, integer) to service_role;
grant execute on function public.cleanup_orion_trading_telemetry() to service_role;
