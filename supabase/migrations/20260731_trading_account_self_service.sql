-- Orion registered real-account workflow.
-- Legacy account numbers are queued for verification; they are never activated
-- without a confirmed broker server. All account replacements are atomic.

create extension if not exists pgcrypto;

-- Phase 30 did not expose an account-write workflow, but stop with an explicit
-- audit message if records were inserted manually in a shape this workflow
-- cannot normalize safely.
do $$
begin
  if exists (
    select 1 from public.client_trading_accounts
    where account_number is distinct from btrim(account_number)
      or account_number !~ '^[0-9]{4,24}$'
      or broker is distinct from btrim(broker)
      or char_length(btrim(broker)) not between 2 and 120
      or broker_server is distinct from btrim(broker_server)
      or char_length(btrim(broker_server)) not between 2 and 160
      or (currency is not null and upper(btrim(currency)) !~ '^[A-Z]{3}$')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TRADING_ACCOUNT_DATA_REVIEW_REQUIRED: normalize manually inserted account fields before applying this migration';
  end if;

  if exists (
    select 1
    from public.client_trading_accounts
    where account_type = 'Real' and status = 'Active' and verified_at is not null
    group by account_number, lower(btrim(broker_server)), platform
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TRADING_ACCOUNT_IDENTITY_REVIEW_REQUIRED: duplicate active real-account identities must be resolved first';
  end if;

  if exists (
    select 1
    from public.client_trading_accounts
    where account_type = 'Real'
    group by account_number, lower(btrim(broker_server)), platform
    having count(distinct client_id) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TRADING_ACCOUNT_OWNERSHIP_REVIEW_REQUIRED: a historical real-account identity is assigned to multiple clients';
  end if;
end;
$$;

update public.client_trading_accounts
set currency = upper(btrim(currency))
where currency is not null
  and currency is distinct from upper(btrim(currency));

-- An Active Real row is not an authorization identity until Orion has verified
-- its broker server. Preserve manually inserted rows, but suspend them safely.
update public.client_trading_accounts
set status = 'Suspended',
    deactivated_at = coalesce(deactivated_at, now()),
    updated_at = now()
where account_type = 'Real'
  and status = 'Active'
  and verified_at is null;

alter table public.client_trading_accounts
  drop constraint if exists client_trading_accounts_account_number_check,
  drop constraint if exists client_trading_accounts_broker_check,
  drop constraint if exists client_trading_accounts_broker_server_check,
  drop constraint if exists client_trading_accounts_currency_check,
  drop constraint if exists client_trading_accounts_active_real_verified_check;

alter table public.client_trading_accounts
  add constraint client_trading_accounts_account_number_check
    check (account_number = btrim(account_number) and account_number ~ '^[0-9]{4,24}$'),
  add constraint client_trading_accounts_broker_check
    check (broker = btrim(broker) and char_length(broker) between 2 and 120),
  add constraint client_trading_accounts_broker_server_check
    check (broker_server = btrim(broker_server) and char_length(broker_server) between 2 and 160),
  add constraint client_trading_accounts_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  add constraint client_trading_accounts_active_real_verified_check
    check (account_type <> 'Real' or status <> 'Active' or verified_at is not null);

drop index if exists public.trading_accounts_active_real_identity_idx;
create unique index if not exists trading_accounts_active_real_identity_normalized_idx
  on public.client_trading_accounts(account_number, lower(btrim(broker_server)), platform)
  where account_type = 'Real' and status = 'Active';

create or replace function public.enforce_trading_account_identity_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_owner uuid;
begin
  if new.account_type <> 'Real' then
    return new;
  end if;
  select client_id into existing_owner
  from public.client_trading_accounts
  where account_type = 'Real'
    and id <> new.id
    and account_number = new.account_number
    and lower(btrim(broker_server)) = lower(btrim(new.broker_server))
    and platform = new.platform
  order by created_at, id
  limit 1;
  if existing_owner is not null and existing_owner <> new.client_id then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_ALREADY_REGISTERED';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_trading_account_identity_owner on public.client_trading_accounts;
create trigger enforce_trading_account_identity_owner
before insert or update of client_id, account_number, broker_server, platform, account_type
on public.client_trading_accounts
for each row execute function public.enforce_trading_account_identity_owner();

alter table public.client_trading_accounts
  drop constraint if exists trading_accounts_id_client_unique;
alter table public.client_trading_accounts
  add constraint trading_accounts_id_client_unique unique (id, client_id);

alter table public.licenses
  add column if not exists binding_version integer not null default 0;
alter table public.licenses
  drop constraint if exists licenses_binding_version_check;
alter table public.licenses
  add constraint licenses_binding_version_check check (binding_version >= 0);

-- Payment documents must keep the identity recorded at the time of purchase;
-- later account replacements must not rewrite historical invoices or receipts.
alter table public.client_payments
  add column if not exists license_key_snapshot text,
  add column if not exists license_platform_snapshot text,
  add column if not exists account_number_snapshot text,
  add column if not exists broker_server_snapshot text,
  add column if not exists account_snapshot_captured_at timestamptz;

alter table public.client_payments
  drop constraint if exists client_payments_license_platform_snapshot_check;
alter table public.client_payments
  add constraint client_payments_license_platform_snapshot_check
    check (license_platform_snapshot is null or license_platform_snapshot in ('MT4', 'MT5'));

update public.client_payments as payment
set license_key_snapshot = license.license_key,
    license_platform_snapshot = license.platform,
    account_number_snapshot = license.account_number,
    broker_server_snapshot = account.broker_server,
    account_snapshot_captured_at = coalesce(payment.created_at, now())
from public.licenses as license
left join public.client_trading_accounts as account on account.id = license.trading_account_id
where payment.license_id = license.id
  and payment.account_snapshot_captured_at is null;

create or replace function public.capture_payment_license_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  license_record record;
begin
  if tg_op = 'UPDATE'
    and new.client_id is distinct from old.client_id
    and new.license_id is null
    and old.account_snapshot_captured_at is not null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_CLIENT_MOVE_REQUIRES_REPLACEMENT_LICENSE';
  end if;
  if new.license_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.license_id is not distinct from old.license_id
    and new.client_id is not distinct from old.client_id
    and new.account_snapshot_captured_at is not null then
    return new;
  end if;

  select
    license.license_key,
    license.platform,
    license.account_number,
    account.broker_server
  into license_record
  from public.licenses as license
  left join public.client_trading_accounts as account on account.id = license.trading_account_id
  where license.id = new.license_id
    and license.client_id = new.client_id;
  if not found then
    raise exception using errcode = '23503', message = 'PAYMENT_LICENSE_OWNER_MISMATCH';
  end if;

  new.license_key_snapshot := license_record.license_key;
  new.license_platform_snapshot := license_record.platform;
  new.account_number_snapshot := license_record.account_number;
  new.broker_server_snapshot := license_record.broker_server;
  new.account_snapshot_captured_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists capture_payment_license_identity on public.client_payments;
create trigger capture_payment_license_identity
before insert or update of client_id, license_id
on public.client_payments
for each row execute function public.capture_payment_license_identity();

alter table public.licenses
  drop constraint if exists licenses_trading_account_id_fkey;
alter table public.licenses
  drop constraint if exists licenses_trading_account_owner_fk;
alter table public.licenses
  add constraint licenses_trading_account_owner_fk
    foreign key (trading_account_id, client_id)
    references public.client_trading_accounts(id, client_id)
    on delete no action
    deferrable initially deferred;

alter table public.trading_account_changes
  add column if not exists request_id uuid,
  add column if not exists change_kind text,
  add column if not exists actor_auth_user_id uuid,
  add column if not exists cooldown_overridden boolean not null default false,
  add column if not exists next_client_change_at timestamptz;

update public.trading_account_changes
set request_id = gen_random_uuid()
where request_id is null;
update public.trading_account_changes
set change_kind = case when previous_account_id is null then 'Registration' else 'Replacement' end
where change_kind is null;

alter table public.trading_account_changes
  alter column request_id set default gen_random_uuid(),
  alter column request_id set not null,
  alter column change_kind set not null;

alter table public.trading_account_changes
  drop constraint if exists trading_account_changes_change_kind_check,
  drop constraint if exists trading_account_changes_override_check,
  drop constraint if exists trading_account_changes_previous_account_id_fkey,
  drop constraint if exists trading_account_changes_new_account_id_fkey,
  drop constraint if exists trading_account_changes_previous_owner_fk,
  drop constraint if exists trading_account_changes_new_owner_fk;

alter table public.trading_account_changes
  add constraint trading_account_changes_change_kind_check
    check (change_kind in ('Registration', 'Replacement', 'Reactivation')),
  add constraint trading_account_changes_override_check
    check (
      cooldown_overridden = false
      or (
        changed_by = 'Admin'
        and override_reason is not null
        and char_length(btrim(override_reason)) >= 10
      )
    ),
  add constraint trading_account_changes_previous_owner_fk
    foreign key (previous_account_id, client_id)
    references public.client_trading_accounts(id, client_id)
    on delete no action
    deferrable initially deferred,
  add constraint trading_account_changes_new_owner_fk
    foreign key (new_account_id, client_id)
    references public.client_trading_accounts(id, client_id)
    on delete no action
    deferrable initially deferred;

create unique index if not exists trading_account_changes_request_idx
  on public.trading_account_changes(request_id);

create table if not exists public.legacy_trading_account_backfill_queue (
  license_id uuid primary key references public.licenses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  raw_account_number text not null,
  normalized_account_number text not null,
  platform text not null check (platform in ('MT4', 'MT5')),
  broker text,
  broker_server text,
  resolution_status text not null default 'Pending'
    check (resolution_status in ('Pending', 'Resolved', 'Rejected')),
  resolved_account_id uuid references public.client_trading_accounts(id) on delete no action deferrable initially deferred,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists legacy_trading_account_queue_client_idx
  on public.legacy_trading_account_backfill_queue(client_id, resolution_status, created_at desc);

alter table public.legacy_trading_account_backfill_queue enable row level security;
drop policy if exists legacy_trading_account_queue_admin_read on public.legacy_trading_account_backfill_queue;
create policy legacy_trading_account_queue_admin_read on public.legacy_trading_account_backfill_queue
for select to authenticated using (public.is_approved_admin());
drop policy if exists legacy_trading_account_queue_client_read on public.legacy_trading_account_backfill_queue;

-- Client reads are shaped through the MFA-aware server route so reviewer
-- identities and internal audit fields are never exposed directly through RLS.
drop policy if exists trading_accounts_client_read on public.client_trading_accounts;
drop policy if exists trading_account_changes_client_read on public.trading_account_changes;

insert into public.legacy_trading_account_backfill_queue (
  license_id,
  client_id,
  raw_account_number,
  normalized_account_number,
  platform
)
select
  id,
  client_id,
  account_number,
  regexp_replace(btrim(account_number), '[[:space:]]+', '', 'g'),
  platform
from public.licenses
where nullif(btrim(account_number), '') is not null
on conflict (license_id) do nothing;

-- Fill missing hashes only when the normalized key is unique. Ambiguous legacy
-- duplicates remain unhashable until an administrator resolves them.
with normalized_keys as (
  select
    id,
    key_hash,
    regexp_replace(upper(btrim(license_key)), '[[:space:]]+', '', 'g') as normalized_key
  from public.licenses
), unique_keys as (
  select normalized_key
  from normalized_keys
  group by normalized_key
  having count(*) = 1
)
update public.licenses as license
set key_hash = encode(digest(normalized.normalized_key, 'sha256'), 'hex')
from normalized_keys as normalized
join unique_keys using (normalized_key)
where license.id = normalized.id
  and license.key_hash is null;

create or replace function public.enforce_license_trading_account_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bound_account public.client_trading_accounts%rowtype;
begin
  if new.trading_account_id is null then
    if tg_op = 'UPDATE' and old.trading_account_id is not null then
      raise exception using errcode = 'P0001', message = 'LICENSE_ACCOUNT_UNBIND_REQUIRES_TRADING_ACCOUNT_WORKFLOW';
    end if;
    if (tg_op = 'INSERT' and nullif(btrim(new.account_number), '') is not null)
      or (
        tg_op = 'UPDATE'
        and nullif(btrim(new.account_number), '') is not null
        and (
          new.account_number is distinct from old.account_number
          or new.client_id is distinct from old.client_id
          or new.platform is distinct from old.platform
        )
      ) then
      raise exception using errcode = 'P0001', message = 'LICENSE_ACCOUNT_MANAGED_BY_TRADING_ACCOUNTS';
    end if;
    return new;
  end if;

  select * into bound_account
  from public.client_trading_accounts
  where id = new.trading_account_id
    and client_id = new.client_id;
  if not found then
    raise exception using errcode = '23503', message = 'LICENSE_ACCOUNT_OWNER_MISMATCH';
  end if;
  if bound_account.platform <> new.platform then
    raise exception using errcode = '23514', message = 'LICENSE_ACCOUNT_PLATFORM_MISMATCH';
  end if;
  if bound_account.account_type <> 'Real'
    or bound_account.status <> 'Active'
    or bound_account.verified_at is null then
    raise exception using errcode = '23514', message = 'LICENSE_ACCOUNT_NOT_VERIFIED';
  end if;

  new.account_number := bound_account.account_number;
  return new;
end;
$$;

drop trigger if exists enforce_license_trading_account_binding on public.licenses;
create trigger enforce_license_trading_account_binding
before insert or update of client_id, platform, account_number, trading_account_id
on public.licenses
for each row execute function public.enforce_license_trading_account_binding();

create or replace function public._replace_registered_real_account(
  p_client_id uuid,
  p_request_id uuid,
  p_account_number text,
  p_broker text,
  p_broker_server text,
  p_platform text,
  p_currency text,
  p_changed_by text,
  p_actor_auth_user_id uuid,
  p_actor_label text,
  p_override_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
  current_account public.client_trading_accounts%rowtype;
  reserved_account public.client_trading_accounts%rowtype;
  next_account public.client_trading_accounts%rowtype;
  existing_change public.trading_account_changes%rowtype;
  v_account_number text := btrim(coalesce(p_account_number, ''));
  v_broker text := btrim(coalesce(p_broker, ''));
  v_broker_server text := btrim(coalesce(p_broker_server, ''));
  v_platform text := upper(btrim(coalesce(p_platform, '')));
  v_currency text := nullif(upper(btrim(coalesce(p_currency, ''))), '');
  v_effective_tier text;
  v_change_kind text;
  v_last_change timestamptz;
  v_next_change_at timestamptz;
  v_pro_window_reset timestamptz;
  v_pro_change_count integer := 0;
  v_license_count integer := 0;
  v_rebound_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_is_replacement boolean := false;
  v_is_admin boolean := p_changed_by = 'Admin';
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ID_REQUIRED';
  end if;
  if v_account_number !~ '^[0-9]{4,24}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCOUNT_NUMBER';
  end if;
  if char_length(v_broker) not between 2 and 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_BROKER';
  end if;
  if char_length(v_broker_server) not between 2 and 160 then
    raise exception using errcode = 'P0001', message = 'INVALID_BROKER_SERVER';
  end if;
  if v_platform not in ('MT4', 'MT5') then
    raise exception using errcode = 'P0001', message = 'INVALID_PLATFORM';
  end if;
  if v_currency is not null and v_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_CURRENCY';
  end if;
  if p_changed_by not in ('Client', 'Admin') then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCOUNT_ACTOR';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select * into target_client
  from public.clients
  where id = p_client_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;
  v_now := clock_timestamp();

  -- The client lock serializes both ordinary replacements and retries. A
  -- request id is reusable only for the exact same actor and target identity.
  select * into existing_change
  from public.trading_account_changes
  where request_id = p_request_id;
  if found then
    select * into next_account
    from public.client_trading_accounts
    where id = existing_change.new_account_id;
    if existing_change.client_id <> p_client_id
      or existing_change.changed_by <> p_changed_by
      or existing_change.actor_auth_user_id is distinct from p_actor_auth_user_id
      or next_account.id is null
      or next_account.account_number <> v_account_number
      or lower(btrim(next_account.broker)) <> lower(v_broker)
      or lower(btrim(next_account.broker_server)) <> lower(v_broker_server)
      or next_account.platform <> v_platform
      or coalesce(next_account.currency, '') <> coalesce(v_currency, '')
      or (
        p_changed_by = 'Admin'
        and coalesce(btrim(existing_change.override_reason), '') <> coalesce(btrim(p_override_reason), '')
      ) then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'changed', false,
      'idempotent', true,
      'membershipTier', existing_change.membership_tier,
      'nextChangeAt', existing_change.next_client_change_at,
      'account', jsonb_build_object(
        'id', next_account.id,
        'accountNumber', next_account.account_number,
        'broker', next_account.broker,
        'brokerServer', next_account.broker_server,
        'platform', next_account.platform,
        'currency', next_account.currency,
        'registeredAt', next_account.registered_at
      )
    );
  end if;

  if target_client.status <> 'Active' then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_ACTIVE';
  end if;

  v_effective_tier := case
    when target_client.membership_tier = 'Pro'
      and target_client.membership_status = 'Active'
      and (target_client.membership_started_at is null or target_client.membership_started_at <= v_now)
      and (target_client.membership_expires_at is null or target_client.membership_expires_at > v_now)
    then 'Pro'
    else 'Standard'
  end;

  select count(*) into v_license_count
  from public.licenses
  where client_id = p_client_id
    and platform = v_platform
    and status = 'Active'
    and revoked_at is null
    and (expires_at is null or expires_at >= v_now);
  if v_license_count = 0 then
    raise exception using errcode = 'P0001', message = 'NO_ACTIVE_LICENSE';
  end if;

  select * into current_account
  from public.client_trading_accounts
  where client_id = p_client_id
    and account_type = 'Real'
    and status = 'Active'
  for update;

  if current_account.id is not null
    and current_account.account_number = v_account_number
    and lower(btrim(current_account.broker_server)) = lower(v_broker_server)
    and current_account.platform = v_platform then
    update public.licenses
    set trading_account_id = current_account.id,
        account_number = current_account.account_number
    where client_id = p_client_id
      and platform = v_platform
      and status = 'Active'
      and revoked_at is null
      and (expires_at is null or expires_at >= v_now);
    get diagnostics v_rebound_count = row_count;
    return jsonb_build_object(
      'changed', false,
      'idempotent', false,
      'membershipTier', v_effective_tier,
      'nextChangeAt', null,
      'reboundLicenses', v_rebound_count,
      'account', jsonb_build_object(
        'id', current_account.id,
        'accountNumber', current_account.account_number,
        'broker', current_account.broker,
        'brokerServer', current_account.broker_server,
        'platform', current_account.platform,
        'currency', current_account.currency,
        'registeredAt', current_account.registered_at
      )
    );
  end if;

  v_is_replacement := current_account.id is not null;
  if v_is_admin and v_is_replacement and char_length(btrim(coalesce(p_override_reason, ''))) < 10 then
    raise exception using errcode = 'P0001', message = 'ADMIN_OVERRIDE_REASON_REQUIRED';
  end if;

  if not v_is_admin and v_is_replacement and v_effective_tier = 'Standard' then
    select max(created_at) into v_last_change
    from public.trading_account_changes
    where client_id = p_client_id
      and changed_by = 'Client'
      and change_kind in ('Replacement', 'Reactivation');
    if v_last_change is not null and v_last_change + interval '7 days' > v_now then
      v_next_change_at := v_last_change + interval '7 days';
      raise exception using
        errcode = 'P0001',
        message = 'ACCOUNT_CHANGE_COOLDOWN:' || to_char(v_next_change_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end if;
  end if;

  if not v_is_admin and v_is_replacement and v_effective_tier = 'Pro' then
    select count(*), min(created_at) + interval '24 hours'
      into v_pro_change_count, v_pro_window_reset
    from public.trading_account_changes
    where client_id = p_client_id
      and changed_by = 'Client'
      and change_kind in ('Replacement', 'Reactivation')
      and created_at > v_now - interval '24 hours';
    if v_pro_change_count >= 2 then
      raise exception using
        errcode = 'P0001',
        message = 'PRO_CHANGE_RATE_LIMIT:' || to_char(v_pro_window_reset at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end if;
  end if;

  select * into reserved_account
  from public.client_trading_accounts
  where account_type = 'Real'
    and account_number = v_account_number
    and lower(btrim(broker_server)) = lower(v_broker_server)
    and platform = v_platform
  order by case status when 'Active' then 0 when 'Archived' then 1 else 2 end, created_at desc, id
  limit 1
  for update;
  if reserved_account.id is not null and reserved_account.client_id <> p_client_id then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_ALREADY_REGISTERED';
  end if;

  if v_is_replacement then
    update public.client_trading_accounts
    set status = 'Archived', deactivated_at = v_now, updated_at = v_now
    where id = current_account.id;
  end if;

  if reserved_account.id is not null then
    update public.client_trading_accounts
    set broker = v_broker,
        broker_server = v_broker_server,
        currency = v_currency,
        status = 'Active',
        verified_at = v_now,
        registered_at = v_now,
        deactivated_at = null,
        change_source = p_changed_by,
        updated_at = v_now
    where id = reserved_account.id
    returning * into next_account;
    v_change_kind := case when v_is_replacement then 'Reactivation' else 'Registration' end;
  else
    insert into public.client_trading_accounts (
      client_id,
      account_number,
      broker,
      broker_server,
      platform,
      account_type,
      currency,
      status,
      verified_at,
      registered_at,
      change_source
    ) values (
      p_client_id,
      v_account_number,
      v_broker,
      v_broker_server,
      v_platform,
      'Real',
      v_currency,
      'Active',
      v_now,
      v_now,
      p_changed_by
    ) returning * into next_account;
    v_change_kind := case when v_is_replacement then 'Replacement' else 'Registration' end;
  end if;

  update public.licenses
  set trading_account_id = next_account.id,
      account_number = next_account.account_number,
      binding_version = binding_version + 1
  where client_id = p_client_id
    and platform = v_platform
    and status = 'Active'
    and revoked_at is null
    and (expires_at is null or expires_at >= v_now);
  get diagnostics v_rebound_count = row_count;
  if v_rebound_count = 0 then
    raise exception using errcode = 'P0001', message = 'NO_ACTIVE_LICENSE';
  end if;

  if not v_is_admin and v_effective_tier = 'Standard' and v_is_replacement then
    v_next_change_at := v_now + interval '7 days';
  else
    v_next_change_at := null;
  end if;

  insert into public.trading_account_changes (
    client_id,
    previous_account_id,
    new_account_id,
    membership_tier,
    changed_by,
    actor_id,
    actor_auth_user_id,
    override_reason,
    request_id,
    change_kind,
    cooldown_overridden,
    next_client_change_at,
    created_at
  ) values (
    p_client_id,
    current_account.id,
    next_account.id,
    v_effective_tier,
    p_changed_by,
    p_actor_label,
    p_actor_auth_user_id,
    case when v_is_admin then nullif(btrim(p_override_reason), '') else null end,
    p_request_id,
    v_change_kind,
    v_is_admin and v_is_replacement,
    v_next_change_at,
    v_now
  );

  update public.legacy_trading_account_backfill_queue
  set broker = v_broker,
      broker_server = v_broker_server,
      resolution_status = 'Resolved',
      resolved_account_id = next_account.id,
      reviewed_by = p_actor_label,
      reviewed_at = v_now
  where client_id = p_client_id
    and normalized_account_number = v_account_number
    and platform = v_platform
    and resolution_status = 'Pending';

  update public.legacy_trading_account_backfill_queue
  set resolution_status = 'Rejected',
      reviewed_by = p_actor_label,
      reviewed_at = v_now
  where client_id = p_client_id
    and platform = v_platform
    and normalized_account_number <> v_account_number
    and resolution_status = 'Pending';

  insert into public.client_activity (client_id, action, details, actor_email)
  values (
    p_client_id,
    case when v_change_kind = 'Registration' then 'Real trading account registered' else 'Real trading account changed' end,
    v_platform || ' · ' || v_broker || ' · account ending ' || right(v_account_number, 4),
    p_actor_label
  );

  insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
  values (
    p_client_id,
    'Account',
    case when v_change_kind = 'Registration' then 'Real account registered' else 'Real account changed' end,
    'Your ' || v_platform || ' license is now bound to the real account ending ' || right(v_account_number, 4) || '.',
    '/portal#trading-accounts',
    'trading-account:' || p_request_id::text
  ) on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'changed', true,
    'idempotent', false,
    'changeKind', v_change_kind,
    'membershipTier', v_effective_tier,
    'nextChangeAt', v_next_change_at,
    'reboundLicenses', v_rebound_count,
    'bindingVersionChanged', true,
    'account', jsonb_build_object(
      'id', next_account.id,
      'accountNumber', next_account.account_number,
      'broker', next_account.broker,
      'brokerServer', next_account.broker_server,
      'platform', next_account.platform,
      'currency', next_account.currency,
      'registeredAt', next_account.registered_at
    )
  );
end;
$$;

create or replace function public.change_registered_real_account_client(
  p_auth_user_id uuid,
  p_request_id uuid,
  p_account_number text,
  p_broker text,
  p_broker_server text,
  p_platform text,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
begin
  select * into target_client
  from public.clients
  where auth_user_id = p_auth_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;

  return public._replace_registered_real_account(
    target_client.id,
    p_request_id,
    p_account_number,
    p_broker,
    p_broker_server,
    p_platform,
    p_currency,
    'Client',
    p_auth_user_id,
    coalesce(target_client.email, 'client:' || target_client.id::text),
    null
  );
end;
$$;

create or replace function public.change_registered_real_account_admin(
  p_admin_user_id uuid,
  p_client_id uuid,
  p_request_id uuid,
  p_account_number text,
  p_broker text,
  p_broker_server text,
  p_platform text,
  p_currency text,
  p_override_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  administrator public.admins%rowtype;
begin
  select * into administrator
  from public.admins
  where user_id = p_admin_user_id
    and role = 'admin';
  if not found then
    raise exception using errcode = 'P0001', message = 'ADMIN_ACCESS_REQUIRED';
  end if;

  return public._replace_registered_real_account(
    p_client_id,
    p_request_id,
    p_account_number,
    p_broker,
    p_broker_server,
    p_platform,
    p_currency,
    'Admin',
    p_admin_user_id,
    coalesce(administrator.email, 'admin:' || administrator.id::text),
    p_override_reason
  );
end;
$$;

create or replace function public.set_client_membership_admin(
  p_admin_user_id uuid,
  p_client_id uuid,
  p_tier text,
  p_status text,
  p_started_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  administrator public.admins%rowtype;
  target_client public.clients%rowtype;
  effective_tier text;
  changed_at timestamptz := clock_timestamp();
begin
  select * into administrator
  from public.admins
  where user_id = p_admin_user_id
    and role = 'admin';
  if not found then
    raise exception using errcode = 'P0001', message = 'ADMIN_ACCESS_REQUIRED';
  end if;
  if p_tier not in ('Standard', 'Pro') then
    raise exception using errcode = 'P0001', message = 'INVALID_MEMBERSHIP_TIER';
  end if;
  if p_status not in ('Active', 'Expired', 'Cancelled', 'Suspended') then
    raise exception using errcode = 'P0001', message = 'INVALID_MEMBERSHIP_STATUS';
  end if;
  if p_expires_at is not null and p_started_at is not null and p_expires_at <= p_started_at then
    raise exception using errcode = 'P0001', message = 'INVALID_MEMBERSHIP_DATES';
  end if;

  select * into target_client
  from public.clients
  where id = p_client_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;

  update public.clients
  set membership_tier = p_tier,
      membership_status = p_status,
      membership_started_at = case when p_tier = 'Pro' then coalesce(p_started_at, membership_started_at, changed_at) else null end,
      membership_expires_at = case when p_tier = 'Pro' then p_expires_at else null end
  where id = p_client_id
  returning * into target_client;

  effective_tier := case
    when target_client.membership_tier = 'Pro'
      and target_client.membership_status = 'Active'
      and (target_client.membership_started_at is null or target_client.membership_started_at <= changed_at)
      and (target_client.membership_expires_at is null or target_client.membership_expires_at > changed_at)
    then 'Pro'
    else 'Standard'
  end;

  insert into public.client_activity (client_id, action, details, actor_email)
  values (
    p_client_id,
    'Membership updated',
    p_tier || ' · ' || p_status,
    coalesce(administrator.email, 'admin:' || administrator.id::text)
  );

  insert into public.client_notifications (client_id, kind, title, message, href, dedupe_key)
  values (
    p_client_id,
    'Membership',
    'Membership updated',
    'Your Orion membership is now ' || p_tier || ' (' || p_status || ').',
    '/portal#trading-accounts',
    'membership:' || p_client_id::text || ':' || extract(epoch from changed_at)::text
  ) on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'storedTier', target_client.membership_tier,
    'effectiveTier', effective_tier,
    'status', target_client.membership_status,
    'startedAt', target_client.membership_started_at,
    'expiresAt', target_client.membership_expires_at
  );
end;
$$;

create or replace function public.validate_orion_license_binding(
  p_key_hash text,
  p_account_number text,
  p_broker_server text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  license_record record;
  checked_at timestamptz := clock_timestamp();
begin
  if coalesce(p_key_hash, '') !~ '^[0-9a-f]{64}$'
    or btrim(coalesce(p_account_number, '')) !~ '^[0-9]{4,24}$'
    or char_length(btrim(coalesce(p_broker_server, ''))) not between 2 and 160
    or upper(btrim(coalesce(p_platform, ''))) not in ('MT4', 'MT5') then
    return jsonb_build_object('valid', false, 'code', 'INVALID_REQUEST');
  end if;

  select
    license.id,
    license.plan,
    license.platform,
    license.status,
    license.expires_at,
    license.revoked_at,
    license.binding_version,
    client.status as client_status,
    account.id as account_id,
    account.account_number,
    account.broker_server,
    account.platform as account_platform,
    account.status as account_status,
    account.account_type,
    account.verified_at
  into license_record
  from public.licenses as license
  join public.clients as client on client.id = license.client_id
  left join public.client_trading_accounts as account on account.id = license.trading_account_id
  where license.key_hash = lower(p_key_hash)
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'code', 'INVALID_LICENSE');
  end if;
  if license_record.status <> 'Active'
    or license_record.revoked_at is not null
    or (license_record.expires_at is not null and license_record.expires_at < checked_at)
    or license_record.client_status <> 'Active' then
    return jsonb_build_object('valid', false, 'code', 'LICENSE_INACTIVE');
  end if;
  if license_record.account_id is null
    or license_record.account_status <> 'Active'
    or license_record.account_type <> 'Real'
    or license_record.verified_at is null then
    return jsonb_build_object('valid', false, 'code', 'ACCOUNT_NOT_REGISTERED');
  end if;
  if license_record.account_number <> btrim(p_account_number)
    or lower(btrim(license_record.broker_server)) <> lower(btrim(p_broker_server))
    or license_record.account_platform <> upper(btrim(p_platform))
    or license_record.platform <> upper(btrim(p_platform)) then
    return jsonb_build_object('valid', false, 'code', 'ACCOUNT_MISMATCH');
  end if;

  update public.licenses
  set last_validation_at = checked_at,
      last_activated_at = checked_at
  where id = license_record.id;

  return jsonb_build_object(
    'valid', true,
    'code', 'VALID',
    'plan', license_record.plan,
    'platform', license_record.platform,
    'bindingVersion', license_record.binding_version,
    'expiresAt', license_record.expires_at,
    'validatedAt', checked_at
  );
end;
$$;

revoke all on function public.enforce_license_trading_account_binding() from public, anon, authenticated;
revoke all on function public.capture_payment_license_identity() from public, anon, authenticated;
revoke all on function public.enforce_trading_account_identity_owner() from public, anon, authenticated;
revoke all on function public._replace_registered_real_account(uuid, uuid, text, text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.change_registered_real_account_client(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.change_registered_real_account_admin(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_client_membership_admin(uuid, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.validate_orion_license_binding(text, text, text, text) from public, anon, authenticated;

grant execute on function public.change_registered_real_account_client(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.change_registered_real_account_admin(uuid, uuid, uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.set_client_membership_admin(uuid, uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.validate_orion_license_binding(text, text, text, text) to service_role;
