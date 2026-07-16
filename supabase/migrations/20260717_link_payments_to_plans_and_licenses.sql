-- Preserve the purchased plan on each transaction and optionally link it to a license.
-- Safe to run on an existing Phase 3 database.
alter table public.client_payments
  add column if not exists license_id uuid references public.licenses(id) on delete set null,
  add column if not exists plan text;

update public.client_payments payment
set plan = client.plan
from public.clients client
where payment.client_id = client.id
  and payment.plan is null;

alter table public.client_payments
  alter column plan set default 'Basic',
  alter column plan set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_payments_plan_check'
  ) then
    alter table public.client_payments
      add constraint client_payments_plan_check
      check (plan in ('Basic','Premium','Lifetime'));
  end if;
end $$;

create index if not exists client_payments_license_idx on public.client_payments(license_id);
create index if not exists client_payments_plan_idx on public.client_payments(plan);
