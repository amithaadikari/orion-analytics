-- Dedicated acquisition-funnel events and safer invitation linking.

alter table public.events drop constraint if exists events_event_name_check;
alter table public.events add constraint events_event_name_check
  check (event_name in (
    'PageView','ViewContent','TelegramClick','SupportClick','Lead','Purchase',
    'PlanSelected','RegistrationStarted','RegistrationCompleted','CheckoutStarted'
  ));

create or replace function public.create_client_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_client uuid;
  linked_count integer;
begin
  begin
    linked_client := nullif(trim(new.raw_user_meta_data ->> 'client_id'), '')::uuid;
  exception when invalid_text_representation then
    linked_client := null;
  end;
  if linked_client is not null then
    update public.clients
       set auth_user_id = new.id,
           email = coalesce(email, new.email),
           updated_at = now()
     where id = linked_client
       and auth_user_id is null
       and lower(trim(coalesce(email, ''))) = lower(trim(coalesce(new.email, '')));
    get diagnostics linked_count = row_count;
    if linked_count > 0 then return new; end if;
  end if;

  insert into public.clients (auth_user_id, full_name, email, country, plan, status, notes)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'country'), ''),
    'Free',
    'Active',
    'Self-registered free account'
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;
