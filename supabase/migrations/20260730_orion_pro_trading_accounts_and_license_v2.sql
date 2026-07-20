-- Orion Pro membership, registered trading accounts, and opaque V2 license keys.
-- Existing ORI-* license keys remain valid and are marked as legacy.

alter table public.clients
  add column if not exists membership_tier text not null default 'Standard',
  add column if not exists membership_status text not null default 'Active',
  add column if not exists membership_started_at timestamptz,
  add column if not exists membership_expires_at timestamptz;

alter table public.clients drop constraint if exists clients_membership_tier_check;
alter table public.clients add constraint clients_membership_tier_check
  check (membership_tier in ('Standard', 'Pro'));
alter table public.clients drop constraint if exists clients_membership_status_check;
alter table public.clients add constraint clients_membership_status_check
  check (membership_status in ('Active', 'Expired', 'Cancelled', 'Suspended'));

create table if not exists public.client_trading_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  account_number text not null,
  broker text not null,
  broker_server text not null,
  platform text not null default 'MT5' check (platform in ('MT4', 'MT5')),
  account_type text not null default 'Real' check (account_type in ('Real', 'Demo')),
  currency text,
  status text not null default 'Active' check (status in ('Active', 'Archived', 'Suspended')),
  verified_at timestamptz,
  registered_at timestamptz not null default now(),
  deactivated_at timestamptz,
  change_source text not null default 'Admin' check (change_source in ('Admin', 'Client', 'Migration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trading_accounts_active_real_client_idx
  on public.client_trading_accounts(client_id)
  where account_type = 'Real' and status = 'Active';
create unique index if not exists trading_accounts_active_real_identity_idx
  on public.client_trading_accounts(account_number, broker_server, platform)
  where account_type = 'Real' and status = 'Active';
create index if not exists trading_accounts_client_idx
  on public.client_trading_accounts(client_id, created_at desc);

create table if not exists public.trading_account_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  previous_account_id uuid references public.client_trading_accounts(id) on delete set null,
  new_account_id uuid not null references public.client_trading_accounts(id) on delete restrict,
  membership_tier text not null check (membership_tier in ('Standard', 'Pro')),
  changed_by text not null check (changed_by in ('Admin', 'Client', 'System')),
  actor_id text,
  override_reason text,
  created_at timestamptz not null default now()
);

create index if not exists trading_account_changes_client_idx
  on public.trading_account_changes(client_id, created_at desc);

alter table public.licenses
  add column if not exists key_version text not null default 'legacy',
  add column if not exists key_hash text,
  add column if not exists trading_account_id uuid references public.client_trading_accounts(id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists last_validation_at timestamptz;

alter table public.licenses drop constraint if exists licenses_key_version_check;
alter table public.licenses add constraint licenses_key_version_check
  check (key_version in ('legacy', 'v2'));

update public.licenses
set key_version = case when license_key like 'ORN-%' then 'v2' else 'legacy' end
where key_version is distinct from case when license_key like 'ORN-%' then 'v2' else 'legacy' end;

create unique index if not exists licenses_key_hash_unique_idx
  on public.licenses(key_hash)
  where key_hash is not null;
create index if not exists licenses_trading_account_idx
  on public.licenses(trading_account_id)
  where trading_account_id is not null;

drop trigger if exists client_trading_accounts_updated_at on public.client_trading_accounts;
create trigger client_trading_accounts_updated_at before update on public.client_trading_accounts
for each row execute function public.set_updated_at();

alter table public.client_trading_accounts enable row level security;
alter table public.trading_account_changes enable row level security;

drop policy if exists trading_accounts_admin_read on public.client_trading_accounts;
create policy trading_accounts_admin_read on public.client_trading_accounts
for select to authenticated using (public.is_approved_admin());
drop policy if exists trading_accounts_client_read on public.client_trading_accounts;
create policy trading_accounts_client_read on public.client_trading_accounts
for select to authenticated using (
  exists (
    select 1 from public.clients
    where clients.id = client_trading_accounts.client_id
      and clients.auth_user_id = auth.uid()
  )
);

drop policy if exists trading_account_changes_admin_read on public.trading_account_changes;
create policy trading_account_changes_admin_read on public.trading_account_changes
for select to authenticated using (public.is_approved_admin());
drop policy if exists trading_account_changes_client_read on public.trading_account_changes;
create policy trading_account_changes_client_read on public.trading_account_changes
for select to authenticated using (
  exists (
    select 1 from public.clients
    where clients.id = trading_account_changes.client_id
      and clients.auth_user_id = auth.uid()
  )
);

-- All writes continue through authenticated server routes using the service role.
