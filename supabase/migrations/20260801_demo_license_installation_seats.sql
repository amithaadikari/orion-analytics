-- Orion V5.3 per-license Demo bindings and one transferable installation seat.
--
-- The existing registered Real-account workflow remains authoritative and is
-- intentionally not modified here. Runtime validation requires the existing
-- license key plus one active installation identifier. Demo identities are
-- exact, per-license bindings. Only hashes of installation identifiers are
-- persisted.

create extension if not exists pgcrypto;

-- Composite ownership keys let the new tables prove that a binding belongs to
-- the same license owner and platform. They also prevent a generic license
-- update from silently moving a live or historical pairing to another client.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.licenses'::regclass
      and conname = 'licenses_id_client_platform_unique'
  ) then
    alter table public.licenses
      add constraint licenses_id_client_platform_unique
      unique (id, client_id, platform);
  end if;
end;
$$;

create table if not exists public.license_demo_accounts (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null,
  client_id uuid not null,
  account_number text not null,
  broker_server text not null,
  platform text not null,
  status text not null default 'Active',
  registered_at timestamptz not null default now(),
  deactivated_at timestamptz,
  change_source text not null default 'Client',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint license_demo_accounts_client_fk
    foreign key (client_id)
    references public.clients(id)
    on delete cascade,
  constraint license_demo_accounts_license_owner_fk
    foreign key (license_id, client_id, platform)
    references public.licenses(id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_demo_accounts_account_number_check
    check (account_number = btrim(account_number) and account_number ~ '^[0-9]{4,24}$'),
  constraint license_demo_accounts_broker_server_check
    check (broker_server = btrim(broker_server) and char_length(broker_server) between 2 and 160),
  constraint license_demo_accounts_platform_check
    check (platform in ('MT4', 'MT5')),
  constraint license_demo_accounts_status_check
    check (status in ('Active', 'Archived')),
  constraint license_demo_accounts_source_check
    check (change_source in ('Client', 'Admin', 'Migration')),
  constraint license_demo_accounts_id_owner_unique
    unique (id, license_id, client_id, platform)
);

create unique index if not exists license_demo_accounts_active_license_idx
  on public.license_demo_accounts(license_id)
  where status = 'Active';

-- Active identity lookup supports the cross-client ownership check in the
-- atomic RPC. Multiple licenses owned by the same client may intentionally use
-- the same Demo login; another client may not claim it while it is active.
create index if not exists license_demo_accounts_active_identity_idx
  on public.license_demo_accounts(account_number, lower(btrim(broker_server)), platform)
  where status = 'Active';

create index if not exists license_demo_accounts_client_idx
  on public.license_demo_accounts(client_id, registered_at desc);

create table if not exists public.license_demo_account_changes (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null,
  client_id uuid not null,
  platform text not null,
  previous_demo_account_id uuid,
  new_demo_account_id uuid not null,
  membership_tier text not null,
  changed_by text not null,
  actor_auth_user_id uuid not null,
  actor_label text not null,
  override_reason text,
  request_id uuid not null,
  change_kind text not null,
  cooldown_overridden boolean not null default false,
  next_client_change_at timestamptz,
  created_at timestamptz not null default now(),
  constraint license_demo_changes_client_fk
    foreign key (client_id)
    references public.clients(id)
    on delete cascade,
  constraint license_demo_changes_license_owner_fk
    foreign key (license_id, client_id, platform)
    references public.licenses(id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_demo_changes_previous_owner_fk
    foreign key (previous_demo_account_id, license_id, client_id, platform)
    references public.license_demo_accounts(id, license_id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_demo_changes_new_owner_fk
    foreign key (new_demo_account_id, license_id, client_id, platform)
    references public.license_demo_accounts(id, license_id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_demo_changes_membership_check
    check (membership_tier in ('Standard', 'Pro')),
  constraint license_demo_changes_actor_check
    check (changed_by in ('Client', 'Admin')),
  constraint license_demo_changes_kind_check
    check (change_kind in ('Registration', 'Replacement', 'Reactivation')),
  constraint license_demo_changes_override_check
    check (
      (changed_by = 'Client' and cooldown_overridden = false and override_reason is null)
      or (
        changed_by = 'Admin'
        and cooldown_overridden = true
        and override_reason is not null
        and char_length(btrim(override_reason)) >= 10
      )
    ),
  constraint license_demo_changes_request_unique unique (request_id)
);

create index if not exists license_demo_changes_license_idx
  on public.license_demo_account_changes(license_id, created_at desc);
create index if not exists license_demo_changes_client_idx
  on public.license_demo_account_changes(client_id, created_at desc);

create table if not exists public.license_installations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null,
  client_id uuid not null,
  platform text not null,
  installation_hash text not null,
  installation_hint text not null,
  device_label text not null,
  status text not null default 'Active',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  deactivated_at timestamptz,
  change_source text not null default 'Client',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint license_installations_client_fk
    foreign key (client_id)
    references public.clients(id)
    on delete cascade,
  constraint license_installations_license_owner_fk
    foreign key (license_id, client_id, platform)
    references public.licenses(id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_installations_hash_check
    check (installation_hash ~ '^[0-9a-f]{64}$'),
  constraint license_installations_hint_check
    check (installation_hint = btrim(installation_hint) and char_length(installation_hint) between 4 and 32),
  constraint license_installations_label_check
    check (device_label = btrim(device_label) and char_length(device_label) between 2 and 60),
  constraint license_installations_platform_check
    check (platform in ('MT4', 'MT5')),
  constraint license_installations_status_check
    check (status in ('Active', 'Archived', 'Revoked')),
  constraint license_installations_source_check
    check (change_source in ('Client', 'Admin', 'Migration')),
  constraint license_installations_hash_unique unique (installation_hash),
  constraint license_installations_id_owner_unique
    unique (id, license_id, client_id, platform)
);

create unique index if not exists license_installations_active_license_idx
  on public.license_installations(license_id)
  where status = 'Active';
create index if not exists license_installations_client_idx
  on public.license_installations(client_id, activated_at desc);

create table if not exists public.license_installation_changes (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null,
  client_id uuid not null,
  platform text not null,
  previous_installation_id uuid,
  new_installation_id uuid,
  membership_tier text not null,
  changed_by text not null,
  actor_auth_user_id uuid not null,
  actor_label text not null,
  override_reason text,
  request_id uuid not null,
  change_kind text not null,
  changed boolean not null default true,
  cooldown_overridden boolean not null default false,
  next_client_change_at timestamptz,
  target_installation_hash text,
  target_installation_hint text,
  target_device_label text,
  created_at timestamptz not null default now(),
  constraint license_installation_changes_client_fk
    foreign key (client_id)
    references public.clients(id)
    on delete cascade,
  constraint license_installation_changes_license_owner_fk
    foreign key (license_id, client_id, platform)
    references public.licenses(id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_installation_changes_previous_owner_fk
    foreign key (previous_installation_id, license_id, client_id, platform)
    references public.license_installations(id, license_id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_installation_changes_new_owner_fk
    foreign key (new_installation_id, license_id, client_id, platform)
    references public.license_installations(id, license_id, client_id, platform)
    on update no action
    on delete no action
    deferrable initially deferred,
  constraint license_installation_changes_membership_check
    check (membership_tier in ('Standard', 'Pro')),
  constraint license_installation_changes_actor_check
    check (changed_by in ('Client', 'Admin')),
  constraint license_installation_changes_kind_check
    check (change_kind in ('Registration', 'Replacement', 'Reactivation', 'Reset')),
  constraint license_installation_changes_target_check
    check (
      (
        change_kind in ('Registration', 'Replacement', 'Reactivation')
        and new_installation_id is not null
        and target_installation_hash ~ '^[0-9a-f]{64}$'
        and target_installation_hint is not null
        and target_device_label is not null
      )
      or (
        change_kind = 'Reset'
        and new_installation_id is null
        and target_installation_hash is null
        and target_installation_hint is null
        and target_device_label is null
      )
    ),
  constraint license_installation_changes_override_check
    check (
      (changed_by = 'Client' and cooldown_overridden = false and override_reason is null and change_kind <> 'Reset')
      or (
        changed_by = 'Admin'
        and cooldown_overridden = true
        and change_kind = 'Reset'
        and override_reason is not null
        and char_length(btrim(override_reason)) >= 10
      )
    ),
  constraint license_installation_changes_request_unique unique (request_id)
);

create index if not exists license_installation_changes_license_idx
  on public.license_installation_changes(license_id, created_at desc);
create index if not exists license_installation_changes_client_idx
  on public.license_installation_changes(client_id, created_at desc);

drop trigger if exists license_demo_accounts_updated_at on public.license_demo_accounts;
create trigger license_demo_accounts_updated_at
before update on public.license_demo_accounts
for each row execute function public.set_updated_at();

drop trigger if exists license_installations_updated_at on public.license_installations;
create trigger license_installations_updated_at
before update on public.license_installations
for each row execute function public.set_updated_at();

alter table public.license_demo_accounts enable row level security;
alter table public.license_demo_account_changes enable row level security;
alter table public.license_installations enable row level security;
alter table public.license_installation_changes enable row level security;

-- Runtime and portal reads are deliberately shaped by MFA-aware server routes.
-- No installation hash is directly readable by browser roles.
revoke all on table public.license_demo_accounts from public, anon, authenticated;
revoke all on table public.license_demo_account_changes from public, anon, authenticated;
revoke all on table public.license_installations from public, anon, authenticated;
revoke all on table public.license_installation_changes from public, anon, authenticated;

-- The service role may shape read models, but all writes must pass through the
-- audited security-definer functions below.
revoke insert, update, delete, truncate, references, trigger
  on table public.license_demo_accounts from service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.license_demo_account_changes from service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.license_installations from service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.license_installation_changes from service_role;

grant select on table public.license_demo_accounts to service_role;
grant select on table public.license_demo_account_changes to service_role;
grant select on table public.license_installations to service_role;
grant select on table public.license_installation_changes to service_role;

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
    or exists (select 1 from public.license_installation_changes where license_id = old.id) then
    raise exception using
      errcode = 'P0001',
      message = 'LICENSE_RUNTIME_BINDING_RESET_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_license_runtime_binding_reset on public.licenses;
create trigger enforce_license_runtime_binding_reset
before update of client_id, platform on public.licenses
for each row execute function public.enforce_license_runtime_binding_reset();

create or replace function public.set_license_demo_account_client(
  p_auth_user_id uuid,
  p_request_id uuid,
  p_license_id uuid,
  p_account_number text,
  p_broker_server text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
  target_license public.licenses%rowtype;
  current_account public.license_demo_accounts%rowtype;
  reserved_account public.license_demo_accounts%rowtype;
  next_account public.license_demo_accounts%rowtype;
  identity_conflict public.license_demo_accounts%rowtype;
  existing_change public.license_demo_account_changes%rowtype;
  v_account_number text := btrim(coalesce(p_account_number, ''));
  v_broker_server text := btrim(coalesce(p_broker_server, ''));
  v_effective_tier text;
  v_change_kind text;
  v_last_change timestamptz;
  v_window_reset timestamptz;
  v_recent_change_count integer := 0;
  v_next_change_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_is_replacement boolean := false;
  v_actor_label text;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ID_REQUIRED';
  end if;
  if p_license_id is null then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_FOUND';
  end if;
  if v_account_number !~ '^[0-9]{4,24}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCOUNT_NUMBER';
  end if;
  if char_length(v_broker_server) not between 2 and 160 then
    raise exception using errcode = 'P0001', message = 'INVALID_BROKER_SERVER';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('demo-request:' || p_request_id::text, 0));

  select * into target_client
  from public.clients
  where auth_user_id = p_auth_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;

  select * into target_license
  from public.licenses
  where id = p_license_id
    and client_id = target_client.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_FOUND';
  end if;

  v_actor_label := coalesce(target_client.email, 'client:' || target_client.id::text);
  v_now := clock_timestamp();

  -- A successful request id is reusable only for the exact same client and
  -- target identity. Membership and cooldown are not re-evaluated on retries.
  select * into existing_change
  from public.license_demo_account_changes
  where request_id = p_request_id;
  if found then
    select * into next_account
    from public.license_demo_accounts
    where id = existing_change.new_demo_account_id;
    if not found
      or existing_change.client_id <> target_client.id
      or existing_change.license_id <> p_license_id
      or existing_change.changed_by <> 'Client'
      or existing_change.actor_auth_user_id <> p_auth_user_id
      or next_account.account_number <> v_account_number
      or lower(btrim(next_account.broker_server)) <> lower(v_broker_server)
      or next_account.platform <> target_license.platform then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'changed', false,
      'idempotent', true,
      'changeKind', existing_change.change_kind,
      'membershipTier', existing_change.membership_tier,
      'nextChangeAt', existing_change.next_client_change_at,
      'bindingVersion', target_license.binding_version,
      'demoAccount', jsonb_build_object(
        'id', next_account.id,
        'accountNumber', next_account.account_number,
        'brokerServer', next_account.broker_server,
        'platform', next_account.platform,
        'registeredAt', next_account.registered_at
      )
    );
  end if;

  if target_client.status <> 'Active' then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_ACTIVE';
  end if;
  if target_license.status <> 'Active'
    or target_license.revoked_at is not null
    or (target_license.expires_at is not null and target_license.expires_at < v_now) then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_ACTIVE';
  end if;

  v_effective_tier := case
    when target_client.membership_tier = 'Pro'
      and target_client.membership_status = 'Active'
      and (target_client.membership_started_at is null or target_client.membership_started_at <= v_now)
      and (target_client.membership_expires_at is null or target_client.membership_expires_at > v_now)
    then 'Pro'
    else 'Standard'
  end;

  select * into current_account
  from public.license_demo_accounts
  where license_id = p_license_id
    and status = 'Active'
  for update;

  if current_account.id is not null
    and current_account.account_number = v_account_number
    and lower(btrim(current_account.broker_server)) = lower(v_broker_server)
    and current_account.platform = target_license.platform then
    return jsonb_build_object(
      'changed', false,
      'idempotent', false,
      'membershipTier', v_effective_tier,
      'nextChangeAt', null,
      'bindingVersion', target_license.binding_version,
      'demoAccount', jsonb_build_object(
        'id', current_account.id,
        'accountNumber', current_account.account_number,
        'brokerServer', current_account.broker_server,
        'platform', current_account.platform,
        'registeredAt', current_account.registered_at
      )
    );
  end if;

  v_is_replacement := current_account.id is not null;

  -- First registration is free. Replacement quotas are authoritative per
  -- license and count only successful client changes, never admin activity.
  if v_is_replacement and v_effective_tier = 'Standard' then
    select max(created_at) into v_last_change
    from public.license_demo_account_changes
    where license_id = p_license_id
      and changed_by = 'Client'
      and change_kind in ('Replacement', 'Reactivation');
    if v_last_change is not null and v_last_change + interval '7 days' > v_now then
      v_next_change_at := v_last_change + interval '7 days';
      raise exception using
        errcode = 'P0001',
        message = 'DEMO_ACCOUNT_CHANGE_COOLDOWN:' || to_char(v_next_change_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end if;
  end if;

  if v_is_replacement and v_effective_tier = 'Pro' then
    select count(*), min(created_at) + interval '24 hours'
      into v_recent_change_count, v_window_reset
    from public.license_demo_account_changes
    where license_id = p_license_id
      and changed_by = 'Client'
      and change_kind in ('Replacement', 'Reactivation')
      and created_at > v_now - interval '24 hours';
    if v_recent_change_count >= 2 then
      raise exception using
        errcode = 'P0001',
        message = 'PRO_DEMO_CHANGE_RATE_LIMIT:' || to_char(v_window_reset at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end if;
  end if;

  -- Serialize the exact normalized identity across clients before consulting
  -- the active-identity index. This turns a cross-client race into a stable
  -- public ownership error while allowing same-client multi-license use.
  perform pg_advisory_xact_lock(hashtextextended(
    'demo-identity:' || v_account_number || '|' || lower(v_broker_server) || '|' || target_license.platform,
    0
  ));

  select * into identity_conflict
  from public.license_demo_accounts
  where account_number = v_account_number
    and lower(btrim(broker_server)) = lower(v_broker_server)
    and platform = target_license.platform
    and status = 'Active'
    and client_id <> target_client.id
  order by created_at, id
  limit 1;
  if identity_conflict.id is not null then
    raise exception using errcode = 'P0001', message = 'DEMO_ACCOUNT_ALREADY_REGISTERED';
  end if;

  select * into reserved_account
  from public.license_demo_accounts
  where license_id = p_license_id
    and account_number = v_account_number
    and lower(btrim(broker_server)) = lower(v_broker_server)
    and platform = target_license.platform
    and status = 'Archived'
  order by registered_at desc, id
  limit 1
  for update;

  if v_is_replacement then
    update public.license_demo_accounts
    set status = 'Archived',
        deactivated_at = v_now,
        updated_at = v_now
    where id = current_account.id;
  end if;

  if reserved_account.id is not null then
    update public.license_demo_accounts
    set status = 'Active',
        registered_at = v_now,
        deactivated_at = null,
        change_source = 'Client',
        updated_at = v_now
    where id = reserved_account.id
    returning * into next_account;
    v_change_kind := 'Reactivation';
  else
    insert into public.license_demo_accounts (
      license_id,
      client_id,
      account_number,
      broker_server,
      platform,
      status,
      registered_at,
      change_source
    ) values (
      p_license_id,
      target_client.id,
      v_account_number,
      v_broker_server,
      target_license.platform,
      'Active',
      v_now,
      'Client'
    ) returning * into next_account;
    v_change_kind := case when v_is_replacement then 'Replacement' else 'Registration' end;
  end if;

  update public.licenses
  set binding_version = binding_version + 1
  where id = p_license_id
    and client_id = target_client.id
  returning * into target_license;

  if v_is_replacement and v_effective_tier = 'Standard' then
    v_next_change_at := v_now + interval '7 days';
  elsif v_is_replacement and v_effective_tier = 'Pro' and v_recent_change_count = 1 then
    v_next_change_at := v_window_reset;
  else
    v_next_change_at := null;
  end if;

  insert into public.license_demo_account_changes (
    license_id,
    client_id,
    platform,
    previous_demo_account_id,
    new_demo_account_id,
    membership_tier,
    changed_by,
    actor_auth_user_id,
    actor_label,
    request_id,
    change_kind,
    cooldown_overridden,
    next_client_change_at,
    created_at
  ) values (
    p_license_id,
    target_client.id,
    target_license.platform,
    current_account.id,
    next_account.id,
    v_effective_tier,
    'Client',
    p_auth_user_id,
    v_actor_label,
    p_request_id,
    v_change_kind,
    false,
    v_next_change_at,
    v_now
  );

  insert into public.client_activity (client_id, action, details, actor_email)
  values (
    target_client.id,
    case when v_change_kind = 'Registration' then 'Demo account registered' else 'Demo account changed' end,
    target_license.platform || ' · account ending ' || right(v_account_number, 4) || ' · license ' || right(target_license.license_key, 4),
    v_actor_label
  );

  insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
  values (
    target_client.id,
    'License',
    case when v_change_kind = 'Registration' then 'Demo account registered' else 'Demo account changed' end,
    'Your ' || target_license.platform || ' license is now bound to the Demo account ending ' || right(v_account_number, 4) || '.',
    '/portal#license-pairing',
    'license-demo:' || p_request_id::text
  ) on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'changed', true,
    'idempotent', false,
    'changeKind', v_change_kind,
    'membershipTier', v_effective_tier,
    'nextChangeAt', v_next_change_at,
    'bindingVersion', target_license.binding_version,
    'demoAccount', jsonb_build_object(
      'id', next_account.id,
      'accountNumber', next_account.account_number,
      'brokerServer', next_account.broker_server,
      'platform', next_account.platform,
      'registeredAt', next_account.registered_at
    )
  );
end;
$$;

create or replace function public.reset_license_installation_admin(
  p_admin_user_id uuid,
  p_client_id uuid,
  p_request_id uuid,
  p_license_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  administrator public.admins%rowtype;
  target_client public.clients%rowtype;
  target_license public.licenses%rowtype;
  current_installation public.license_installations%rowtype;
  existing_change public.license_installation_changes%rowtype;
  v_effective_tier text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := clock_timestamp();
  v_changed boolean := false;
  v_actor_label text;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ID_REQUIRED';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception using errcode = 'P0001', message = 'ADMIN_OVERRIDE_REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('installation-request:' || p_request_id::text, 0));

  select * into administrator
  from public.admins
  where user_id = p_admin_user_id
    and role = 'admin';
  if not found then
    raise exception using errcode = 'P0001', message = 'ADMIN_ACCESS_REQUIRED';
  end if;
  v_actor_label := coalesce(administrator.email, 'admin:' || administrator.id::text);

  select * into target_client
  from public.clients
  where id = p_client_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;

  select * into target_license
  from public.licenses
  where id = p_license_id
    and client_id = p_client_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_FOUND';
  end if;
  v_now := clock_timestamp();

  select * into existing_change
  from public.license_installation_changes
  where request_id = p_request_id;
  if found then
    if existing_change.client_id <> p_client_id
      or existing_change.license_id <> p_license_id
      or existing_change.changed_by <> 'Admin'
      or existing_change.actor_auth_user_id <> p_admin_user_id
      or existing_change.change_kind <> 'Reset'
      or btrim(coalesce(existing_change.override_reason, '')) <> v_reason then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'changed', false,
      'idempotent', true,
      'resetHadActiveSeat', existing_change.changed,
      'bindingVersion', target_license.binding_version
    );
  end if;

  v_effective_tier := case
    when target_client.membership_tier = 'Pro'
      and target_client.membership_status = 'Active'
      and (target_client.membership_started_at is null or target_client.membership_started_at <= v_now)
      and (target_client.membership_expires_at is null or target_client.membership_expires_at > v_now)
    then 'Pro'
    else 'Standard'
  end;

  select * into current_installation
  from public.license_installations
  where license_id = p_license_id
    and status = 'Active'
  for update;

  if current_installation.id is not null then
    update public.license_installations
    set status = 'Revoked',
        deactivated_at = v_now,
        change_source = 'Admin',
        updated_at = v_now
    where id = current_installation.id;

    update public.licenses
    set binding_version = binding_version + 1
    where id = p_license_id
      and client_id = p_client_id
    returning * into target_license;
    v_changed := true;
  end if;

  -- Record even a no-op reset so its request id cannot later be replayed
  -- against a newly paired installation.
  insert into public.license_installation_changes (
    license_id,
    client_id,
    platform,
    previous_installation_id,
    new_installation_id,
    membership_tier,
    changed_by,
    actor_auth_user_id,
    actor_label,
    override_reason,
    request_id,
    change_kind,
    changed,
    cooldown_overridden,
    next_client_change_at,
    target_installation_hash,
    target_installation_hint,
    target_device_label,
    created_at
  ) values (
    p_license_id,
    p_client_id,
    target_license.platform,
    current_installation.id,
    null,
    v_effective_tier,
    'Admin',
    p_admin_user_id,
    v_actor_label,
    v_reason,
    p_request_id,
    'Reset',
    v_changed,
    true,
    null,
    null,
    null,
    null,
    v_now
  );

  insert into public.client_activity (client_id, action, details, actor_email)
  values (
    p_client_id,
    'License installation reset',
    case
      when v_changed then target_license.platform || ' · active seat revoked · license ' || right(target_license.license_key, 4) || ' · ' || v_reason
      else target_license.platform || ' · no active seat · license ' || right(target_license.license_key, 4) || ' · ' || v_reason
    end,
    v_actor_label
  );

  if v_changed then
    insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
    values (
      p_client_id,
      'Security',
      'License installation reset',
      'An Orion administrator revoked the active installation for your ' || target_license.platform || ' license. Pair a new Installation ID before using the EA.',
      '/portal#license-pairing',
      'license-installation-reset:' || p_request_id::text
    ) on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'changed', v_changed,
    'idempotent', false,
    'bindingVersion', target_license.binding_version
  );
end;
$$;

create or replace function public.activate_license_installation_client(
  p_auth_user_id uuid,
  p_request_id uuid,
  p_license_id uuid,
  p_installation_hash text,
  p_installation_hint text,
  p_device_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
  target_license public.licenses%rowtype;
  current_installation public.license_installations%rowtype;
  reserved_installation public.license_installations%rowtype;
  next_installation public.license_installations%rowtype;
  existing_change public.license_installation_changes%rowtype;
  v_installation_hash text := lower(btrim(coalesce(p_installation_hash, '')));
  v_installation_hint text := btrim(coalesce(p_installation_hint, ''));
  v_device_label text := btrim(coalesce(p_device_label, ''));
  v_effective_tier text;
  v_change_kind text;
  v_window_reset timestamptz;
  v_recent_change_count integer := 0;
  v_next_change_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_is_replacement boolean := false;
  v_actor_label text;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ID_REQUIRED';
  end if;
  if p_license_id is null then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_FOUND';
  end if;
  if v_installation_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INSTALLATION_HASH';
  end if;
  if char_length(v_installation_hint) not between 4 and 32 then
    raise exception using errcode = 'P0001', message = 'INVALID_INSTALLATION_HINT';
  end if;
  if char_length(v_device_label) not between 2 and 60 then
    raise exception using errcode = 'P0001', message = 'INVALID_DEVICE_LABEL';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('installation-request:' || p_request_id::text, 0));

  select * into target_client
  from public.clients
  where auth_user_id = p_auth_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;

  select * into target_license
  from public.licenses
  where id = p_license_id
    and client_id = target_client.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_FOUND';
  end if;

  v_actor_label := coalesce(target_client.email, 'client:' || target_client.id::text);
  v_now := clock_timestamp();

  select * into existing_change
  from public.license_installation_changes
  where request_id = p_request_id;
  if found then
    if existing_change.client_id <> target_client.id
      or existing_change.license_id <> p_license_id
      or existing_change.changed_by <> 'Client'
      or existing_change.actor_auth_user_id <> p_auth_user_id
      or existing_change.change_kind = 'Reset'
      or existing_change.target_installation_hash <> v_installation_hash
      or existing_change.target_installation_hint <> v_installation_hint
      or existing_change.target_device_label <> v_device_label then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    select * into next_installation
    from public.license_installations
    where id = existing_change.new_installation_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'changed', false,
      'idempotent', true,
      'changeKind', existing_change.change_kind,
      'nextChangeAt', existing_change.next_client_change_at,
      'bindingVersion', target_license.binding_version,
      'installation', jsonb_build_object(
        'id', next_installation.id,
        'hint', existing_change.target_installation_hint,
        'label', existing_change.target_device_label,
        'activatedAt', next_installation.activated_at
      )
    );
  end if;

  if target_client.status <> 'Active' then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_ACTIVE';
  end if;
  if target_license.status <> 'Active'
    or target_license.revoked_at is not null
    or (target_license.expires_at is not null and target_license.expires_at < v_now) then
    raise exception using errcode = 'P0001', message = 'LICENSE_NOT_ACTIVE';
  end if;

  v_effective_tier := case
    when target_client.membership_tier = 'Pro'
      and target_client.membership_status = 'Active'
      and (target_client.membership_started_at is null or target_client.membership_started_at <= v_now)
      and (target_client.membership_expires_at is null or target_client.membership_expires_at > v_now)
    then 'Pro'
    else 'Standard'
  end;

  select * into current_installation
  from public.license_installations
  where license_id = p_license_id
    and status = 'Active'
  for update;

  if current_installation.id is not null
    and current_installation.installation_hash = v_installation_hash then
    return jsonb_build_object(
      'changed', false,
      'idempotent', false,
      'nextChangeAt', null,
      'bindingVersion', target_license.binding_version,
      'installation', jsonb_build_object(
        'id', current_installation.id,
        'hint', current_installation.installation_hint,
        'label', current_installation.device_label,
        'activatedAt', current_installation.activated_at
      )
    );
  end if;

  v_is_replacement := current_installation.id is not null;

  -- Installation movement has a universal security limit independent of the
  -- membership tier: two successful client replacements per rolling 24 hours.
  if v_is_replacement then
    select count(*), min(created_at) + interval '24 hours'
      into v_recent_change_count, v_window_reset
    from public.license_installation_changes
    where license_id = p_license_id
      and changed_by = 'Client'
      and change_kind in ('Replacement', 'Reactivation')
      and created_at > v_now - interval '24 hours';
    if v_recent_change_count >= 2 then
      raise exception using
        errcode = 'P0001',
        message = 'INSTALLATION_CHANGE_RATE_LIMIT:' || to_char(v_window_reset at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('installation-id:' || v_installation_hash, 0));

  select * into reserved_installation
  from public.license_installations
  where installation_hash = v_installation_hash;
  if reserved_installation.id is not null
    and (
      reserved_installation.license_id <> p_license_id
      or reserved_installation.client_id <> target_client.id
      or reserved_installation.platform <> target_license.platform
      or reserved_installation.status = 'Revoked'
    ) then
    raise exception using errcode = '23505', message = 'INSTALLATION_ID_UNAVAILABLE';
  end if;

  if v_is_replacement then
    update public.license_installations
    set status = 'Archived',
        deactivated_at = v_now,
        updated_at = v_now
    where id = current_installation.id;
  end if;

  if reserved_installation.id is not null then
    update public.license_installations
    set installation_hint = v_installation_hint,
        device_label = v_device_label,
        status = 'Active',
        activated_at = v_now,
        last_seen_at = null,
        deactivated_at = null,
        change_source = 'Client',
        updated_at = v_now
    where id = reserved_installation.id
    returning * into next_installation;
    v_change_kind := 'Reactivation';
  else
    insert into public.license_installations (
      license_id,
      client_id,
      platform,
      installation_hash,
      installation_hint,
      device_label,
      status,
      activated_at,
      change_source
    ) values (
      p_license_id,
      target_client.id,
      target_license.platform,
      v_installation_hash,
      v_installation_hint,
      v_device_label,
      'Active',
      v_now,
      'Client'
    ) returning * into next_installation;
    v_change_kind := case when v_is_replacement then 'Replacement' else 'Registration' end;
  end if;

  update public.licenses
  set binding_version = binding_version + 1
  where id = p_license_id
    and client_id = target_client.id
  returning * into target_license;

  if v_is_replacement and v_recent_change_count = 1 then
    v_next_change_at := v_window_reset;
  else
    v_next_change_at := null;
  end if;

  insert into public.license_installation_changes (
    license_id,
    client_id,
    platform,
    previous_installation_id,
    new_installation_id,
    membership_tier,
    changed_by,
    actor_auth_user_id,
    actor_label,
    request_id,
    change_kind,
    changed,
    cooldown_overridden,
    next_client_change_at,
    target_installation_hash,
    target_installation_hint,
    target_device_label,
    created_at
  ) values (
    p_license_id,
    target_client.id,
    target_license.platform,
    current_installation.id,
    next_installation.id,
    v_effective_tier,
    'Client',
    p_auth_user_id,
    v_actor_label,
    p_request_id,
    v_change_kind,
    true,
    false,
    v_next_change_at,
    v_installation_hash,
    v_installation_hint,
    v_device_label,
    v_now
  );

  insert into public.client_activity (client_id, action, details, actor_email)
  values (
    target_client.id,
    case when v_change_kind = 'Registration' then 'License installation paired' else 'License installation changed' end,
    target_license.platform || ' · ' || v_installation_hint || ' · ' || v_device_label || ' · license ' || right(target_license.license_key, 4),
    v_actor_label
  );

  insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
  values (
    target_client.id,
    'Security',
    case when v_change_kind = 'Registration' then 'License installation paired' else 'License installation changed' end,
    case
      when v_change_kind = 'Registration' then 'The installation ' || v_installation_hint || ' is now paired to your ' || target_license.platform || ' license.'
      else 'The active installation for your ' || target_license.platform || ' license is now ' || v_installation_hint || '. The previous installation no longer validates.'
    end,
    '/portal#license-pairing',
    'license-installation:' || p_request_id::text
  ) on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'changed', true,
    'idempotent', false,
    'changeKind', v_change_kind,
    'nextChangeAt', v_next_change_at,
    'bindingVersion', target_license.binding_version,
    'installation', jsonb_build_object(
      'id', next_installation.id,
      'hint', next_installation.installation_hint,
      'label', next_installation.device_label,
      'activatedAt', next_installation.activated_at
    )
  );
end;
$$;

create or replace function public.validate_orion_license_runtime(
  p_key_hash text,
  p_account_number text,
  p_broker_server text,
  p_platform text,
  p_account_type text,
  p_installation_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  license_record record;
  installation_record public.license_installations%rowtype;
  demo_record public.license_demo_accounts%rowtype;
  v_key_hash text := lower(btrim(coalesce(p_key_hash, '')));
  v_account_number text := btrim(coalesce(p_account_number, ''));
  v_broker_server text := btrim(coalesce(p_broker_server, ''));
  v_platform text := upper(btrim(coalesce(p_platform, '')));
  v_account_type text := case upper(btrim(coalesce(p_account_type, '')))
    when 'DEMO' then 'Demo'
    when 'REAL' then 'Real'
    else ''
  end;
  v_installation_hash text := lower(btrim(coalesce(p_installation_hash, '')));
  checked_at timestamptz := clock_timestamp();
begin
  if v_key_hash !~ '^[0-9a-f]{64}$'
    or v_account_number !~ '^[0-9]{4,24}$'
    or char_length(v_broker_server) not between 2 and 160
    or v_platform not in ('MT4', 'MT5')
    or v_account_type not in ('Demo', 'Real')
    or v_installation_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('valid', false, 'code', 'INVALID_REQUEST');
  end if;

  -- Lock exactly the license row. Runtime mutations also lock this row before
  -- changing a Demo binding or installation, making validation linearizable
  -- with transfers and emergency resets without touching the Real workflow.
  select
    licensed.id,
    licensed.plan,
    licensed.platform,
    licensed.status,
    licensed.expires_at,
    licensed.revoked_at,
    licensed.binding_version,
    owner_client.status as client_status,
    real_account.id as real_account_id,
    real_account.account_number as real_account_number,
    real_account.broker_server as real_broker_server,
    real_account.platform as real_platform,
    real_account.status as real_status,
    real_account.account_type as real_account_type,
    real_account.verified_at as real_verified_at
  into license_record
  from public.licenses as licensed
  join public.clients as owner_client on owner_client.id = licensed.client_id
  left join public.client_trading_accounts as real_account on real_account.id = licensed.trading_account_id
  where licensed.key_hash = v_key_hash
  limit 1
  for update of licensed;

  if not found then
    return jsonb_build_object('valid', false, 'code', 'INVALID_LICENSE');
  end if;
  if license_record.status <> 'Active'
    or license_record.revoked_at is not null
    or (license_record.expires_at is not null and license_record.expires_at < checked_at)
    or license_record.client_status <> 'Active' then
    return jsonb_build_object('valid', false, 'code', 'LICENSE_INACTIVE');
  end if;

  select * into installation_record
  from public.license_installations
  where license_id = license_record.id
    and status = 'Active';
  if not found then
    return jsonb_build_object('valid', false, 'code', 'INSTALLATION_NOT_REGISTERED');
  end if;
  if installation_record.installation_hash <> v_installation_hash then
    return jsonb_build_object('valid', false, 'code', 'INSTALLATION_MISMATCH');
  end if;

  if v_account_type = 'Real' then
    if license_record.real_account_id is null
      or license_record.real_status <> 'Active'
      or license_record.real_account_type <> 'Real'
      or license_record.real_verified_at is null then
      return jsonb_build_object('valid', false, 'code', 'ACCOUNT_NOT_REGISTERED');
    end if;
    if license_record.real_account_number <> v_account_number
      or lower(btrim(license_record.real_broker_server)) <> lower(v_broker_server)
      or license_record.real_platform <> v_platform
      or license_record.platform <> v_platform then
      return jsonb_build_object('valid', false, 'code', 'ACCOUNT_MISMATCH');
    end if;
  else
    select * into demo_record
    from public.license_demo_accounts
    where license_id = license_record.id
      and status = 'Active';
    if not found then
      return jsonb_build_object('valid', false, 'code', 'DEMO_ACCOUNT_NOT_REGISTERED');
    end if;
    if demo_record.account_number <> v_account_number
      or lower(btrim(demo_record.broker_server)) <> lower(v_broker_server)
      or demo_record.platform <> v_platform
      or license_record.platform <> v_platform then
      return jsonb_build_object('valid', false, 'code', 'DEMO_ACCOUNT_MISMATCH');
    end if;
  end if;

  update public.license_installations
  set last_seen_at = checked_at,
      updated_at = checked_at
  where id = installation_record.id
    and status = 'Active';

  update public.licenses
  set last_validation_at = checked_at,
      last_activated_at = checked_at
  where id = license_record.id;

  return jsonb_build_object(
    'valid', true,
    'code', 'VALID',
    'plan', license_record.plan,
    'platform', license_record.platform,
    'accountType', v_account_type,
    'bindingVersion', license_record.binding_version,
    'expiresAt', license_record.expires_at,
    'validatedAt', checked_at
  );
end;
$$;

revoke all on function public.enforce_license_runtime_binding_reset() from public, anon, authenticated;
revoke all on function public.set_license_demo_account_client(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.activate_license_installation_client(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.reset_license_installation_admin(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.validate_orion_license_runtime(text, text, text, text, text, text) from public, anon, authenticated;

-- The legacy validator does not know about installation seats. Removing its
-- service-role grant closes that bypass while preserving the Real binding data
-- and account-management RPCs themselves.
revoke execute on function public.validate_orion_license_binding(text, text, text, text) from service_role;

grant execute on function public.set_license_demo_account_client(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.activate_license_installation_client(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.reset_license_installation_admin(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.validate_orion_license_runtime(text, text, text, text, text, text) to service_role;
