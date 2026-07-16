-- Client self-registration with free access and admin-approved paid plans.
-- Existing clients remain unchanged.

alter table public.clients drop constraint if exists clients_plan_check;
alter table public.clients add constraint clients_plan_check
  check (plan in ('Free','Basic','Premium','Lifetime'));

alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients add constraint clients_status_check
  check (status in ('Pending','Active','Expired','Suspended'));

create or replace function public.create_client_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  linked_client uuid;
begin
  linked_client := nullif(new.raw_user_meta_data ->> 'client_id', '')::uuid;
  if linked_client is not null then
    update public.clients
       set auth_user_id = new.id,
           email = coalesce(email, new.email),
           updated_at = now()
     where id = linked_client and auth_user_id is null;
    return new;
  end if;

  requested := coalesce(new.raw_user_meta_data ->> 'requested_plan', 'Free');
  if requested not in ('Free','Basic','Premium','Lifetime') then requested := 'Free'; end if;

  insert into public.clients (auth_user_id, full_name, email, country, plan, status, notes)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'country'), ''),
    requested,
    case when requested = 'Free' then 'Active' else 'Pending' end,
    case when requested = 'Free' then 'Self-registered free account' else 'Self-registered; paid plan requires admin approval' end
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_client_after_auth_signup on auth.users;
create trigger create_client_after_auth_signup
  after insert on auth.users
  for each row execute function public.create_client_from_auth_user();

-- Published product files are visible only when the signed-in client owns a
-- currently active license for the matching platform.
drop policy if exists product_releases_authenticated_read on public.product_releases;
create policy product_releases_authenticated_read on public.product_releases for select to authenticated
  using (
    published = true and exists (
      select 1
      from public.clients c
      join public.licenses l on l.client_id = c.id
      where c.auth_user_id = auth.uid()
        and c.status = 'Active'
        and l.status = 'Active'
        and (l.expires_at is null or l.expires_at >= now())
        and (product_releases.platform = 'Both' or product_releases.platform = l.platform)
    )
  );
