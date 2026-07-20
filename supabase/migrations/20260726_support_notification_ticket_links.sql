-- Exact support-ticket notification links and deterministic portal history.

alter table public.client_notifications
  add column if not exists ticket_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_notifications_ticket_owner_fk'
      and conrelid = 'public.client_notifications'::regclass
  ) then
    alter table public.client_notifications
      add constraint client_notifications_ticket_owner_fk
      foreign key (ticket_id, client_id)
      references public.support_tickets(id, client_id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists support_tickets_client_timeline_v2_idx
  on public.support_tickets(client_id, updated_at desc, id desc);
create index if not exists support_ticket_messages_timeline_v2_idx
  on public.support_ticket_messages(ticket_id, created_at desc, id desc);
create index if not exists client_notifications_ticket_unread_idx
  on public.client_notifications(client_id, ticket_id, created_at desc)
  where kind = 'Support' and read_at is null and ticket_id is not null;

update public.client_notifications as notification
set ticket_id = message.ticket_id,
    href = '/portal?ticket=' || message.ticket_id::text || '#support'
from public.support_ticket_messages as message
where notification.client_id = message.client_id
  and notification.kind = 'Support'
  and notification.dedupe_key = 'ticket-message:' || message.id::text
  and (
    notification.ticket_id is distinct from message.ticket_id
    or notification.href is distinct from '/portal?ticket=' || message.ticket_id::text || '#support'
  );

create or replace function public.notify_client_ticket_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_type = 'Admin' then
    insert into public.client_notifications (client_id, ticket_id, kind, title, message, href, dedupe_key)
    values (
      new.client_id,
      new.ticket_id,
      'Support',
      'New support reply',
      'Orion support replied to your ticket.',
      '/portal?ticket=' || new.ticket_id::text || '#support',
      'ticket-message:' || new.id::text
    )
    on conflict (dedupe_key) do update
      set ticket_id = excluded.ticket_id,
          href = excluded.href;
  end if;
  return new;
end;
$$;
