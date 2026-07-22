-- Orion client Trading Alerts & Risk Center.
--
-- Alert evaluation is deliberately separate from telemetry ingestion. A failure
-- here cannot reject or roll back an otherwise valid EA telemetry batch. All
-- ownership and plan decisions are derived again in PostgreSQL from the exact
-- telemetry scope and its active license; browser roles never access these
-- tables or functions directly.

create extension if not exists pgcrypto;

create table if not exists public.client_trading_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  account_scope_id uuid not null,
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  connection_health boolean not null default false,
  connection_health_explicit boolean not null default false,
  final_close boolean not null default true,
  trade_opened boolean not null default false,
  partial_close boolean not null default false,
  daily_loss_enabled boolean not null default false,
  daily_loss_limit numeric(24,8),
  drawdown_enabled boolean not null default false,
  drawdown_percent numeric(9,4),
  equity_floor_enabled boolean not null default false,
  equity_floor numeric(24,8),
  risk_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_trading_alert_preferences_scope_owner_fk
    foreign key (account_scope_id, client_id, license_id, platform)
    references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)
    on update no action on delete cascade deferrable initially deferred,
  constraint client_trading_alert_preferences_scope_unique unique (account_scope_id),
  constraint client_trading_alert_preferences_platform_check check (platform in ('MT4', 'MT5')),
  constraint client_trading_alert_preferences_daily_loss_check check (
    daily_loss_limit is null or daily_loss_limit between 0.01 and 1000000000000
  ),
  constraint client_trading_alert_preferences_drawdown_check check (
    drawdown_percent is null or drawdown_percent between 1 and 90
  ),
  constraint client_trading_alert_preferences_equity_floor_check check (
    equity_floor is null or equity_floor between 0.01 and 1000000000000
  ),
  constraint client_trading_alert_preferences_daily_loss_enabled_check check (
    daily_loss_enabled = false or daily_loss_limit is not null
  ),
  constraint client_trading_alert_preferences_drawdown_enabled_check check (
    drawdown_enabled = false or drawdown_percent is not null
  ),
  constraint client_trading_alert_preferences_equity_floor_enabled_check check (
    equity_floor_enabled = false or equity_floor is not null
  ),
  constraint client_trading_alert_preferences_currency_check check (
    risk_currency = upper(btrim(risk_currency)) and risk_currency ~ '^[A-Z0-9]{3,8}$'
  )
);

create index if not exists client_trading_alert_preferences_client_idx
  on public.client_trading_alert_preferences(client_id, updated_at desc);
create index if not exists client_trading_alert_preferences_license_idx
  on public.client_trading_alert_preferences(license_id, account_scope_id);

create table if not exists public.client_trading_alert_events (
  id uuid primary key default gen_random_uuid(),
  account_scope_id uuid not null,
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  alert_type text not null,
  severity text not null,
  plan_at_trigger text not null,
  source_key text not null,
  dedupe_key text not null unique,
  title text not null,
  message text not null,
  metric_value numeric(28,10),
  threshold_value numeric(28,10),
  currency text,
  details jsonb not null default '{}'::jsonb,
  notification_id uuid references public.client_notifications(id) on delete set null,
  notification_suppressed boolean not null default false,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_trading_alert_events_scope_owner_fk
    foreign key (account_scope_id, client_id, license_id, platform)
    references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)
    on update no action on delete cascade deferrable initially deferred,
  constraint client_trading_alert_events_id_owner_unique
    unique (id, account_scope_id, client_id, license_id),
  constraint client_trading_alert_events_type_check check (alert_type in (
    'connection_delayed', 'connection_offline', 'trade_opened',
    'partial_close', 'final_close', 'daily_loss', 'drawdown', 'equity_floor'
  )),
  constraint client_trading_alert_events_severity_check
    check (severity in ('info', 'warning', 'critical')),
  constraint client_trading_alert_events_plan_check
    check (plan_at_trigger in ('Basic', 'Premium', 'Lifetime')),
  constraint client_trading_alert_events_platform_check check (platform in ('MT4', 'MT5')),
  constraint client_trading_alert_events_source_check
    check (source_key = btrim(source_key) and char_length(source_key) between 8 and 220),
  constraint client_trading_alert_events_dedupe_check
    check (dedupe_key = btrim(dedupe_key) and char_length(dedupe_key) between 12 and 260),
  constraint client_trading_alert_events_title_check
    check (title = btrim(title) and char_length(title) between 2 and 180),
  constraint client_trading_alert_events_message_check
    check (message = btrim(message) and char_length(message) between 2 and 1000),
  constraint client_trading_alert_events_currency_check
    check (currency is null or (currency = upper(btrim(currency)) and currency ~ '^[A-Z0-9]{3,8}$')),
  constraint client_trading_alert_events_details_check check (jsonb_typeof(details) = 'object'),
  constraint client_trading_alert_events_time_check
    check (resolved_at is null or resolved_at >= triggered_at)
);

create index if not exists client_trading_alert_events_client_timeline_idx
  on public.client_trading_alert_events(client_id, account_scope_id, triggered_at desc, id desc);
create index if not exists client_trading_alert_events_scope_type_idx
  on public.client_trading_alert_events(account_scope_id, alert_type, triggered_at desc);
create index if not exists client_trading_alert_events_retention_idx
  on public.client_trading_alert_events(plan_at_trigger, triggered_at);

create table if not exists public.client_trading_alert_states (
  id uuid primary key default gen_random_uuid(),
  account_scope_id uuid not null,
  client_id uuid not null,
  license_id uuid not null,
  platform text not null,
  alert_type text not null,
  active boolean not null default false,
  current_event_id uuid,
  current_value numeric(28,10),
  threshold_value numeric(28,10),
  currency text,
  activated_at timestamptz,
  last_observed_at timestamptz,
  resolved_at timestamptz,
  cooldown_until timestamptz,
  cursor_deal_time_msc numeric(20,0),
  cursor_deal_ticket numeric(20,0),
  cursor_initialized_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_trading_alert_states_scope_owner_fk
    foreign key (account_scope_id, client_id, license_id, platform)
    references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)
    on update no action on delete cascade deferrable initially deferred,
  constraint client_trading_alert_states_current_event_owner_fk
    foreign key (current_event_id, account_scope_id, client_id, license_id)
    references public.client_trading_alert_events(id, account_scope_id, client_id, license_id)
    on update no action on delete no action deferrable initially deferred,
  constraint client_trading_alert_states_scope_type_unique unique (account_scope_id, alert_type),
  constraint client_trading_alert_states_type_check check (alert_type in (
    'trade_cursor', 'connection_delayed', 'connection_offline',
    'daily_loss', 'drawdown', 'equity_floor'
  )),
  constraint client_trading_alert_states_platform_check check (platform in ('MT4', 'MT5')),
  constraint client_trading_alert_states_currency_check
    check (currency is null or (currency = upper(btrim(currency)) and currency ~ '^[A-Z0-9]{3,8}$')),
  constraint client_trading_alert_states_details_check check (jsonb_typeof(details) = 'object'),
  constraint client_trading_alert_states_cursor_check check (
    (
      alert_type = 'trade_cursor'
      and active = false
      and current_event_id is null
      and cursor_deal_time_msc is not null
      and cursor_deal_ticket is not null
      and cursor_initialized_at is not null
    )
    or (
      alert_type <> 'trade_cursor'
      and cursor_deal_time_msc is null
      and cursor_deal_ticket is null
      and cursor_initialized_at is null
    )
  ),
  constraint client_trading_alert_states_active_check check (
    (active = true and current_event_id is not null and activated_at is not null and resolved_at is null)
    or (active = false and current_event_id is null)
  )
);

create index if not exists client_trading_alert_states_active_idx
  on public.client_trading_alert_states(client_id, account_scope_id, alert_type)
  where active = true;
create index if not exists client_trading_alert_states_cursor_idx
  on public.client_trading_alert_states(account_scope_id, cursor_deal_time_msc, cursor_deal_ticket)
  where alert_type = 'trade_cursor';

create table if not exists public.client_trading_alert_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null default 'trading-alert-evaluator',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'Running',
  evaluator_version text,
  scopes_evaluated integer not null default 0,
  deals_evaluated integer not null default 0,
  alerts_created integer not null default 0,
  notifications_created integer not null default 0,
  states_opened integer not null default 0,
  states_resolved integer not null default 0,
  events_deduplicated integer not null default 0,
  error_code text,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint client_trading_alert_runs_job_check check (job_name in ('trading-alert-evaluator')),
  constraint client_trading_alert_runs_status_check check (status in ('Running', 'Succeeded', 'Failed')),
  constraint client_trading_alert_runs_version_check check (
    evaluator_version is null or (evaluator_version = btrim(evaluator_version) and char_length(evaluator_version) between 1 and 32)
  ),
  constraint client_trading_alert_runs_counts_check check (
    scopes_evaluated >= 0 and deals_evaluated >= 0 and alerts_created >= 0
    and notifications_created >= 0 and states_opened >= 0 and states_resolved >= 0
    and events_deduplicated >= 0
  ),
  constraint client_trading_alert_runs_completion_check check (
    (status = 'Running' and completed_at is null)
    or (status in ('Succeeded', 'Failed') and completed_at is not null)
  ),
  constraint client_trading_alert_runs_error_check check (
    (status <> 'Failed' and error_code is null and error_message is null)
    or (status = 'Failed' and error_code is not null and error_message is not null)
  ),
  constraint client_trading_alert_runs_details_check check (jsonb_typeof(details) = 'object')
);

create index if not exists client_trading_alert_runs_timeline_idx
  on public.client_trading_alert_runs(started_at desc);
create index if not exists client_trading_alert_runs_success_idx
  on public.client_trading_alert_runs(completed_at desc)
  where status = 'Succeeded';
create index if not exists client_trading_alert_runs_failed_idx
  on public.client_trading_alert_runs(completed_at desc)
  where status = 'Failed';

-- Daily loss starts from exit deals observed today, then aggregates only those
-- candidate positions across their full lifecycle. This avoids regrouping all
-- retained history for every scope on each one-minute evaluation.
create index if not exists orion_closed_deals_alert_daily_candidates_idx
  on public.orion_closed_deals(account_scope_id, deal_time, position_id)
  where entry in ('Out', 'OutBy') and position_id <> '0';
create index if not exists orion_closed_deals_scope_position_timeline_idx
  on public.orion_closed_deals(
    account_scope_id,
    position_id,
    deal_time_msc,
    ((deal_ticket)::numeric)
  );

drop trigger if exists client_trading_alert_preferences_updated_at on public.client_trading_alert_preferences;
create trigger client_trading_alert_preferences_updated_at
before update on public.client_trading_alert_preferences
for each row execute function public.set_updated_at();

drop trigger if exists client_trading_alert_states_updated_at on public.client_trading_alert_states;
create trigger client_trading_alert_states_updated_at
before update on public.client_trading_alert_states
for each row execute function public.set_updated_at();

alter table public.client_trading_alert_preferences enable row level security;
alter table public.client_trading_alert_states enable row level security;
alter table public.client_trading_alert_events enable row level security;
alter table public.client_trading_alert_runs enable row level security;

revoke all on table public.client_trading_alert_preferences from public, anon, authenticated, service_role;
revoke all on table public.client_trading_alert_states from public, anon, authenticated, service_role;
revoke all on table public.client_trading_alert_events from public, anon, authenticated, service_role;
revoke all on table public.client_trading_alert_runs from public, anon, authenticated, service_role;

grant select on table public.client_trading_alert_preferences to service_role;
grant select on table public.client_trading_alert_states to service_role;
grant select on table public.client_trading_alert_events to service_role;
grant select on table public.client_trading_alert_runs to service_role;

-- Persist one immutable alert event and, unless the caller requests cooldown
-- suppression, its existing Orion portal notification. This helper remains
-- private to the database owner and is called only by the evaluator.
create or replace function public._record_orion_trading_alert_event(
  p_account_scope_id uuid,
  p_client_id uuid,
  p_license_id uuid,
  p_platform text,
  p_alert_type text,
  p_severity text,
  p_plan text,
  p_source_key text,
  p_dedupe_key text,
  p_title text,
  p_message text,
  p_metric_value numeric,
  p_threshold_value numeric,
  p_currency text,
  p_details jsonb,
  p_triggered_at timestamptz,
  p_notify boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_notification_id uuid;
  v_event_created boolean := false;
  v_notification_created boolean := false;
begin
  -- Revalidate the exact entitlement immediately before emission, but never
  -- row-lock telemetry source records. Evaluation must not contend with or
  -- disrupt the EA ingestion transaction.
  perform 1
  from public.orion_telemetry_account_scopes as scope
  join public.licenses as licensed
    on licensed.id = scope.license_id
    and licensed.client_id = scope.client_id
    and licensed.platform = scope.platform
  join public.clients as client on client.id = scope.client_id
  join public.orion_telemetry_streams as stream
    on stream.account_scope_id = scope.id
    and stream.client_id = scope.client_id
    and stream.license_id = scope.license_id
    and stream.platform = scope.platform
    and stream.binding_version = licensed.binding_version
    and stream.status = 'Active'
  join public.license_installations as installation
    on installation.id = stream.installation_id
    and installation.license_id = stream.license_id
    and installation.client_id = stream.client_id
    and installation.platform = stream.platform
    and installation.status = 'Active'
  where scope.id = p_account_scope_id
    and scope.client_id = p_client_id
    and scope.license_id = p_license_id
    and scope.platform = p_platform
    and client.status = 'Active'
    and licensed.status = 'Active'
    and licensed.revoked_at is null
    and (licensed.expires_at is null or licensed.expires_at >= clock_timestamp())
    and licensed.plan = p_plan
    and (
      p_alert_type not in ('trade_opened', 'partial_close', 'daily_loss', 'drawdown', 'equity_floor')
      or licensed.plan in ('Premium', 'Lifetime')
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'TRADING_ALERT_ENTITLEMENT_CHANGED';
  end if;

  insert into public.client_trading_alert_events (
    account_scope_id, client_id, license_id, platform, alert_type, severity,
    plan_at_trigger, source_key, dedupe_key, title, message, metric_value,
    threshold_value, currency, details, notification_suppressed, triggered_at
  ) values (
    p_account_scope_id, p_client_id, p_license_id, p_platform, p_alert_type, p_severity,
    p_plan, p_source_key, p_dedupe_key, p_title, p_message, p_metric_value,
    p_threshold_value, p_currency, coalesce(p_details, '{}'::jsonb), not p_notify,
    coalesce(p_triggered_at, clock_timestamp())
  )
  on conflict (dedupe_key) do nothing
  returning id into v_event_id;
  v_event_created := found;

  if v_event_id is null then
    select event.id into v_event_id
    from public.client_trading_alert_events as event
    where event.dedupe_key = p_dedupe_key
      and event.account_scope_id = p_account_scope_id
      and event.client_id = p_client_id
      and event.license_id = p_license_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'TRADING_ALERT_DEDUPE_CONFLICT';
    end if;
  end if;

  if p_notify then
    insert into public.client_notifications (
      client_id, kind, title, message, href, dedupe_key
    ) values (
      p_client_id,
      'Trading',
      p_title,
      p_message,
      '/portal/trading#risk-alerts',
      'trading-alert:' || v_event_id::text
    )
    on conflict (dedupe_key) do nothing
    returning id into v_notification_id;
    v_notification_created := found;

    if v_notification_id is null then
      select notification.id into v_notification_id
      from public.client_notifications as notification
      where notification.dedupe_key = 'trading-alert:' || v_event_id::text
        and notification.client_id = p_client_id;
    end if;

    update public.client_trading_alert_events
    set notification_id = coalesce(notification_id, v_notification_id)
    where id = v_event_id;
  end if;

  return jsonb_build_object(
    'id', v_event_id,
    'created', v_event_created,
    'notified', v_notification_created
  );
end;
$$;

create or replace function public._open_orion_trading_alert_state(
  p_account_scope_id uuid,
  p_client_id uuid,
  p_license_id uuid,
  p_platform text,
  p_alert_type text,
  p_severity text,
  p_plan text,
  p_title text,
  p_message text,
  p_metric_value numeric,
  p_threshold_value numeric,
  p_currency text,
  p_details jsonb,
  p_bypass_cooldown boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.client_trading_alert_states%rowtype;
  v_event jsonb;
  v_event_id uuid;
  v_episode_id uuid := gen_random_uuid();
  v_suppressed boolean := false;
begin
  if p_alert_type not in (
    'connection_delayed', 'connection_offline', 'daily_loss', 'drawdown', 'equity_floor'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_TRADING_ALERT_STATE';
  end if;

  select * into v_state
  from public.client_trading_alert_states as state
  where state.account_scope_id = p_account_scope_id
    and state.alert_type = p_alert_type
  for update;

  if found and v_state.active then
    update public.client_trading_alert_states
    set current_value = p_metric_value,
        threshold_value = p_threshold_value,
        currency = p_currency,
        last_observed_at = v_now,
        details = coalesce(p_details, '{}'::jsonb)
    where id = v_state.id;
    return jsonb_build_object('opened', false, 'created', false, 'notified', false);
  end if;

  v_suppressed := not coalesce(p_bypass_cooldown, false)
    and v_state.cooldown_until is not null
    and v_state.cooldown_until > v_now;

  v_event := public._record_orion_trading_alert_event(
    p_account_scope_id,
    p_client_id,
    p_license_id,
    p_platform,
    p_alert_type,
    p_severity,
    p_plan,
    'state:' || p_account_scope_id::text || ':' || p_alert_type,
    'state:' || p_account_scope_id::text || ':' || p_alert_type || ':' || v_episode_id::text,
    p_title,
    p_message,
    p_metric_value,
    p_threshold_value,
    p_currency,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('cooldownSuppressed', v_suppressed),
    v_now,
    not v_suppressed
  );
  v_event_id := (v_event ->> 'id')::uuid;

  insert into public.client_trading_alert_states (
    account_scope_id, client_id, license_id, platform, alert_type, active,
    current_event_id, current_value, threshold_value, currency, activated_at,
    last_observed_at, resolved_at, cooldown_until, details
  ) values (
    p_account_scope_id, p_client_id, p_license_id, p_platform, p_alert_type, true,
    v_event_id, p_metric_value, p_threshold_value, p_currency, v_now,
    v_now, null, case when v_suppressed then v_state.cooldown_until else null end,
    coalesce(p_details, '{}'::jsonb)
  )
  on conflict (account_scope_id, alert_type) do update
  set client_id = excluded.client_id,
      license_id = excluded.license_id,
      platform = excluded.platform,
      active = true,
      current_event_id = excluded.current_event_id,
      current_value = excluded.current_value,
      threshold_value = excluded.threshold_value,
      currency = excluded.currency,
      activated_at = excluded.activated_at,
      last_observed_at = excluded.last_observed_at,
      resolved_at = null,
      cooldown_until = excluded.cooldown_until,
      details = excluded.details;

  return jsonb_build_object(
    'opened', true,
    'created', coalesce((v_event ->> 'created')::boolean, false),
    'notified', coalesce((v_event ->> 'notified')::boolean, false)
  );
end;
$$;

create or replace function public._resolve_orion_trading_alert_state(
  p_account_scope_id uuid,
  p_alert_type text,
  p_cooldown_until timestamptz,
  p_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.client_trading_alert_states%rowtype;
begin
  select * into v_state
  from public.client_trading_alert_states as state
  where state.account_scope_id = p_account_scope_id
    and state.alert_type = p_alert_type
  for update;

  if not found or not v_state.active then
    return false;
  end if;

  update public.client_trading_alert_events
  set resolved_at = coalesce(resolved_at, v_now),
      details = details || coalesce(p_details, '{}'::jsonb)
  where id = v_state.current_event_id;

  update public.client_trading_alert_states
  set active = false,
      current_event_id = null,
      resolved_at = v_now,
      cooldown_until = p_cooldown_until,
      last_observed_at = v_now,
      details = details || coalesce(p_details, '{}'::jsonb)
  where id = v_state.id;

  return true;
end;
$$;

-- The API supplies a complete preference snapshot. PostgreSQL re-proves scope
-- ownership and the active license plan. A Basic license cannot enable advanced
-- settings, but a base-setting save after a downgrade preserves the last valid
-- Premium/Lifetime thresholds for a possible future upgrade. Standard/Pro
-- membership is intentionally never consulted.
create or replace function public.set_orion_trading_alert_preferences(
  p_client_id uuid,
  p_account_scope_id uuid,
  p_connection_health boolean,
  p_connection_health_changed boolean,
  p_final_close boolean,
  p_trade_opened boolean,
  p_partial_close boolean,
  p_daily_loss_enabled boolean,
  p_daily_loss_limit numeric,
  p_drawdown_enabled boolean,
  p_drawdown_percent numeric,
  p_equity_floor_enabled boolean,
  p_equity_floor numeric,
  p_risk_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_scope public.orion_telemetry_account_scopes%rowtype;
  v_license public.licenses%rowtype;
  v_advanced boolean := false;
  v_currency text := upper(btrim(coalesce(p_risk_currency, '')));
begin
  if p_client_id is null or p_account_scope_id is null
    or p_connection_health is null or p_connection_health_changed is null
    or p_final_close is null
    or p_trade_opened is null or p_partial_close is null
    or p_daily_loss_enabled is null or p_drawdown_enabled is null
    or p_equity_floor_enabled is null
    or v_currency !~ '^[A-Z0-9]{3,8}$'
    or (p_daily_loss_limit is not null and p_daily_loss_limit not between 0.01 and 1000000000000)
    or (p_drawdown_percent is not null and p_drawdown_percent not between 1 and 90)
    or (p_equity_floor is not null and p_equity_floor not between 0.01 and 1000000000000)
    or (p_daily_loss_enabled and p_daily_loss_limit is null)
    or (p_drawdown_enabled and p_drawdown_percent is null)
    or (p_equity_floor_enabled and p_equity_floor is null) then
    raise exception using errcode = 'P0001', message = 'INVALID_TRADING_ALERT_PREFERENCES';
  end if;

  select scope.* into v_scope
  from public.orion_telemetry_account_scopes as scope
  where scope.id = p_account_scope_id
    and scope.client_id = p_client_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRADING_ALERT_SCOPE_NOT_FOUND';
  end if;

  select licensed.* into v_license
  from public.licenses as licensed
  join public.clients as client on client.id = licensed.client_id
  where licensed.id = v_scope.license_id
    and licensed.client_id = p_client_id
    and licensed.platform = v_scope.platform
    and licensed.status = 'Active'
    and licensed.revoked_at is null
    and (licensed.expires_at is null or licensed.expires_at >= v_now)
    and client.status = 'Active'
  for update of licensed;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRADING_ALERT_LICENSE_NOT_ACTIVE';
  end if;

  perform 1
  from public.orion_telemetry_streams as stream
  join public.license_installations as installation
    on installation.id = stream.installation_id
    and installation.license_id = stream.license_id
    and installation.client_id = stream.client_id
    and installation.platform = stream.platform
    and installation.status = 'Active'
  where stream.account_scope_id = v_scope.id
    and stream.client_id = p_client_id
    and stream.license_id = v_license.id
    and stream.platform = v_scope.platform
    and stream.binding_version = v_license.binding_version
    and stream.status = 'Active';
  if not found then
    raise exception using errcode = 'P0001', message = 'TRADING_ALERT_CONNECTION_NOT_ACTIVE';
  end if;

  v_advanced := v_license.plan in ('Premium', 'Lifetime');

  insert into public.client_trading_alert_preferences as preference (
    account_scope_id, client_id, license_id, platform,
    connection_health, connection_health_explicit, final_close, trade_opened, partial_close,
    daily_loss_enabled, daily_loss_limit, drawdown_enabled, drawdown_percent,
    equity_floor_enabled, equity_floor, risk_currency
  ) values (
    v_scope.id, p_client_id, v_license.id, v_scope.platform,
    p_connection_health, p_connection_health_changed, p_final_close,
    v_advanced and p_trade_opened,
    v_advanced and p_partial_close,
    v_advanced and p_daily_loss_enabled,
    case when v_advanced then p_daily_loss_limit else null end,
    v_advanced and p_drawdown_enabled,
    case when v_advanced then p_drawdown_percent else null end,
    v_advanced and p_equity_floor_enabled,
    case when v_advanced then p_equity_floor else null end,
    v_currency
  )
  on conflict (account_scope_id) do update
  set connection_health = case
        when p_connection_health_changed then excluded.connection_health
        else preference.connection_health
      end,
      final_close = excluded.final_close,
      trade_opened = case when v_advanced then excluded.trade_opened else preference.trade_opened end,
      partial_close = case when v_advanced then excluded.partial_close else preference.partial_close end,
      daily_loss_enabled = case when v_advanced then excluded.daily_loss_enabled else preference.daily_loss_enabled end,
      daily_loss_limit = case when v_advanced then excluded.daily_loss_limit else preference.daily_loss_limit end,
      drawdown_enabled = case when v_advanced then excluded.drawdown_enabled else preference.drawdown_enabled end,
      drawdown_percent = case when v_advanced then excluded.drawdown_percent else preference.drawdown_percent end,
      equity_floor_enabled = case when v_advanced then excluded.equity_floor_enabled else preference.equity_floor_enabled end,
      equity_floor = case when v_advanced then excluded.equity_floor else preference.equity_floor end,
      risk_currency = case when v_advanced then excluded.risk_currency else preference.risk_currency end,
      connection_health_explicit = preference.connection_health_explicit or p_connection_health_changed,
      updated_at = v_now;

  -- The same license row lock used by telemetry ingestion makes this initial
  -- cursor atomic with the preference save. Deals arriving after this point are
  -- evaluated normally; retained history present before the save is suppressed.
  insert into public.client_trading_alert_states (
    account_scope_id, client_id, license_id, platform, alert_type, active,
    cursor_deal_time_msc, cursor_deal_ticket, cursor_initialized_at,
    last_observed_at, details
  )
  select
    v_scope.id,
    p_client_id,
    v_license.id,
    v_scope.platform,
    'trade_cursor',
    false,
    coalesce(latest.deal_time_msc, 0),
    coalesce(latest.deal_ticket, 0),
    v_now,
    v_now,
    jsonb_build_object('historicalDealsSuppressed', true, 'initializedBy', 'preference_save')
  from (select 1) as seed
  left join lateral (
    select deal.deal_time_msc, deal.deal_ticket::numeric as deal_ticket
    from public.orion_closed_deals as deal
    where deal.account_scope_id = v_scope.id
      and deal.client_id = p_client_id
      and deal.license_id = v_license.id
      and deal.received_at <= v_now
    order by deal.deal_time_msc desc, deal.deal_ticket::numeric desc
    limit 1
  ) as latest on true
  on conflict (account_scope_id, alert_type) do nothing;

  return jsonb_build_object(
    'ok', true,
    'accountScopeId', v_scope.id,
    'plan', v_license.plan,
    'advanced', v_advanced
  );
end;
$$;

create or replace function public.cleanup_orion_trading_alerts(
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_event_ids uuid[] := '{}'::uuid[];
  v_notification_ids uuid[] := '{}'::uuid[];
  v_run_ids uuid[] := '{}'::uuid[];
  v_events_deleted integer := 0;
  v_notifications_deleted integer := 0;
  v_runs_deleted integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception using errcode = 'P0001', message = 'INVALID_TRADING_ALERT_CLEANUP_LIMIT';
  end if;

  select
    coalesce(array_agg(stale.id), '{}'::uuid[]),
    coalesce(array_agg(stale.notification_id) filter (where stale.notification_id is not null), '{}'::uuid[])
  into v_event_ids, v_notification_ids
  from (
    select event.id, event.notification_id
    from public.client_trading_alert_events as event
    where event.triggered_at < v_now - case event.plan_at_trigger
      when 'Basic' then interval '90 days'
      when 'Premium' then interval '365 days'
      else interval '1825 days'
    end
      and not exists (
        select 1
        from public.client_trading_alert_states as state
        where state.active = true
          and state.current_event_id = event.id
      )
    order by event.triggered_at, event.id
    limit p_limit
    for update of event skip locked
  ) as stale;

  if cardinality(v_notification_ids) > 0 then
    delete from public.client_notifications
    where id = any(v_notification_ids);
    get diagnostics v_notifications_deleted = row_count;
  end if;

  if cardinality(v_event_ids) > 0 then
    delete from public.client_trading_alert_events
    where id = any(v_event_ids);
    get diagnostics v_events_deleted = row_count;
  end if;

  select coalesce(array_agg(stale.id), '{}'::uuid[])
  into v_run_ids
  from (
    select run.id
    from public.client_trading_alert_runs as run
    where run.completed_at < v_now - interval '90 days'
    order by run.completed_at, run.id
    limit p_limit
    for update of run skip locked
  ) as stale;

  if cardinality(v_run_ids) > 0 then
    delete from public.client_trading_alert_runs
    where id = any(v_run_ids);
    get diagnostics v_runs_deleted = row_count;
  end if;

  return jsonb_build_object(
    'eventsDeleted', v_events_deleted,
    'notificationsDeleted', v_notifications_deleted,
    'runsDeleted', v_runs_deleted
  );
end;
$$;

create or replace function public.evaluate_orion_trading_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run_id uuid;
  v_lock_acquired boolean := false;
  v_scope record;
  v_cursor public.client_trading_alert_states%rowtype;
  v_deal record;
  v_state public.client_trading_alert_states%rowtype;
  v_emit jsonb;
  v_cleanup jsonb := '{}'::jsonb;
  v_cursor_time numeric(20,0);
  v_cursor_ticket numeric(20,0);
  v_entry_volume numeric := 0;
  v_exit_volume numeric := 0;
  v_remaining_volume numeric := 0;
  v_position_net_profit numeric := 0;
  v_original_side text;
  v_has_reversal boolean := false;
  v_age_seconds numeric;
  v_capture_age_seconds numeric;
  v_daily_loss numeric := 0;
  v_drawdown_percent numeric := 0;
  v_utc_day text := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD');
  v_scopes_evaluated integer := 0;
  v_deals_evaluated integer := 0;
  v_alerts_created integer := 0;
  v_notifications_created integer := 0;
  v_states_opened integer := 0;
  v_states_resolved integer := 0;
  v_events_deduplicated integer := 0;
begin
  v_lock_acquired := pg_try_advisory_xact_lock(hashtextextended('orion-trading-alerts-v1', 0));
  if not v_lock_acquired then
    -- A lock miss is not a successful evaluation and must not become the newest
    -- durable run, because that could mask a genuinely stuck evaluator.
    v_run_id := gen_random_uuid();
    return jsonb_build_object(
      'ok', true, 'runId', v_run_id, 'evaluatedAt', v_now,
      'scopesEvaluated', 0, 'dealsEvaluated', 0, 'alertsCreated', 0,
      'notificationsCreated', 0, 'statesOpened', 0, 'statesResolved', 0,
      'eventsDeduplicated', 0, 'skipped', true, 'reason', 'concurrent_evaluation'
    );
  end if;

  insert into public.client_trading_alert_runs (
    job_name, started_at, status, evaluator_version
  ) values (
    'trading-alert-evaluator', v_now, 'Running', '1.0.0'
  ) returning id into v_run_id;

  -- Default preferences are created only by the evaluator, never by a trigger
  -- on telemetry tables. Per license, connection monitoring defaults to the
  -- newest eligible scope; older Demo/Real scopes remain opt-in.
  with eligible_scopes as (
    select
      scope.id as account_scope_id,
      scope.client_id,
      scope.license_id,
      scope.platform,
      licensed.plan,
      case when stream.currency ~ '^[A-Z0-9]{3,8}$' then stream.currency else 'USD' end as currency,
      row_number() over (
        partition by scope.license_id
        order by scope.last_seen_at desc nulls last, scope.created_at desc, scope.id desc
      ) as newest_rank
    from public.orion_telemetry_account_scopes as scope
    join public.orion_telemetry_streams as stream
      on stream.account_scope_id = scope.id
      and stream.client_id = scope.client_id
      and stream.license_id = scope.license_id
      and stream.status = 'Active'
    join public.licenses as licensed
      on licensed.id = scope.license_id
      and licensed.client_id = scope.client_id
      and licensed.platform = scope.platform
      and stream.binding_version = licensed.binding_version
    join public.clients as client on client.id = scope.client_id
    join public.license_installations as installation
      on installation.id = stream.installation_id
      and installation.license_id = licensed.id
      and installation.client_id = client.id
      and installation.status = 'Active'
    where client.status = 'Active'
      and licensed.status = 'Active'
      and licensed.revoked_at is null
      and (licensed.expires_at is null or licensed.expires_at >= v_now)
  )
  insert into public.client_trading_alert_preferences (
    account_scope_id, client_id, license_id, platform, connection_health,
    final_close, trade_opened, partial_close, risk_currency
  )
  select
    eligible.account_scope_id,
    eligible.client_id,
    eligible.license_id,
    eligible.platform,
    eligible.newest_rank = 1,
    true,
    eligible.plan in ('Premium', 'Lifetime'),
    eligible.plan in ('Premium', 'Lifetime'),
    eligible.currency
  from eligible_scopes as eligible
  on conflict (account_scope_id) do nothing;

  -- When a license first reports a newer Demo/Real scope, move only the
  -- automatic connection-health default. An explicit client choice is never
  -- overwritten by the evaluator.
  with eligible_scopes as (
    select
      scope.id as account_scope_id,
      row_number() over (
        partition by scope.license_id
        order by scope.last_seen_at desc nulls last, scope.created_at desc, scope.id desc
      ) as newest_rank
    from public.orion_telemetry_account_scopes as scope
    join public.orion_telemetry_streams as stream
      on stream.account_scope_id = scope.id
      and stream.client_id = scope.client_id
      and stream.license_id = scope.license_id
      and stream.status = 'Active'
    join public.licenses as licensed
      on licensed.id = scope.license_id
      and licensed.client_id = scope.client_id
      and licensed.platform = scope.platform
      and stream.binding_version = licensed.binding_version
    join public.clients as client on client.id = scope.client_id
    join public.license_installations as installation
      on installation.id = stream.installation_id
      and installation.license_id = licensed.id
      and installation.client_id = client.id
      and installation.status = 'Active'
    where client.status = 'Active'
      and licensed.status = 'Active'
      and licensed.revoked_at is null
      and (licensed.expires_at is null or licensed.expires_at >= v_now)
  )
  update public.client_trading_alert_preferences as preference
  set connection_health = eligible.newest_rank = 1,
      updated_at = v_now
  from eligible_scopes as eligible
  where preference.account_scope_id = eligible.account_scope_id
    and preference.connection_health_explicit = false
    and preference.connection_health is distinct from (eligible.newest_rank = 1);

  -- Initialize each historical cursor at the greatest retained deal tuple. No
  -- pre-existing deal can become a new client notification after deployment or
  -- after a client first opens the Risk Center.
  insert into public.client_trading_alert_states (
    account_scope_id, client_id, license_id, platform, alert_type, active,
    cursor_deal_time_msc, cursor_deal_ticket, cursor_initialized_at,
    last_observed_at, details
  )
  select
    preference.account_scope_id,
    preference.client_id,
    preference.license_id,
    preference.platform,
    'trade_cursor',
    false,
    coalesce(latest.deal_time_msc, 0),
    coalesce(latest.deal_ticket, 0),
    v_now,
    v_now,
    jsonb_build_object('historicalDealsSuppressed', true)
  from public.client_trading_alert_preferences as preference
  left join lateral (
    select deal.deal_time_msc, deal.deal_ticket::numeric as deal_ticket
    from public.orion_closed_deals as deal
    where deal.account_scope_id = preference.account_scope_id
      and deal.client_id = preference.client_id
      and deal.license_id = preference.license_id
      and deal.received_at <= v_now
    order by deal.deal_time_msc desc, deal.deal_ticket::numeric desc
    limit 1
  ) as latest on true
  where not exists (
    select 1
    from public.client_trading_alert_states as state
    where state.account_scope_id = preference.account_scope_id
      and state.alert_type = 'trade_cursor'
  )
  on conflict (account_scope_id, alert_type) do nothing;

  -- Process immutable trade events after the durable cursor. The cursor always
  -- advances, including while a rule is disabled, so enabling a rule cannot
  -- backfill earlier account history.
  for v_scope in
    select
      scope.id,
      scope.client_id,
      scope.license_id,
      scope.platform,
      licensed.plan,
      coalesce(stream.currency, preference.risk_currency, 'USD') as currency,
      preference.final_close,
      preference.trade_opened,
      preference.partial_close
    from public.client_trading_alert_preferences as preference
    join public.orion_telemetry_account_scopes as scope
      on scope.id = preference.account_scope_id
      and scope.client_id = preference.client_id
      and scope.license_id = preference.license_id
      and scope.platform = preference.platform
    join public.licenses as licensed
      on licensed.id = scope.license_id
      and licensed.client_id = scope.client_id
      and licensed.platform = scope.platform
    join public.clients as client on client.id = scope.client_id
    join public.orion_telemetry_streams as stream
      on stream.account_scope_id = scope.id
      and stream.client_id = scope.client_id
      and stream.license_id = scope.license_id
      and stream.status = 'Active'
      and stream.binding_version = licensed.binding_version
    join public.license_installations as installation
      on installation.id = stream.installation_id
      and installation.status = 'Active'
    where client.status = 'Active'
      and licensed.status = 'Active'
      and licensed.revoked_at is null
      and (licensed.expires_at is null or licensed.expires_at >= v_now)
  loop
    select * into v_cursor
    from public.client_trading_alert_states as state
    where state.account_scope_id = v_scope.id
      and state.alert_type = 'trade_cursor'
    for update;
    if not found then
      continue;
    end if;

    v_cursor_time := v_cursor.cursor_deal_time_msc;
    v_cursor_ticket := v_cursor.cursor_deal_ticket;

    for v_deal in
      select deal.*
      from public.orion_closed_deals as deal
      where deal.account_scope_id = v_scope.id
        and deal.client_id = v_scope.client_id
        and deal.license_id = v_scope.license_id
        and (deal.deal_time_msc, deal.deal_ticket::numeric) > (v_cursor_time, v_cursor_ticket)
      order by deal.deal_time_msc, deal.deal_ticket::numeric
      limit 500
    loop
      v_deals_evaluated := v_deals_evaluated + 1;
      v_cursor_time := v_deal.deal_time_msc;
      v_cursor_ticket := v_deal.deal_ticket::numeric;

      -- A telemetry transaction may have received a pre-activation deal before
      -- the cursor boundary but committed after the max-tuple snapshot. Advance
      -- past it without notifying; only post-activation receipts are eligible.
      if v_deal.received_at <= v_cursor.cursor_initialized_at then
        continue;
      end if;

      if v_deal.entry = 'In'
        and v_deal.position_id <> '0'
        and v_scope.plan in ('Premium', 'Lifetime')
        and v_scope.trade_opened
        and not exists (
          select 1
          from public.orion_closed_deals as earlier
          where earlier.account_scope_id = v_scope.id
            and earlier.position_id = v_deal.position_id
            and earlier.entry = 'In'
            and (earlier.deal_time_msc, earlier.deal_ticket::numeric)
              < (v_deal.deal_time_msc, v_deal.deal_ticket::numeric)
        ) then
        v_emit := public._record_orion_trading_alert_event(
          v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
          'trade_opened', 'info', v_scope.plan,
          'position:' || v_scope.id::text || ':' || v_deal.position_id,
          'trade-open:' || v_scope.id::text || ':' || v_deal.position_id,
          'Orion trade opened',
          v_deal.side || ' ' || v_deal.symbol || ' opened with volume ' || v_deal.volume::text || '.',
          null, null, v_scope.currency,
          jsonb_build_object(
            'dealTicket', v_deal.deal_ticket,
            'positionId', v_deal.position_id,
            'symbol', v_deal.symbol,
            'side', v_deal.side,
            'volume', v_deal.volume,
            'price', v_deal.price
          ),
          v_deal.deal_time,
          true
        );
        if coalesce((v_emit ->> 'created')::boolean, false) then
          v_alerts_created := v_alerts_created + 1;
        else
          v_events_deduplicated := v_events_deduplicated + 1;
        end if;
        if coalesce((v_emit ->> 'notified')::boolean, false) then
          v_notifications_created := v_notifications_created + 1;
        end if;
      elsif v_deal.entry in ('Out', 'OutBy') and v_deal.position_id <> '0' then
        select
          coalesce(sum(prior.volume) filter (where prior.entry = 'In'), 0),
          coalesce(sum(prior.volume) filter (where prior.entry in ('Out', 'OutBy')), 0),
          (
            array_agg(prior.side order by prior.deal_time_msc, prior.deal_ticket::numeric)
              filter (where prior.entry = 'In')
          )[1],
          coalesce(sum(prior.net_profit), 0),
          coalesce(bool_or(prior.entry = 'InOut'), false)
        into v_entry_volume, v_exit_volume, v_original_side, v_position_net_profit, v_has_reversal
        from public.orion_closed_deals as prior
        where prior.account_scope_id = v_scope.id
          and prior.position_id = v_deal.position_id
          and (prior.deal_time_msc, prior.deal_ticket::numeric)
            <= (v_deal.deal_time_msc, v_deal.deal_ticket::numeric);

        if v_entry_volume > 0 and not v_has_reversal and v_original_side in ('Buy', 'Sell') then
          v_remaining_volume := greatest(v_entry_volume - v_exit_volume, 0);

          if v_remaining_volume <= 0.00000001 and v_scope.final_close then
            v_emit := public._record_orion_trading_alert_event(
              v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
              'final_close', case when v_position_net_profit < 0 then 'warning' else 'info' end,
              v_scope.plan,
              'deal:' || v_scope.id::text || ':' || v_deal.deal_ticket,
              'trade-final-close:' || v_scope.id::text || ':' || v_deal.deal_ticket,
              'Orion trade closed',
              v_original_side || ' ' || v_deal.symbol || ' closed. Net result ' ||
                coalesce(v_scope.currency, '') || ' ' || round(v_position_net_profit, 2)::text || '.',
              v_position_net_profit, null, v_scope.currency,
              jsonb_build_object(
                'dealTicket', v_deal.deal_ticket,
                'positionId', v_deal.position_id,
                'symbol', v_deal.symbol,
                'side', v_original_side,
                'closedVolume', v_deal.volume,
                'remainingVolume', v_remaining_volume,
                'price', v_deal.price,
                'netProfit', v_position_net_profit,
                'closingDealNetProfit', v_deal.net_profit
              ),
              v_deal.deal_time,
              true
            );
          elsif v_remaining_volume > 0
            and v_scope.plan in ('Premium', 'Lifetime')
            and v_scope.partial_close then
            v_emit := public._record_orion_trading_alert_event(
              v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
              'partial_close', 'info', v_scope.plan,
              'deal:' || v_scope.id::text || ':' || v_deal.deal_ticket,
              'trade-partial-close:' || v_scope.id::text || ':' || v_deal.deal_ticket,
              'Orion partial close recorded',
              v_original_side || ' ' || v_deal.symbol || ' partially closed. Remaining volume ' ||
                round(v_remaining_volume, 8)::text || '.',
              v_deal.net_profit, null, v_scope.currency,
              jsonb_build_object(
                'dealTicket', v_deal.deal_ticket,
                'positionId', v_deal.position_id,
                'symbol', v_deal.symbol,
                'side', v_original_side,
                'closedVolume', v_deal.volume,
                'remainingVolume', v_remaining_volume,
                'price', v_deal.price,
                'netProfit', v_deal.net_profit
              ),
              v_deal.deal_time,
              true
            );
          else
            v_emit := null;
          end if;

          if v_emit is not null and coalesce((v_emit ->> 'created')::boolean, false) then
            v_alerts_created := v_alerts_created + 1;
          elsif v_emit is not null then
            v_events_deduplicated := v_events_deduplicated + 1;
          end if;
          if v_emit is not null and coalesce((v_emit ->> 'notified')::boolean, false) then
            v_notifications_created := v_notifications_created + 1;
          end if;
        end if;
      end if;
    end loop;

    update public.client_trading_alert_states
    set cursor_deal_time_msc = v_cursor_time,
        cursor_deal_ticket = v_cursor_ticket,
        last_observed_at = v_now,
        details = details || jsonb_build_object('lastProcessedAt', v_now)
    where id = v_cursor.id;
  end loop;

  -- Stateful connection and risk rules use only a current license binding and
  -- active installation. Financial rules never evaluate stale account values.
  for v_scope in
    select
      scope.id,
      scope.client_id,
      scope.license_id,
      scope.platform,
      licensed.plan,
      stream.last_seen_at,
      stream.last_captured_at,
      stream.balance,
      stream.equity,
      stream.open_position_count,
      stream.currency,
      preference.risk_currency,
      preference.connection_health,
      preference.daily_loss_enabled,
      preference.daily_loss_limit,
      preference.drawdown_enabled,
      preference.drawdown_percent,
      preference.equity_floor_enabled,
      preference.equity_floor
    from public.client_trading_alert_preferences as preference
    join public.orion_telemetry_account_scopes as scope
      on scope.id = preference.account_scope_id
      and scope.client_id = preference.client_id
      and scope.license_id = preference.license_id
      and scope.platform = preference.platform
    join public.licenses as licensed
      on licensed.id = scope.license_id
      and licensed.client_id = scope.client_id
      and licensed.platform = scope.platform
    join public.clients as client on client.id = scope.client_id
    join public.orion_telemetry_streams as stream
      on stream.account_scope_id = scope.id
      and stream.client_id = scope.client_id
      and stream.license_id = scope.license_id
      and stream.status = 'Active'
      and stream.binding_version = licensed.binding_version
    join public.license_installations as installation
      on installation.id = stream.installation_id
      and installation.status = 'Active'
    where client.status = 'Active'
      and licensed.status = 'Active'
      and licensed.revoked_at is null
      and (licensed.expires_at is null or licensed.expires_at >= v_now)
  loop
    v_scopes_evaluated := v_scopes_evaluated + 1;
    v_age_seconds := case
      when v_scope.last_seen_at is null then null
      else greatest(0, extract(epoch from (v_now - v_scope.last_seen_at)))
    end;
    v_capture_age_seconds := case
      when v_scope.last_captured_at is null then null
      else greatest(0, extract(epoch from (v_now - v_scope.last_captured_at)))
    end;

    if not v_scope.connection_health or v_age_seconds is null or v_age_seconds <= 180 then
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'connection_delayed', v_now + interval '30 minutes',
        jsonb_build_object('recoveredAt', v_now)
      ) then v_states_resolved := v_states_resolved + 1; end if;
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'connection_offline', v_now + interval '30 minutes',
        jsonb_build_object('recoveredAt', v_now)
      ) then v_states_resolved := v_states_resolved + 1; end if;
    elsif v_age_seconds <= 600 then
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'connection_offline', null,
        jsonb_build_object('downgradedToDelayedAt', v_now)
      ) then v_states_resolved := v_states_resolved + 1; end if;
      v_emit := public._open_orion_trading_alert_state(
        v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
        'connection_delayed', 'warning', v_scope.plan,
        'EA update delayed',
        'No Orion EA update has been received for more than 3 minutes.',
        v_age_seconds / 60, 3, null,
        jsonb_build_object('lastSeenAt', v_scope.last_seen_at, 'openPositions', v_scope.open_position_count),
        false
      );
      if coalesce((v_emit ->> 'opened')::boolean, false) then v_states_opened := v_states_opened + 1; end if;
      if coalesce((v_emit ->> 'created')::boolean, false) then v_alerts_created := v_alerts_created + 1; end if;
      if coalesce((v_emit ->> 'notified')::boolean, false) then v_notifications_created := v_notifications_created + 1; end if;
    else
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'connection_delayed', null,
        jsonb_build_object('escalatedToOfflineAt', v_now)
      ) then v_states_resolved := v_states_resolved + 1; end if;
      v_emit := public._open_orion_trading_alert_state(
        v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
        'connection_offline',
        case when v_scope.open_position_count > 0 then 'critical' else 'warning' end,
        v_scope.plan,
        case when v_scope.open_position_count > 0 then 'EA offline with open positions' else 'EA connection offline' end,
        case when v_scope.open_position_count > 0
          then 'The last Orion EA update reported open positions. Confirm the account directly in MetaTrader.'
          else 'No Orion EA update has been received for more than 10 minutes.'
        end,
        v_age_seconds / 60, 10, null,
        jsonb_build_object('lastSeenAt', v_scope.last_seen_at, 'openPositions', v_scope.open_position_count),
        v_scope.open_position_count > 0
      );
      if coalesce((v_emit ->> 'opened')::boolean, false) then v_states_opened := v_states_opened + 1; end if;
      if coalesce((v_emit ->> 'created')::boolean, false) then v_alerts_created := v_alerts_created + 1; end if;
      if coalesce((v_emit ->> 'notified')::boolean, false) then v_notifications_created := v_notifications_created + 1; end if;
    end if;

    -- A Basic downgrade immediately disables every advanced evaluator path. The
    -- stored preferences may remain for a future upgrade, but they cannot grant
    -- server-side access while the exact license plan is Basic.
    if v_scope.plan not in ('Premium', 'Lifetime') then
      for v_state in
        select * from public.client_trading_alert_states
        where account_scope_id = v_scope.id
          and active = true
          and alert_type in ('daily_loss', 'drawdown', 'equity_floor')
      loop
        if public._resolve_orion_trading_alert_state(
          v_scope.id, v_state.alert_type, null,
          jsonb_build_object('resolvedReason', 'plan_not_entitled')
        ) then v_states_resolved := v_states_resolved + 1; end if;
      end loop;
      continue;
    end if;

    -- Disabled rules resolve even while telemetry is stale. Enabled financial
    -- rules hold their last state until a fresh (<=3 minute) snapshot exists.
    if not v_scope.daily_loss_enabled then
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'daily_loss', null, jsonb_build_object('resolvedReason', 'rule_disabled')
      ) then v_states_resolved := v_states_resolved + 1; end if;
    end if;
    if not v_scope.drawdown_enabled then
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'drawdown', null, jsonb_build_object('resolvedReason', 'rule_disabled')
      ) then v_states_resolved := v_states_resolved + 1; end if;
    end if;
    if not v_scope.equity_floor_enabled then
      if public._resolve_orion_trading_alert_state(
        v_scope.id, 'equity_floor', null, jsonb_build_object('resolvedReason', 'rule_disabled')
      ) then v_states_resolved := v_states_resolved + 1; end if;
    end if;

    if v_capture_age_seconds is null or v_capture_age_seconds > 180 then
      continue;
    end if;

    if v_scope.currency is null
      or upper(v_scope.currency) <> upper(v_scope.risk_currency) then
      for v_state in
        select * from public.client_trading_alert_states
        where account_scope_id = v_scope.id
          and active = true
          and alert_type in ('daily_loss', 'equity_floor')
      loop
        if public._resolve_orion_trading_alert_state(
          v_scope.id, v_state.alert_type, null,
          jsonb_build_object('resolvedReason', 'account_currency_changed')
        ) then v_states_resolved := v_states_resolved + 1; end if;
      end loop;
    elsif v_scope.daily_loss_enabled then
      with today_candidates as (
        select distinct deal.position_id
        from public.orion_closed_deals as deal
        where deal.account_scope_id = v_scope.id
          and deal.client_id = v_scope.client_id
          and deal.deal_time >= date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
          and deal.entry in ('Out', 'OutBy')
          and deal.position_id <> '0'
      ), closed_positions as (
        select
          candidate.position_id,
          min(history.deal_time) filter (where history.entry = 'In') as opened_at,
          max(history.deal_time) filter (where history.entry in ('Out', 'OutBy')) as closed_at,
          (
            array_agg(history.symbol order by history.deal_time_msc, history.deal_ticket::numeric)
              filter (where history.entry = 'In')
          )[1] as symbol,
          (
            array_agg(history.side order by history.deal_time_msc, history.deal_ticket::numeric)
              filter (where history.entry = 'In')
          )[1] as original_side,
          sum(history.net_profit) as net_profit,
          coalesce(bool_or(history.entry = 'InOut'), false) as has_netting_reversal
        from today_candidates as candidate
        join public.orion_closed_deals as history
          on history.account_scope_id = v_scope.id
          and history.client_id = v_scope.client_id
          and history.position_id = candidate.position_id
        group by candidate.position_id
      )
      select greatest(-coalesce(sum(closed.net_profit), 0), 0)
      into v_daily_loss
      from closed_positions as closed
      where closed.opened_at is not null
        and closed.closed_at >= date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
        and closed.symbol is not null
        and closed.original_side in ('Buy', 'Sell')
        and not closed.has_netting_reversal
        and not exists (
          select 1
          from public.orion_open_positions as position
          where position.account_scope_id = v_scope.id
            and position.client_id = v_scope.client_id
            and position.position_id = closed.position_id
        );

      select * into v_state
      from public.client_trading_alert_states
      where account_scope_id = v_scope.id and alert_type = 'daily_loss';
      if found and v_state.active and coalesce(v_state.details ->> 'utcDay', '') <> v_utc_day then
        if public._resolve_orion_trading_alert_state(
          v_scope.id, 'daily_loss', null,
          jsonb_build_object('resolvedReason', 'utc_day_complete')
        ) then v_states_resolved := v_states_resolved + 1; end if;
      end if;

      if v_daily_loss >= v_scope.daily_loss_limit then
        v_emit := public._open_orion_trading_alert_state(
          v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
          'daily_loss', 'critical', v_scope.plan,
          'Daily loss limit reached',
          'Today''s fully closed Orion positions reached a net loss of ' ||
            v_scope.currency || ' ' || round(v_daily_loss, 2)::text || '.',
          v_daily_loss, v_scope.daily_loss_limit, v_scope.currency,
          jsonb_build_object('utcDay', v_utc_day, 'calculation', 'fully_closed_orion_positions'),
          false
        );
        if coalesce((v_emit ->> 'opened')::boolean, false) then v_states_opened := v_states_opened + 1; end if;
        if coalesce((v_emit ->> 'created')::boolean, false) then v_alerts_created := v_alerts_created + 1; end if;
        if coalesce((v_emit ->> 'notified')::boolean, false) then v_notifications_created := v_notifications_created + 1; end if;
      end if;
    end if;

    if v_scope.drawdown_enabled and v_scope.balance is not null and v_scope.balance > 0 and v_scope.equity is not null then
      v_drawdown_percent := greatest((v_scope.balance - v_scope.equity) / v_scope.balance * 100, 0);
      if v_drawdown_percent >= v_scope.drawdown_percent then
        v_emit := public._open_orion_trading_alert_state(
          v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
          'drawdown', 'critical', v_scope.plan,
          'Floating drawdown threshold reached',
          'Current balance-to-equity drawdown reached ' || round(v_drawdown_percent, 2)::text || '%.',
          v_drawdown_percent, v_scope.drawdown_percent, null,
          jsonb_build_object('balance', v_scope.balance, 'equity', v_scope.equity, 'calculation', 'balance_to_equity'),
          false
        );
        if coalesce((v_emit ->> 'opened')::boolean, false) then v_states_opened := v_states_opened + 1; end if;
        if coalesce((v_emit ->> 'created')::boolean, false) then v_alerts_created := v_alerts_created + 1; end if;
        if coalesce((v_emit ->> 'notified')::boolean, false) then v_notifications_created := v_notifications_created + 1; end if;
      elsif v_drawdown_percent <= greatest(v_scope.drawdown_percent - 1, v_scope.drawdown_percent * 0.9) then
        if public._resolve_orion_trading_alert_state(
          v_scope.id, 'drawdown', v_now + interval '30 minutes',
          jsonb_build_object('recoveredAt', v_now, 'recoveredValue', v_drawdown_percent)
        ) then v_states_resolved := v_states_resolved + 1; end if;
      end if;
    end if;

    if upper(v_scope.currency) = upper(v_scope.risk_currency)
      and v_scope.equity_floor_enabled and v_scope.equity is not null then
      if v_scope.equity <= v_scope.equity_floor then
        v_emit := public._open_orion_trading_alert_state(
          v_scope.id, v_scope.client_id, v_scope.license_id, v_scope.platform,
          'equity_floor', 'critical', v_scope.plan,
          'Account equity floor reached',
          'Account equity is ' || v_scope.currency || ' ' || round(v_scope.equity, 2)::text || '.',
          v_scope.equity, v_scope.equity_floor, v_scope.currency,
          jsonb_build_object('balance', v_scope.balance, 'equity', v_scope.equity),
          false
        );
        if coalesce((v_emit ->> 'opened')::boolean, false) then v_states_opened := v_states_opened + 1; end if;
        if coalesce((v_emit ->> 'created')::boolean, false) then v_alerts_created := v_alerts_created + 1; end if;
        if coalesce((v_emit ->> 'notified')::boolean, false) then v_notifications_created := v_notifications_created + 1; end if;
      elsif v_scope.equity >= v_scope.equity_floor * 1.02 then
        if public._resolve_orion_trading_alert_state(
          v_scope.id, 'equity_floor', v_now + interval '30 minutes',
          jsonb_build_object('recoveredAt', v_now, 'recoveredValue', v_scope.equity)
        ) then v_states_resolved := v_states_resolved + 1; end if;
      end if;
    end if;
  end loop;

  -- Resolve states whose client, license, installation, binding, or stream is no
  -- longer eligible. Never leave a stale breach permanently open after access is
  -- revoked or an installation is replaced.
  for v_state in
    select state.*
    from public.client_trading_alert_states as state
    where state.active = true
      and state.alert_type <> 'trade_cursor'
      and not exists (
        select 1
        from public.orion_telemetry_streams as stream
        join public.licenses as licensed
          on licensed.id = stream.license_id
          and licensed.client_id = stream.client_id
          and stream.binding_version = licensed.binding_version
        join public.clients as client on client.id = stream.client_id
        join public.license_installations as installation
          on installation.id = stream.installation_id
          and installation.status = 'Active'
        where stream.account_scope_id = state.account_scope_id
          and stream.client_id = state.client_id
          and stream.license_id = state.license_id
          and stream.status = 'Active'
          and client.status = 'Active'
          and licensed.status = 'Active'
          and licensed.revoked_at is null
          and (licensed.expires_at is null or licensed.expires_at >= v_now)
      )
  loop
    if public._resolve_orion_trading_alert_state(
      v_state.account_scope_id, v_state.alert_type, null,
      jsonb_build_object('resolvedReason', 'source_ineligible')
    ) then v_states_resolved := v_states_resolved + 1; end if;
  end loop;

  v_cleanup := public.cleanup_orion_trading_alerts(500);

  update public.client_trading_alert_runs
  set completed_at = clock_timestamp(),
      status = 'Succeeded',
      scopes_evaluated = v_scopes_evaluated,
      deals_evaluated = v_deals_evaluated,
      alerts_created = v_alerts_created,
      notifications_created = v_notifications_created,
      states_opened = v_states_opened,
      states_resolved = v_states_resolved,
      events_deduplicated = v_events_deduplicated,
      details = jsonb_build_object(
        'onlineThresholdSeconds', 180,
        'offlineThresholdSeconds', 600,
        'tradeBatchLimitPerScope', 500,
        'dailyLossTimeZone', 'UTC',
        'cleanup', v_cleanup
      )
  where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'runId', v_run_id,
    'evaluatedAt', v_now,
    'scopesEvaluated', v_scopes_evaluated,
    'dealsEvaluated', v_deals_evaluated,
    'alertsCreated', v_alerts_created,
    'notificationsCreated', v_notifications_created,
    'statesOpened', v_states_opened,
    'statesResolved', v_states_resolved,
    'eventsDeduplicated', v_events_deduplicated
  );
exception when others then
  insert into public.client_trading_alert_runs (
    job_name, started_at, completed_at, status, evaluator_version,
    error_code, error_message, details
  ) values (
    'trading-alert-evaluator', v_now, clock_timestamp(), 'Failed', '1.0.0',
    sqlstate, left(sqlerrm, 500), '{}'::jsonb
  ) returning id into v_run_id;

  return jsonb_build_object(
    'ok', false,
    'runId', v_run_id,
    'evaluatedAt', v_now,
    'code', 'ALERT_EVALUATOR_FAILED',
    'scopesEvaluated', 0,
    'dealsEvaluated', 0,
    'alertsCreated', 0,
    'notificationsCreated', 0,
    'statesOpened', 0,
    'statesResolved', 0,
    'eventsDeduplicated', 0
  );
end;
$$;

revoke all on function public._record_orion_trading_alert_event(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  numeric, numeric, text, jsonb, timestamptz, boolean
) from public, anon, authenticated, service_role;
revoke all on function public._open_orion_trading_alert_state(
  uuid, uuid, uuid, text, text, text, text, text, text,
  numeric, numeric, text, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function public._resolve_orion_trading_alert_state(
  uuid, text, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.set_orion_trading_alert_preferences(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, numeric,
  boolean, numeric, boolean, numeric, text
) from public, anon, authenticated;
revoke all on function public.cleanup_orion_trading_alerts(integer)
  from public, anon, authenticated;
revoke all on function public.evaluate_orion_trading_alerts()
  from public, anon, authenticated;

grant execute on function public.set_orion_trading_alert_preferences(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, numeric,
  boolean, numeric, boolean, numeric, text
) to service_role;
grant execute on function public.cleanup_orion_trading_alerts(integer) to service_role;
grant execute on function public.evaluate_orion_trading_alerts() to service_role;

-- Production activation through Supabase Cron / pg_cron. Keep this evaluator
-- independent from telemetry ingestion and run it frequently enough for portal
-- notifications (the portal itself refreshes notifications once per minute):
-- select cron.schedule(
--   'orion-trading-alert-evaluator',
--   '* * * * *',
--   'select public.evaluate_orion_trading_alerts();'
-- );
