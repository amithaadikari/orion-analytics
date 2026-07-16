create sequence if not exists public.orion_receipt_number_seq start 1001;

alter table public.client_payments
  add column if not exists receipt_number text,
  add column if not exists receipt_sent_at timestamptz;

create unique index if not exists client_payments_receipt_number_idx
  on public.client_payments(receipt_number)
  where receipt_number is not null;

create or replace function public.assign_orion_receipt_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.receipt_number is null and new.status in ('Paid', 'Manually verified') then
    new.receipt_number := 'ORN-' || to_char(coalesce(new.payment_date, current_date), 'YYYY') || '-' ||
      lpad(nextval('public.orion_receipt_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists client_payments_assign_receipt_number on public.client_payments;
create trigger client_payments_assign_receipt_number
before insert or update of status on public.client_payments
for each row execute function public.assign_orion_receipt_number();

update public.client_payments
set receipt_number = 'ORN-' || to_char(coalesce(payment_date, created_at::date), 'YYYY') || '-' ||
  lpad(nextval('public.orion_receipt_number_seq')::text, 6, '0')
where receipt_number is null and status in ('Paid', 'Manually verified');
