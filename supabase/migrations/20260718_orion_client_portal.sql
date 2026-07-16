alter table public.clients
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

create index if not exists clients_auth_user_idx on public.clients(auth_user_id);

drop policy if exists clients_self_read on public.clients;
create policy clients_self_read on public.clients for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists licenses_client_self_read on public.licenses;
create policy licenses_client_self_read on public.licenses for select to authenticated
  using (exists (select 1 from public.clients where clients.id = licenses.client_id and clients.auth_user_id = auth.uid()));

drop policy if exists client_payments_self_read on public.client_payments;
create policy client_payments_self_read on public.client_payments for select to authenticated
  using (exists (select 1 from public.clients where clients.id = client_payments.client_id and clients.auth_user_id = auth.uid()));

create table if not exists public.product_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  release_notes text,
  platform text not null default 'MT5' check (platform in ('MT4','MT5','Both')),
  download_url text,
  published boolean not null default false,
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.product_releases enable row level security;
drop policy if exists product_releases_authenticated_read on public.product_releases;
create policy product_releases_authenticated_read on public.product_releases for select to authenticated
  using (published = true and exists (select 1 from public.clients where clients.auth_user_id = auth.uid()));
