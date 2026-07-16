-- Automatically activate a client's paid plan when a completed payment and
-- a matching active license both exist. Safe to run more than once.

create or replace function public.sync_client_paid_access(target_client uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_plan text;
  changed_count integer;
begin
  select l.plan
    into matched_plan
  from public.licenses l
  join public.client_payments p
    on p.client_id = l.client_id
   and p.plan = l.plan
   and (p.license_id is null or p.license_id = l.id)
  where l.client_id = target_client
    and l.status = 'Active'
    and (l.expires_at is null or l.expires_at >= now())
    and p.status in ('Paid', 'Manually verified')
  order by case l.plan
    when 'Lifetime' then 3
    when 'Premium' then 2
    when 'Basic' then 1
    else 0
  end desc, p.payment_date desc nulls last, p.created_at desc
  limit 1;

  if matched_plan is null then
    return;
  end if;

  update public.clients
     set plan = matched_plan,
         status = 'Active',
         updated_at = now()
   where id = target_client
     and (plan is distinct from matched_plan or status is distinct from 'Active');

  get diagnostics changed_count = row_count;
  if changed_count > 0 then
    insert into public.client_activity (client_id, action, details, actor_email)
    values (
      target_client,
      'Client access activated automatically',
      matched_plan || ' plan · completed payment and active license verified',
      'system'
    );
  end if;
end;
$$;

create or replace function public.sync_client_paid_access_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_client_paid_access(old.client_id);
    return old;
  end if;

  perform public.sync_client_paid_access(new.client_id);
  if tg_op = 'UPDATE' and old.client_id is distinct from new.client_id then
    perform public.sync_client_paid_access(old.client_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_access_after_license_change on public.licenses;
create trigger sync_access_after_license_change
after insert or update or delete on public.licenses
for each row execute function public.sync_client_paid_access_trigger();

drop trigger if exists sync_access_after_payment_change on public.client_payments;
create trigger sync_access_after_payment_change
after insert or update or delete on public.client_payments
for each row execute function public.sync_client_paid_access_trigger();

-- Synchronize existing records immediately.
do $$
declare
  client_row record;
begin
  for client_row in select id from public.clients loop
    perform public.sync_client_paid_access(client_row.id);
  end loop;
end;
$$;
