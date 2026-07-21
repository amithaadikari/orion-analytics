-- Orion V5.1 automatic installation approval requests.
--
-- This is an additive layer over the existing manual Installation ID flow.
-- The EA may create a short-lived request only after the server independently
-- verifies the active license and exact Real or Demo identity. The client must
-- still approve from an MFA-verified portal session. Approval reuses the
-- existing atomic installation activation function and its replacement limit.

create table if not exists public.license_installation_requests (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null,
  client_id uuid not null,
  platform text not null,
  installation_hash text not null,
  installation_hint text not null,
  device_label text not null,
  account_number text not null,
  broker_server text not null,
  account_type text not null,
  poll_proof_hash text not null,
  match_code text,
  request_ip_hash text not null,
  binding_version_at_request integer not null,
  status text not null default 'Pending',
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by_auth_user_id uuid,
  resolution_reason text,
  activated_installation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint license_installation_requests_client_fk
    foreign key (client_id)
    references public.clients(id)
    on delete cascade,
  constraint license_installation_requests_license_owner_fk
    foreign key (license_id, client_id, platform)
    references public.licenses(id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_installation_requests_activation_fk
    foreign key (activated_installation_id, license_id, client_id, platform)
    references public.license_installations(id, license_id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_installation_requests_installation_hash_check
    check (installation_hash ~ '^[0-9a-f]{64}$'),
  constraint license_installation_requests_poll_hash_check
    check (poll_proof_hash ~ '^[0-9a-f]{64}$'),
  constraint license_installation_requests_ip_hash_check
    check (request_ip_hash ~ '^[0-9a-f]{64}$'),
  constraint license_installation_requests_hint_check
    check (installation_hint = btrim(installation_hint) and char_length(installation_hint) between 4 and 32),
  constraint license_installation_requests_label_check
    check (device_label = btrim(device_label) and char_length(device_label) between 2 and 60),
  constraint license_installation_requests_account_number_check
    check (account_number = btrim(account_number) and account_number ~ '^[0-9]{4,24}$'),
  constraint license_installation_requests_broker_server_check
    check (broker_server = btrim(broker_server) and char_length(broker_server) between 2 and 160),
  constraint license_installation_requests_platform_check
    check (platform in ('MT4', 'MT5')),
  constraint license_installation_requests_account_type_check
    check (account_type in ('Demo', 'Real')),
  constraint license_installation_requests_match_code_check
    check (match_code is null or match_code ~ '^[0-9]{6}$'),
  constraint license_installation_requests_binding_version_check
    check (binding_version_at_request >= 0),
  constraint license_installation_requests_status_check
    check (status in ('Pending', 'Approved', 'Rejected', 'Expired', 'Superseded')),
  constraint license_installation_requests_expiry_check
    check (
      expires_at > requested_at
      and expires_at <= requested_at + interval '10 minutes'
    ),
  constraint license_installation_requests_resolution_check
    check (
      (
        status = 'Pending'
        and match_code is not null
        and match_code ~ '^[0-9]{6}$'
        and resolved_at is null
        and resolved_by_auth_user_id is null
        and resolution_reason is null
        and activated_installation_id is null
      )
      or (
        status = 'Approved'
        and match_code is null
        and resolved_at is not null
        and resolution_reason is not null
        and activated_installation_id is not null
      )
      or (
        status in ('Rejected', 'Expired', 'Superseded')
        and match_code is null
        and resolved_at is not null
        and resolution_reason is not null
        and activated_installation_id is null
      )
    ),
  constraint license_installation_requests_id_owner_unique
    unique (id, license_id, client_id, platform)
);

-- Durable fixed-window counters protect the unauthenticated EA endpoint across
-- serverless instances. Only one hashed bucket row is retained per dimension;
-- raw IPs, license keys, Installation IDs, and request bodies are never stored.
create table if not exists public.license_installation_request_rate_limits (
  dimension text not null,
  identifier_hash text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (dimension, identifier_hash),
  constraint license_installation_request_rate_dimension_check
    check (dimension in ('IP', 'License', 'Installation')),
  constraint license_installation_request_rate_hash_check
    check (identifier_hash ~ '^[0-9a-f]{64}$'),
  constraint license_installation_request_rate_count_check
    check (attempt_count >= 1)
);

create unique index if not exists license_installation_requests_pending_license_idx
  on public.license_installation_requests(license_id)
  where status = 'Pending';
create unique index if not exists license_installation_requests_pending_installation_idx
  on public.license_installation_requests(installation_hash)
  where status = 'Pending';
create unique index if not exists license_installation_requests_pending_poll_idx
  on public.license_installation_requests(poll_proof_hash)
  where status = 'Pending';
create index if not exists license_installation_requests_client_idx
  on public.license_installation_requests(client_id, requested_at desc);
create index if not exists license_installation_requests_expiry_idx
  on public.license_installation_requests(expires_at)
  where status = 'Pending';
create index if not exists license_installation_requests_ip_window_idx
  on public.license_installation_requests(request_ip_hash, requested_at desc);
create index if not exists license_installation_request_rate_limits_updated_idx
  on public.license_installation_request_rate_limits(updated_at);

drop trigger if exists license_installation_requests_updated_at on public.license_installation_requests;
create trigger license_installation_requests_updated_at
before update on public.license_installation_requests
for each row execute function public.set_updated_at();

alter table public.license_installation_requests enable row level security;
alter table public.license_installation_request_rate_limits enable row level security;
revoke all on table public.license_installation_requests from public, anon, authenticated;
revoke all on table public.license_installation_request_rate_limits from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.license_installation_requests from service_role;
grant select on table public.license_installation_requests to service_role;

-- The device endpoint invokes this as a separate RPC after a recognized
-- create/poll result.
-- SKIP LOCKED makes maintenance non-blocking around an in-flight approval, and
-- the separate transaction prevents housekeeping row locks from being carried
-- into the installation advisory-lock path.
create or replace function public.cleanup_license_installation_approval_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expired integer := 0;
  v_deleted_buckets integer := 0;
begin
  with expired_requests as (
    select request.id
    from public.license_installation_requests as request
    where request.status = 'Pending'
      and request.expires_at <= v_now
    order by request.expires_at, request.id
    limit 1000
    for update skip locked
  )
  update public.license_installation_requests as request
  set status = 'Expired',
      match_code = null,
      resolved_at = v_now,
      resolution_reason = 'Request expired'
  from expired_requests
  where request.id = expired_requests.id;
  get diagnostics v_expired = row_count;

  with stale_buckets as (
    select bucket.dimension, bucket.identifier_hash
    from public.license_installation_request_rate_limits as bucket
    where bucket.updated_at < v_now - interval '24 hours'
    order by bucket.updated_at, bucket.dimension, bucket.identifier_hash
    limit 5000
    for update skip locked
  )
  delete from public.license_installation_request_rate_limits as bucket
  using stale_buckets
  where bucket.dimension = stale_buckets.dimension
    and bucket.identifier_hash = stale_buckets.identifier_hash;
  get diagnostics v_deleted_buckets = row_count;

  return jsonb_build_object(
    'expiredRequests', v_expired,
    'deletedRateLimitBuckets', v_deleted_buckets
  );
end;
$$;

create or replace function public.consume_license_installation_request_limit(
  p_dimension text,
  p_identifier_hash text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dimension text := btrim(coalesce(p_dimension, ''));
  v_identifier_hash text := lower(btrim(coalesce(p_identifier_hash, '')));
  v_count integer;
  v_window_started_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if v_dimension not in ('IP', 'License', 'Installation')
    or v_identifier_hash !~ '^[0-9a-f]{64}$'
    or p_limit is null
    or p_limit not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'INVALID_RATE_LIMIT_BUCKET';
  end if;

  insert into public.license_installation_request_rate_limits as bucket (
    dimension,
    identifier_hash,
    window_started_at,
    attempt_count,
    updated_at
  ) values (
    v_dimension,
    v_identifier_hash,
    v_now,
    1,
    v_now
  )
  on conflict (dimension, identifier_hash) do update
  set window_started_at = case
        when bucket.window_started_at <= v_now - interval '15 minutes' then v_now
        else bucket.window_started_at
      end,
      attempt_count = case
        when bucket.window_started_at <= v_now - interval '15 minutes' then 1
        else bucket.attempt_count + 1
      end,
      updated_at = v_now
  returning attempt_count, window_started_at
    into v_count, v_window_started_at;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'retryAt', v_window_started_at + interval '15 minutes'
  );
end;
$$;

create or replace function public.request_license_installation_approval(
  p_key_hash text,
  p_installation_hash text,
  p_installation_hint text,
  p_device_label text,
  p_account_number text,
  p_broker_server text,
  p_platform text,
  p_account_type text,
  p_poll_proof_hash text,
  p_match_code text,
  p_request_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
  target_license record;
  current_installation public.license_installations%rowtype;
  reserved_installation public.license_installations%rowtype;
  pending_request public.license_installation_requests%rowtype;
  demo_account public.license_demo_accounts%rowtype;
  v_key_hash text := lower(btrim(coalesce(p_key_hash, '')));
  v_installation_hash text := lower(btrim(coalesce(p_installation_hash, '')));
  v_installation_hint text := btrim(coalesce(p_installation_hint, ''));
  v_device_label text := btrim(coalesce(p_device_label, ''));
  v_account_number text := btrim(coalesce(p_account_number, ''));
  v_broker_server text := btrim(coalesce(p_broker_server, ''));
  v_platform text := upper(btrim(coalesce(p_platform, '')));
  v_account_type text := case upper(btrim(coalesce(p_account_type, '')))
    when 'DEMO' then 'Demo'
    when 'REAL' then 'Real'
    else ''
  end;
  v_poll_proof_hash text := lower(btrim(coalesce(p_poll_proof_hash, '')));
  v_match_code text := btrim(coalesce(p_match_code, ''));
  v_request_ip_hash text := lower(btrim(coalesce(p_request_ip_hash, '')));
  v_client_id uuid;
  v_license_id uuid;
  v_recent_license_requests integer := 0;
  v_retry_at timestamptz;
  v_rate_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_key_hash !~ '^[0-9a-f]{64}$'
    or v_installation_hash !~ '^[0-9a-f]{64}$'
    or char_length(v_installation_hint) not between 4 and 32
    or char_length(v_device_label) not between 2 and 60
    or v_account_number !~ '^[0-9]{4,24}$'
    or char_length(v_broker_server) not between 2 and 160
    or v_platform not in ('MT4', 'MT5')
    or v_account_type not in ('Demo', 'Real')
    or v_poll_proof_hash !~ '^[0-9a-f]{64}$'
    or v_match_code !~ '^[0-9]{6}$'
    or v_request_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'code', 'INVALID_REQUEST');
  end if;

  select public.consume_license_installation_request_limit('IP', v_request_ip_hash, 30)
    into v_rate_result;
  if coalesce((v_rate_result ->> 'allowed')::boolean, false) = false then
    return jsonb_build_object(
      'accepted', false,
      'code', 'PAIRING_REQUEST_RATE_LIMIT',
      'retryAt', v_rate_result ->> 'retryAt'
    );
  end if;

  select licensed.id, licensed.client_id
    into v_license_id, v_client_id
  from public.licenses as licensed
  where licensed.key_hash = v_key_hash
  limit 1;
  if not found then
    return jsonb_build_object('accepted', false, 'code', 'INVALID_LICENSE');
  end if;

  select public.consume_license_installation_request_limit('License', v_key_hash, 12)
    into v_rate_result;
  if coalesce((v_rate_result ->> 'allowed')::boolean, false) = false then
    return jsonb_build_object(
      'accepted', false,
      'code', 'PAIRING_REQUEST_RATE_LIMIT',
      'retryAt', v_rate_result ->> 'retryAt'
    );
  end if;
  select public.consume_license_installation_request_limit('Installation', v_installation_hash, 12)
    into v_rate_result;
  if coalesce((v_rate_result ->> 'allowed')::boolean, false) = false then
    return jsonb_build_object(
      'accepted', false,
      'code', 'PAIRING_REQUEST_RATE_LIMIT',
      'retryAt', v_rate_result ->> 'retryAt'
    );
  end if;

  select * into target_client
  from public.clients
  where id = v_client_id
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'code', 'INVALID_LICENSE');
  end if;

  select
    licensed.id,
    licensed.client_id,
    licensed.license_key,
    licensed.platform,
    licensed.status,
    licensed.expires_at,
    licensed.revoked_at,
    licensed.binding_version,
    licensed.trading_account_id,
    real_account.account_number as real_account_number,
    real_account.broker_server as real_broker_server,
    real_account.platform as real_platform,
    real_account.status as real_status,
    real_account.account_type as real_account_type,
    real_account.verified_at as real_verified_at
  into target_license
  from public.licenses as licensed
  left join public.client_trading_accounts as real_account
    on real_account.id = licensed.trading_account_id
  where licensed.id = v_license_id
    and licensed.client_id = target_client.id
    and licensed.key_hash = v_key_hash
  for update of licensed;
  if not found then
    return jsonb_build_object('accepted', false, 'code', 'INVALID_LICENSE');
  end if;
  v_now := clock_timestamp();

  if target_client.status <> 'Active'
    or target_license.status <> 'Active'
    or target_license.revoked_at is not null
    or (target_license.expires_at is not null and target_license.expires_at < v_now) then
    return jsonb_build_object('accepted', false, 'code', 'LICENSE_INACTIVE');
  end if;
  if target_license.platform <> v_platform then
    return jsonb_build_object('accepted', false, 'code', 'ACCOUNT_MISMATCH');
  end if;

  if v_account_type = 'Real' then
    if target_license.trading_account_id is null
      or target_license.real_status <> 'Active'
      or target_license.real_account_type <> 'Real'
      or target_license.real_verified_at is null then
      return jsonb_build_object('accepted', false, 'code', 'ACCOUNT_NOT_REGISTERED');
    end if;
    if target_license.real_account_number <> v_account_number
      or lower(btrim(target_license.real_broker_server)) <> lower(v_broker_server)
      or target_license.real_platform <> v_platform then
      return jsonb_build_object('accepted', false, 'code', 'ACCOUNT_MISMATCH');
    end if;
  else
    select * into demo_account
    from public.license_demo_accounts
    where license_id = target_license.id
      and status = 'Active';
    if not found then
      return jsonb_build_object('accepted', false, 'code', 'DEMO_ACCOUNT_NOT_REGISTERED');
    end if;
    if demo_account.account_number <> v_account_number
      or lower(btrim(demo_account.broker_server)) <> lower(v_broker_server)
      or demo_account.platform <> v_platform then
      return jsonb_build_object('accepted', false, 'code', 'DEMO_ACCOUNT_MISMATCH');
    end if;
  end if;

  select * into current_installation
  from public.license_installations
  where license_id = target_license.id
    and status = 'Active'
  for update;
  if current_installation.id is not null
    and current_installation.installation_hash = v_installation_hash then
    return jsonb_build_object(
      'accepted', true,
      'code', 'INSTALLATION_ALREADY_ACTIVE',
      'status', 'Approved'
    );
  end if;

  -- All request-row work for this installation follows the same H -> row
  -- order as manual activation and approval resolution. This avoids a cycle in
  -- which request creation holds an expired row while manual activation holds H.
  perform pg_advisory_xact_lock(hashtextextended('installation-id:' || v_installation_hash, 0));
  v_now := clock_timestamp();

  update public.license_installation_requests
  set status = 'Expired',
      match_code = null,
      resolved_at = v_now,
      resolution_reason = 'Request expired'
  where license_id = target_license.id
    and status = 'Pending'
    and expires_at <= v_now;

  select * into pending_request
  from public.license_installation_requests
  where license_id = target_license.id
    and status = 'Pending'
  for update;
  if found then
    if pending_request.installation_hash = v_installation_hash
      and pending_request.account_number = v_account_number
      and lower(btrim(pending_request.broker_server)) = lower(v_broker_server)
      and pending_request.platform = v_platform
      and pending_request.account_type = v_account_type
      and pending_request.poll_proof_hash = v_poll_proof_hash then
      return jsonb_build_object(
        'accepted', true,
        'code', 'PAIRING_PENDING',
        'status', 'Pending',
        'requestId', pending_request.id,
        'matchCode', pending_request.match_code,
        'expiresAt', pending_request.expires_at,
        'reused', true
      );
    end if;
    return jsonb_build_object(
      'accepted', false,
      'code', 'PAIRING_REQUEST_ALREADY_PENDING',
      'retryAt', pending_request.expires_at
    );
  end if;

  select count(*), min(requested_at) + interval '15 minutes'
    into v_recent_license_requests, v_retry_at
  from public.license_installation_requests
  where license_id = target_license.id
    and requested_at > v_now - interval '15 minutes';
  if v_recent_license_requests >= 5 then
    return jsonb_build_object(
      'accepted', false,
      'code', 'PAIRING_REQUEST_RATE_LIMIT',
      'retryAt', v_retry_at
    );
  end if;

  update public.license_installation_requests
  set status = 'Expired',
      match_code = null,
      resolved_at = v_now,
      resolution_reason = 'Request expired'
  where installation_hash = v_installation_hash
    and status = 'Pending'
    and expires_at <= v_now;

  select * into reserved_installation
  from public.license_installations
  where installation_hash = v_installation_hash;
  if reserved_installation.id is not null
    and (
      reserved_installation.license_id <> target_license.id
      or reserved_installation.client_id <> target_client.id
      or reserved_installation.platform <> target_license.platform
      or reserved_installation.status = 'Revoked'
    ) then
    return jsonb_build_object('accepted', false, 'code', 'PAIRING_UNAVAILABLE');
  end if;
  if exists (
    select 1
    from public.license_installation_requests
    where installation_hash = v_installation_hash
      and status = 'Pending'
  ) then
    return jsonb_build_object('accepted', false, 'code', 'PAIRING_UNAVAILABLE');
  end if;

  -- Start the ten-minute client window at the actual insert point, not before
  -- any lock wait above.
  v_now := clock_timestamp();
  insert into public.license_installation_requests (
    license_id,
    client_id,
    platform,
    installation_hash,
    installation_hint,
    device_label,
    account_number,
    broker_server,
    account_type,
    poll_proof_hash,
    match_code,
    request_ip_hash,
    binding_version_at_request,
    status,
    requested_at,
    expires_at
  ) values (
    target_license.id,
    target_client.id,
    target_license.platform,
    v_installation_hash,
    v_installation_hint,
    v_device_label,
    v_account_number,
    v_broker_server,
    v_account_type,
    v_poll_proof_hash,
    v_match_code,
    v_request_ip_hash,
    target_license.binding_version,
    'Pending',
    v_now,
    v_now + interval '10 minutes'
  ) returning * into pending_request;

  insert into public.client_activity (client_id, action, details, actor_email)
  values (
    target_client.id,
    'Installation approval requested',
    target_license.platform || ' · ' || v_installation_hint || ' · account ending ' || right(v_account_number, 4) || ' · license ' || right(target_license.license_key, 4),
    'EA request'
  );

  insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
  values (
    target_client.id,
    'Security',
    'New installation awaiting approval',
    'A ' || target_license.platform || ' installation requested access for the ' || v_account_type || ' account ending ' || right(v_account_number, 4) || '. Approve it only if the code matches your EA.',
    '/portal#license-pairing',
    'license-installation-request:' || pending_request.id::text
  ) on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'accepted', true,
    'code', 'PAIRING_PENDING',
    'status', 'Pending',
    'requestId', pending_request.id,
    'matchCode', pending_request.match_code,
    'expiresAt', pending_request.expires_at,
    'reused', false
  );
end;
$$;

create or replace function public.poll_license_installation_approval(
  p_request_id uuid,
  p_poll_proof_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_request public.license_installation_requests%rowtype;
  v_poll_proof_hash text := lower(btrim(coalesce(p_poll_proof_hash, '')));
  v_client_id uuid;
  v_license_id uuid;
  v_now timestamptz := clock_timestamp();
  v_code text;
begin
  if p_request_id is null or v_poll_proof_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('found', false, 'code', 'INVALID_PAIRING_REQUEST');
  end if;

  select client_id, license_id
    into v_client_id, v_license_id
  from public.license_installation_requests
  where id = p_request_id
    and poll_proof_hash = v_poll_proof_hash;
  if not found then
    return jsonb_build_object('found', false, 'code', 'INVALID_PAIRING_REQUEST');
  end if;

  perform 1 from public.clients where id = v_client_id for update;
  perform 1 from public.licenses where id = v_license_id and client_id = v_client_id for update;

  select * into target_request
  from public.license_installation_requests
  where id = p_request_id
    and client_id = v_client_id
    and license_id = v_license_id
    and poll_proof_hash = v_poll_proof_hash
  for update;
  if not found then
    return jsonb_build_object('found', false, 'code', 'INVALID_PAIRING_REQUEST');
  end if;

  v_now := clock_timestamp();
  if target_request.status = 'Pending' and target_request.expires_at <= v_now then
    update public.license_installation_requests
    set status = 'Expired',
        match_code = null,
        resolved_at = v_now,
        resolution_reason = 'Request expired'
    where id = target_request.id
      and status = 'Pending'
    returning * into target_request;
  end if;

  v_code := case target_request.status
    when 'Pending' then 'PAIRING_PENDING'
    when 'Approved' then 'PAIRING_APPROVED'
    when 'Rejected' then 'PAIRING_REJECTED'
    when 'Expired' then 'PAIRING_EXPIRED'
    else 'PAIRING_SUPERSEDED'
  end;
  return jsonb_build_object(
    'found', true,
    'code', v_code,
    'status', target_request.status,
    'expiresAt', target_request.expires_at,
    'resolvedAt', target_request.resolved_at
  );
end;
$$;

create or replace function public.resolve_license_installation_approval_client(
  p_auth_user_id uuid,
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
  target_license public.licenses%rowtype;
  target_request public.license_installation_requests%rowtype;
  demo_account public.license_demo_accounts%rowtype;
  real_account public.client_trading_accounts%rowtype;
  activation_result jsonb;
  v_decision text := case upper(btrim(coalesce(p_decision, '')))
    when 'APPROVE' then 'Approve'
    when 'REJECT' then 'Reject'
    else ''
  end;
  v_client_id uuid;
  v_license_id uuid;
  v_installation_hash text;
  v_installation_id uuid;
  v_actor_label text;
  v_now timestamptz := clock_timestamp();
begin
  if p_auth_user_id is null or p_request_id is null or v_decision = '' then
    raise exception using errcode = 'P0001', message = 'INVALID_PAIRING_DECISION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('installation-approval:' || p_request_id::text, 0));
  -- Acquire the activation function's request lock before any client or
  -- license row. Nested activation reacquires it in the same transaction.
  perform pg_advisory_xact_lock(hashtextextended('installation-request:' || p_request_id::text, 0));

  select client_id, license_id, installation_hash
    into v_client_id, v_license_id, v_installation_hash
  from public.license_installation_requests
  where id = p_request_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAIRING_REQUEST_NOT_FOUND';
  end if;

  select * into target_client
  from public.clients
  where auth_user_id = p_auth_user_id
  for update;
  if not found or target_client.id <> v_client_id then
    raise exception using errcode = 'P0001', message = 'PAIRING_REQUEST_NOT_FOUND';
  end if;

  select * into target_license
  from public.licenses
  where id = v_license_id
    and client_id = target_client.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAIRING_REQUEST_NOT_FOUND';
  end if;

  -- Manual activation for another license may use the same globally unique
  -- installation hash. Take this lock before the request row so its settlement
  -- trigger cannot deadlock with automatic approval.
  perform pg_advisory_xact_lock(hashtextextended('installation-id:' || v_installation_hash, 0));

  select * into target_request
  from public.license_installation_requests
  where id = p_request_id
    and client_id = target_client.id
    and license_id = target_license.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAIRING_REQUEST_NOT_FOUND';
  end if;
  v_actor_label := coalesce(target_client.email, 'client:' || target_client.id::text);
  v_now := clock_timestamp();

  if target_request.status <> 'Pending' then
    if (target_request.status = 'Approved' and v_decision = 'Approve')
      or (target_request.status = 'Rejected' and v_decision = 'Reject') then
      return jsonb_build_object(
        'changed', false,
        'idempotent', true,
        'status', target_request.status
      );
    end if;
    raise exception using errcode = 'P0001', message = 'PAIRING_REQUEST_ALREADY_RESOLVED';
  end if;

  if target_request.expires_at <= v_now then
    update public.license_installation_requests
    set status = 'Expired',
        match_code = null,
        resolved_at = v_now,
        resolution_reason = 'Request expired'
    where id = target_request.id;
    return jsonb_build_object('changed', true, 'status', 'Expired', 'code', 'PAIRING_EXPIRED');
  end if;

  if v_decision = 'Reject' then
    update public.license_installation_requests
    set status = 'Rejected',
        match_code = null,
        resolved_at = v_now,
        resolved_by_auth_user_id = p_auth_user_id,
        resolution_reason = 'Client rejected request'
    where id = target_request.id;
    insert into public.client_activity (client_id, action, details, actor_email)
    values (
      target_client.id,
      'Installation approval rejected',
      target_request.platform || ' · ' || target_request.installation_hint || ' · account ending ' || right(target_request.account_number, 4),
      v_actor_label
    );
    return jsonb_build_object('changed', true, 'idempotent', false, 'status', 'Rejected');
  end if;

  if target_client.status <> 'Active'
    or target_license.status <> 'Active'
    or target_license.revoked_at is not null
    or (target_license.expires_at is not null and target_license.expires_at < v_now) then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_ACTIVE';
  end if;
  if target_license.binding_version <> target_request.binding_version_at_request then
    update public.license_installation_requests
    set status = 'Superseded',
        match_code = null,
        resolved_at = v_now,
        resolved_by_auth_user_id = p_auth_user_id,
        resolution_reason = 'License binding changed'
    where id = target_request.id;
    return jsonb_build_object('changed', true, 'status', 'Superseded', 'code', 'PAIRING_SUPERSEDED');
  end if;

  if target_request.account_type = 'Real' then
    select * into real_account
    from public.client_trading_accounts
    where id = target_license.trading_account_id
      and client_id = target_client.id;
    if not found
      or real_account.status <> 'Active'
      or real_account.account_type <> 'Real'
      or real_account.verified_at is null
      or real_account.account_number <> target_request.account_number
      or lower(btrim(real_account.broker_server)) <> lower(btrim(target_request.broker_server))
      or real_account.platform <> target_request.platform
      or target_license.platform <> target_request.platform then
      update public.license_installation_requests
      set status = 'Superseded',
          match_code = null,
          resolved_at = v_now,
          resolved_by_auth_user_id = p_auth_user_id,
          resolution_reason = 'Registered account changed'
      where id = target_request.id;
      return jsonb_build_object('changed', true, 'status', 'Superseded', 'code', 'PAIRING_ACCOUNT_CHANGED');
    end if;
  else
    select * into demo_account
    from public.license_demo_accounts
    where license_id = target_license.id
      and status = 'Active';
    if not found
      or demo_account.account_number <> target_request.account_number
      or lower(btrim(demo_account.broker_server)) <> lower(btrim(target_request.broker_server))
      or demo_account.platform <> target_request.platform
      or target_license.platform <> target_request.platform then
      update public.license_installation_requests
      set status = 'Superseded',
          match_code = null,
          resolved_at = v_now,
          resolved_by_auth_user_id = p_auth_user_id,
          resolution_reason = 'Registered Demo account changed'
      where id = target_request.id;
      return jsonb_build_object('changed', true, 'status', 'Superseded', 'code', 'PAIRING_ACCOUNT_CHANGED');
    end if;
  end if;

  select public.activate_license_installation_client(
    p_auth_user_id,
    target_request.id,
    target_request.license_id,
    target_request.installation_hash,
    target_request.installation_hint,
    target_request.device_label
  ) into activation_result;

  v_installation_id := nullif(activation_result -> 'installation' ->> 'id', '')::uuid;
  if v_installation_id is null then
    raise exception using errcode = 'P0001', message = 'PAIRING_ACTIVATION_FAILED';
  end if;

  update public.license_installation_requests
  set status = 'Approved',
      match_code = null,
      resolved_at = coalesce(resolved_at, v_now),
      resolved_by_auth_user_id = p_auth_user_id,
      resolution_reason = 'Client approved request',
      activated_installation_id = v_installation_id
  where id = target_request.id
    and status in ('Pending', 'Approved');

  return jsonb_build_object(
    'changed', coalesce((activation_result ->> 'changed')::boolean, false),
    'idempotent', false,
    'status', 'Approved',
    'changeKind', activation_result ->> 'changeKind',
    'nextChangeAt', activation_result ->> 'nextChangeAt'
  );
end;
$$;

-- Manual pairing remains supported. Activating an installation resolves the
-- matching automatic request and supersedes any different request atomically.
create or replace function public.settle_license_installation_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.status <> 'Active' then
    return new;
  end if;

  -- Expiry is authoritative even when an abandoned EA never polled again.
  update public.license_installation_requests
  set status = 'Expired',
      match_code = null,
      resolved_at = v_now,
      resolution_reason = 'Request expired'
  where (license_id = new.license_id or installation_hash = new.installation_hash)
    and status = 'Pending'
    and expires_at <= v_now;

  update public.license_installation_requests
  set status = case
        when license_id = new.license_id and installation_hash = new.installation_hash then 'Approved'
        else 'Superseded'
      end,
      match_code = null,
      resolved_at = v_now,
      resolution_reason = case
        when license_id = new.license_id and installation_hash = new.installation_hash then 'Installation activated'
        else 'Another installation was activated'
      end,
      activated_installation_id = case
        when license_id = new.license_id and installation_hash = new.installation_hash then new.id
        else null
      end
  where (license_id = new.license_id or installation_hash = new.installation_hash)
    and status = 'Pending'
    and expires_at > v_now;
  return new;
end;
$$;

drop trigger if exists settle_license_installation_requests on public.license_installations;
create trigger settle_license_installation_requests
after insert or update of status, installation_hash, license_id
on public.license_installations
for each row execute function public.settle_license_installation_requests();

-- A no-op administrator reset does not change binding_version in the original
-- RPC, so its audit row must still cancel a live request. This trigger also
-- records the client actor for successful manual recovery after the active-seat
-- trigger has resolved the matching request.
create or replace function public.settle_license_installation_change_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.change_kind = 'Reset' then
    update public.license_installation_requests
    set status = 'Expired',
        match_code = null,
        resolved_at = v_now,
        resolution_reason = 'Request expired'
    where license_id = new.license_id
      and status = 'Pending'
      and expires_at <= v_now;

    update public.license_installation_requests
    set status = 'Superseded',
        match_code = null,
        resolved_at = v_now,
        resolved_by_auth_user_id = new.actor_auth_user_id,
        resolution_reason = 'Administrator reset installation access'
    where license_id = new.license_id
      and status = 'Pending'
      and expires_at > v_now;
  elsif new.changed_by = 'Client' and new.new_installation_id is not null then
    update public.license_installation_requests
    set resolved_by_auth_user_id = new.actor_auth_user_id
    where license_id = new.license_id
      and activated_installation_id = new.new_installation_id
      and status = 'Approved'
      and resolved_by_auth_user_id is null
      and resolved_at >= new.created_at - interval '5 seconds';
  end if;
  return new;
end;
$$;

drop trigger if exists settle_license_installation_change_requests on public.license_installation_changes;
create trigger settle_license_installation_change_requests
after insert on public.license_installation_changes
for each row execute function public.settle_license_installation_change_requests();

-- Any account, reset, owner, platform, or other binding-version change makes
-- an older pending request stale. Activation settles its matching request
-- before the binding version increments, so approved requests are preserved.
create or replace function public.supersede_stale_license_installation_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.license_installation_requests
  set status = 'Superseded',
      match_code = null,
      resolved_at = clock_timestamp(),
      resolution_reason = 'License binding changed'
  where license_id = new.id
    and status = 'Pending'
    and (
      binding_version_at_request <> new.binding_version
      or new.status <> 'Active'
      or new.revoked_at is not null
      or new.client_id is distinct from old.client_id
      or new.platform is distinct from old.platform
    );
  return new;
end;
$$;

drop trigger if exists supersede_stale_license_installation_requests on public.licenses;
create trigger supersede_stale_license_installation_requests
after update of binding_version, status, revoked_at, client_id, platform
on public.licenses
for each row execute function public.supersede_stale_license_installation_requests();

create or replace function public.enforce_license_runtime_binding_reset()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.client_id is not distinct from old.client_id
    and new.platform is not distinct from old.platform then
    return new;
  end if;

  if exists (select 1 from public.license_demo_accounts where license_id = old.id)
    or exists (select 1 from public.license_demo_account_changes where license_id = old.id)
    or exists (select 1 from public.license_installations where license_id = old.id)
    or exists (select 1 from public.license_installation_changes where license_id = old.id)
    or exists (select 1 from public.license_installation_requests where license_id = old.id) then
    raise exception using
      errcode = 'P0001',
      message = 'LICENSE_RUNTIME_BINDING_RESET_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.consume_license_installation_request_limit(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_license_installation_approval_state() from public, anon, authenticated;
revoke all on function public.request_license_installation_approval(text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.poll_license_installation_approval(uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_license_installation_approval_client(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.settle_license_installation_requests() from public, anon, authenticated;
revoke all on function public.settle_license_installation_change_requests() from public, anon, authenticated;
revoke all on function public.supersede_stale_license_installation_requests() from public, anon, authenticated;
revoke all on function public.enforce_license_runtime_binding_reset() from public, anon, authenticated;

grant execute on function public.request_license_installation_approval(text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.poll_license_installation_approval(uuid, text) to service_role;
grant execute on function public.resolve_license_installation_approval_client(uuid, uuid, text) to service_role;
grant execute on function public.cleanup_license_installation_approval_state() to service_role;
