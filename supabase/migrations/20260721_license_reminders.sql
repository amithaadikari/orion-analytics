create table if not exists public.license_reminders (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  expires_on date not null,
  reminder_days integer not null check (reminder_days in (30, 7, 1, 0)),
  recipient_email text not null,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (license_id, expires_on, reminder_days)
);
create index if not exists license_reminders_sent_idx on public.license_reminders(sent_at, expires_on);
alter table public.license_reminders enable row level security;
drop policy if exists license_reminders_admin_read on public.license_reminders;
create policy license_reminders_admin_read on public.license_reminders for select to authenticated using (public.is_approved_admin());
drop trigger if exists license_reminders_updated_at on public.license_reminders;
create trigger license_reminders_updated_at before update on public.license_reminders for each row execute function public.set_updated_at();
