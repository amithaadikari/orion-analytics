create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  telegram_username text,
  phone text,
  country text,
  plan text not null default 'Basic' check (plan in ('Basic','Premium','Lifetime')),
  status text not null default 'Active' check (status in ('Active','Expired','Suspended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  license_key text not null unique,
  platform text not null default 'MT5' check (platform in ('MT4','MT5')),
  account_number text,
  plan text not null default 'Basic' check (plan in ('Basic','Premium','Lifetime')),
  status text not null default 'Active' check (status in ('Active','Expired','Suspended')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  last_activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  license_id uuid references public.licenses(id) on delete set null,
  plan text not null default 'Basic' check (plan in ('Basic','Premium','Lifetime')),
  method text not null check (method in ('Crypto','Bank Transfer','Card','PayPal','Wise','Skrill','Cash','Other')),
  status text not null default 'Pending' check (status in ('Pending','Paid','Failed','Refunded','Disputed','Manually verified')),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  currency text not null default 'USD',
  payment_date date,
  reference_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_activity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action text not null,
  details text,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists clients_created_at_idx on public.clients(created_at desc);
create index if not exists clients_status_idx on public.clients(status);
create index if not exists licenses_client_idx on public.licenses(client_id);
create index if not exists licenses_status_idx on public.licenses(status);
create index if not exists client_payments_client_idx on public.client_payments(client_id);
create index if not exists client_payments_license_idx on public.client_payments(license_id);
create index if not exists client_payments_plan_idx on public.client_payments(plan);
create index if not exists client_payments_date_idx on public.client_payments(payment_date desc);
create index if not exists client_activity_client_idx on public.client_activity(client_id, created_at desc);

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
drop trigger if exists licenses_updated_at on public.licenses;
create trigger licenses_updated_at before update on public.licenses for each row execute function public.set_updated_at();
drop trigger if exists client_payments_updated_at on public.client_payments;
create trigger client_payments_updated_at before update on public.client_payments for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.licenses enable row level security;
alter table public.client_payments enable row level security;
alter table public.client_activity enable row level security;

drop policy if exists clients_admin_read on public.clients;
create policy clients_admin_read on public.clients for select to authenticated using (public.is_approved_admin());
drop policy if exists licenses_admin_read on public.licenses;
create policy licenses_admin_read on public.licenses for select to authenticated using (public.is_approved_admin());
drop policy if exists client_payments_admin_read on public.client_payments;
create policy client_payments_admin_read on public.client_payments for select to authenticated using (public.is_approved_admin());
drop policy if exists client_activity_admin_read on public.client_activity;
create policy client_activity_admin_read on public.client_activity for select to authenticated using (public.is_approved_admin());

-- All writes go through authenticated, admin-only server routes using the service role.
