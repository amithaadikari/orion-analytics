-- Orion V5.2 trading reliability center.
--
-- This migration adds server-owned operational incidents and durable scheduled
-- job evidence. It does not grant a browser role access to raw trading data and
-- it cannot change license authorization or execute/manage trades.

create extension if not exists pgcrypto;

create table if not exists public.trading_reliability_incidents (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  incident_type text not null,
  severity text not null,
  status text not null default 'Open',
  stream_id uuid references public.orion_telemetry_streams(id) on delete set null,
  account_scope_id uuid references public.orion_telemetry_account_scopes(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  license_id uuid references public.licenses(id) on delete set null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.admins(id) on delete set null,
  acknowledged_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trading_reliability_incidents_dedupe_check
    check (dedupe_key = btrim(dedupe_key) and char_length(dedupe_key) between 8 and 180),
  constraint trading_reliability_incidents_type_check
    check (incident_type in ('offline_with_open_positions', 'offline_stream', 'rejection_spike')),
  constraint trading_reliability_incidents_severity_check
    check (severity in ('critical', 'high', 'warning')),
  constraint trading_reliability_incidents_status_check
    check (status in ('Open', 'Resolved')),
  constraint trading_reliability_incidents_summary_check
    check (summary = btrim(summary) and char_length(summary) between 4 and 240),
  constraint trading_reliability_incidents_details_check
    check (jsonb_typeof(details) = 'object'),
  constraint trading_reliability_incidents_resolution_check
    check (
      (status = 'Open' and resolved_at is null)
      or (status = 'Resolved' and resolved_at is not null)
    ),
  constraint trading_reliability_incidents_ack_check
    check (
      (acknowledged_at is null and acknowledged_by is null and acknowledged_by_email is null)
      or (acknowledged_at is not null and acknowledged_by_email is not null)
    ),
  constraint trading_reliability_incidents_ack_email_check
    check (acknowledged_by_email is null or char_length(acknowledged_by_email) between 3 and 320),
  constraint trading_reliability_incidents_time_check
    check (last_detected_at >= first_detected_at)
);

create unique index if not exists trading_reliability_incidents_one_open_key_idx
  on public.trading_reliability_incidents(dedupe_key)
  where status = 'Open';
create index if not exists trading_reliability_incidents_open_priority_idx
  on public.trading_reliability_incidents(status, severity, last_detected_at desc);
create index if not exists trading_reliability_incidents_client_timeline_idx
  on public.trading_reliability_incidents(client_id, last_detected_at desc);
create index if not exists trading_reliability_incidents_stream_idx
  on public.trading_reliability_incidents(stream_id, last_detected_at desc);

create table if not exists public.trading_reliability_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'Running',
  evaluator_version text,
  streams_evaluated integer not null default 0,
  offline_with_open_positions_count integer not null default 0,
  offline_stream_count integer not null default 0,
  rejections_window_count integer not null default 0,
  rejection_spike_count integer not null default 0,
  incidents_detected integer not null default 0,
  incidents_opened integer not null default 0,
  incidents_refreshed integer not null default 0,
  incidents_resolved integer not null default 0,
  error_code text,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint trading_reliability_runs_job_check
    check (job_name in ('reliability-evaluator', 'telemetry-retention')),
  constraint trading_reliability_runs_status_check
    check (status in ('Running', 'Succeeded', 'Failed')),
  constraint trading_reliability_runs_version_check
    check (evaluator_version is null or (evaluator_version = btrim(evaluator_version) and char_length(evaluator_version) between 1 and 32)),
  constraint trading_reliability_runs_counts_check
    check (
      streams_evaluated >= 0
      and offline_with_open_positions_count >= 0
      and offline_stream_count >= 0
      and rejections_window_count >= 0
      and rejection_spike_count >= 0
      and incidents_detected >= 0
      and incidents_opened >= 0
      and incidents_refreshed >= 0
      and incidents_resolved >= 0
    ),
  constraint trading_reliability_runs_completion_check
    check (
      (status = 'Running' and completed_at is null)
      or (status in ('Succeeded', 'Failed') and completed_at is not null)
    ),
  constraint trading_reliability_runs_error_check
    check (
      (status <> 'Failed' and error_code is null and error_message is null)
      or (status = 'Failed' and error_code is not null and error_message is not null)
    ),
  constraint trading_reliability_runs_details_check
    check (jsonb_typeof(details) = 'object')
);

create index if not exists trading_reliability_runs_job_timeline_idx
  on public.trading_reliability_runs(job_name, started_at desc);
create index if not exists trading_reliability_runs_failed_idx
  on public.trading_reliability_runs(completed_at desc)
  where status = 'Failed';

drop trigger if exists trading_reliability_incidents_updated_at on public.trading_reliability_incidents;
create trigger trading_reliability_incidents_updated_at
before update on public.trading_reliability_incidents
for each row execute function public.set_updated_at();

alter table public.trading_reliability_incidents enable row level security;
alter table public.trading_reliability_runs enable row level security;

revoke all on table public.trading_reliability_incidents from public, anon, authenticated, service_role;
revoke all on table public.trading_reliability_runs from public, anon, authenticated, service_role;
grant select, update on table public.trading_reliability_incidents to service_role;
grant select, insert, update on table public.trading_reliability_runs to service_role;

create or replace function public.evaluate_orion_trading_reliability()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run_id uuid;
  v_existing_id uuid;
  v_stream record;
  v_dedupe_key text;
  v_active_keys text[] := array[]::text[];
  v_streams_evaluated integer := 0;
  v_offline_with_positions integer := 0;
  v_offline_streams integer := 0;
  v_rejections integer := 0;
  v_rejection_spikes integer := 0;
  v_detected integer := 0;
  v_opened integer := 0;
  v_refreshed integer := 0;
  v_resolved integer := 0;
  v_lock_acquired boolean := false;
begin
  -- Prevent overlapping scheduler/manual evaluations from racing the partial
  -- unique index or producing misleading job evidence.
  v_lock_acquired := pg_try_advisory_xact_lock(hashtextextended('orion-trading-reliability-v1', 0));
  if not v_lock_acquired then
    insert into public.trading_reliability_runs (
      job_name, started_at, completed_at, status, evaluator_version, details
    ) values (
      'reliability-evaluator', v_now, clock_timestamp(), 'Succeeded', '1.0.0',
      jsonb_build_object('skipped', true, 'reason', 'concurrent_evaluation')
    ) returning id into v_run_id;
    return jsonb_build_object(
      'ok', true, 'runId', v_run_id, 'evaluatedAt', v_now,
      'streamsEvaluated', 0, 'offlineWithOpenPositions', 0,
      'offlineStreams', 0, 'rejectionsWindow', 0, 'rejectionSpikes', 0,
      'incidentsDetected', 0, 'incidentsOpened', 0,
      'incidentsRefreshed', 0, 'incidentsResolved', 0
    );
  end if;

  insert into public.trading_reliability_runs (
    job_name, started_at, status, evaluator_version
  ) values (
    'reliability-evaluator', v_now, 'Running', '1.0.0'
  ) returning id into v_run_id;

  select count(*)::integer into v_streams_evaluated
  from public.orion_telemetry_streams as stream
  join public.licenses as license on license.id = stream.license_id
  join public.clients as client on client.id = stream.client_id
  join public.license_installations as installation on installation.id = stream.installation_id
  where stream.status = 'Active'
    and stream.binding_version = license.binding_version
    and license.status = 'Active'
    and license.revoked_at is null
    and (license.expires_at is null or license.expires_at >= v_now)
    and client.status = 'Active'
    and installation.status = 'Active';

  for v_stream in
    select stream.id, stream.account_scope_id, stream.client_id, stream.license_id,
           stream.last_seen_at, stream.open_position_count, stream.ea_version,
           stream.platform, stream.terminal_connected
    from public.orion_telemetry_streams as stream
    join public.licenses as license on license.id = stream.license_id
    join public.clients as client on client.id = stream.client_id
    join public.license_installations as installation on installation.id = stream.installation_id
    where stream.status = 'Active'
      and stream.last_seen_at < v_now - interval '10 minutes'
      and stream.binding_version = license.binding_version
      and license.status = 'Active'
      and license.revoked_at is null
      and (license.expires_at is null or license.expires_at >= v_now)
      and client.status = 'Active'
      and installation.status = 'Active'
  loop
    if v_stream.open_position_count > 0 then
      v_dedupe_key := 'stream:' || v_stream.id::text || ':offline-with-open-positions';
      v_offline_with_positions := v_offline_with_positions + 1;
    else
      v_dedupe_key := 'stream:' || v_stream.id::text || ':offline';
      v_offline_streams := v_offline_streams + 1;
    end if;
    v_active_keys := array_append(v_active_keys, v_dedupe_key);
    v_detected := v_detected + 1;

    select id into v_existing_id
    from public.trading_reliability_incidents
    where dedupe_key = v_dedupe_key and status = 'Open'
    for update;

    if v_existing_id is null then
      insert into public.trading_reliability_incidents (
        dedupe_key, incident_type, severity, status, stream_id,
        account_scope_id, client_id, license_id, summary, details,
        first_detected_at, last_detected_at
      ) values (
        v_dedupe_key,
        case when v_stream.open_position_count > 0 then 'offline_with_open_positions' else 'offline_stream' end,
        case when v_stream.open_position_count > 0 then 'critical' else 'warning' end,
        'Open', v_stream.id, v_stream.account_scope_id, v_stream.client_id, v_stream.license_id,
        case when v_stream.open_position_count > 0
          then 'EA offline with last-reported open positions'
          else 'EA connection offline'
        end,
        jsonb_build_object(
          'lastSeenAt', v_stream.last_seen_at,
          'openPositions', v_stream.open_position_count,
          'eaVersion', v_stream.ea_version,
          'platform', v_stream.platform,
          'terminalConnected', v_stream.terminal_connected,
          'offlineThresholdMinutes', 10
        ),
        v_now, v_now
      );
      v_opened := v_opened + 1;
    else
      update public.trading_reliability_incidents
      set incident_type = case when v_stream.open_position_count > 0 then 'offline_with_open_positions' else 'offline_stream' end,
          severity = case when v_stream.open_position_count > 0 then 'critical' else 'warning' end,
          summary = case when v_stream.open_position_count > 0
            then 'EA offline with last-reported open positions'
            else 'EA connection offline'
          end,
          details = jsonb_build_object(
            'lastSeenAt', v_stream.last_seen_at,
            'openPositions', v_stream.open_position_count,
            'eaVersion', v_stream.ea_version,
            'platform', v_stream.platform,
            'terminalConnected', v_stream.terminal_connected,
            'offlineThresholdMinutes', 10
          ),
          last_detected_at = v_now
      where id = v_existing_id;
      v_refreshed := v_refreshed + 1;
    end if;
    v_existing_id := null;
  end loop;

  select count(*)::integer into v_rejections
  from public.orion_telemetry_rejections
  where rejected_at >= v_now - interval '15 minutes';

  if v_rejections >= 25 then
    v_dedupe_key := 'global:telemetry-rejection-spike';
    v_active_keys := array_append(v_active_keys, v_dedupe_key);
    v_rejection_spikes := 1;
    v_detected := v_detected + 1;

    select id into v_existing_id
    from public.trading_reliability_incidents
    where dedupe_key = v_dedupe_key and status = 'Open'
    for update;

    if v_existing_id is null then
      insert into public.trading_reliability_incidents (
        dedupe_key, incident_type, severity, status, summary, details,
        first_detected_at, last_detected_at
      ) values (
        v_dedupe_key, 'rejection_spike', 'high', 'Open',
        'Telemetry rejection spike detected',
        jsonb_build_object('rejections', v_rejections, 'windowMinutes', 15, 'threshold', 25),
        v_now, v_now
      );
      v_opened := v_opened + 1;
    else
      update public.trading_reliability_incidents
      set severity = 'high',
          summary = 'Telemetry rejection spike detected',
          details = jsonb_build_object('rejections', v_rejections, 'windowMinutes', 15, 'threshold', 25),
          last_detected_at = v_now
      where id = v_existing_id;
      v_refreshed := v_refreshed + 1;
    end if;
    v_existing_id := null;
  end if;

  update public.trading_reliability_incidents
  set status = 'Resolved',
      resolved_at = v_now,
      details = details || jsonb_build_object('recoveredAt', v_now),
      updated_at = v_now
  where status = 'Open'
    and incident_type in ('offline_with_open_positions', 'offline_stream', 'rejection_spike')
    and not (dedupe_key = any(v_active_keys));
  get diagnostics v_resolved = row_count;

  update public.trading_reliability_runs
  set completed_at = clock_timestamp(),
      status = 'Succeeded',
      streams_evaluated = v_streams_evaluated,
      offline_with_open_positions_count = v_offline_with_positions,
      offline_stream_count = v_offline_streams,
      rejections_window_count = v_rejections,
      rejection_spike_count = v_rejection_spikes,
      incidents_detected = v_detected,
      incidents_opened = v_opened,
      incidents_refreshed = v_refreshed,
      incidents_resolved = v_resolved,
      details = jsonb_build_object(
        'offlineThresholdMinutes', 10,
        'rejectionWindowMinutes', 15,
        'rejectionThreshold', 25
      )
  where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'runId', v_run_id,
    'evaluatedAt', v_now,
    'streamsEvaluated', v_streams_evaluated,
    'offlineWithOpenPositions', v_offline_with_positions,
    'offlineStreams', v_offline_streams,
    'rejectionsWindow', v_rejections,
    'rejectionSpikes', v_rejection_spikes,
    'incidentsDetected', v_detected,
    'incidentsOpened', v_opened,
    'incidentsRefreshed', v_refreshed,
    'incidentsResolved', v_resolved
  );
exception when others then
  -- The exception subtransaction rolls back the Running row. Insert one
  -- sanitized failed result after rollback so the scheduler has durable proof.
  insert into public.trading_reliability_runs (
    job_name, started_at, completed_at, status, evaluator_version,
    error_code, error_message, details
  ) values (
    'reliability-evaluator', v_now, clock_timestamp(), 'Failed', '1.0.0',
    sqlstate, left(sqlerrm, 500), '{}'::jsonb
  ) returning id into v_run_id;

  return jsonb_build_object(
    'ok', false,
    'runId', v_run_id,
    'evaluatedAt', v_now,
    'code', 'EVALUATOR_FAILED'
  );
end;
$$;

revoke all on function public.evaluate_orion_trading_reliability() from public, anon, authenticated;
grant execute on function public.evaluate_orion_trading_reliability() to service_role;

-- Production activation (run after enabling Supabase Cron / pg_cron):
-- select cron.schedule(
--   'orion-trading-reliability-evaluator',
--   '*/5 * * * *',
--   'select public.evaluate_orion_trading_reliability();'
-- );
