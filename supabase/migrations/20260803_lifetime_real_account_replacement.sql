-- Restrict client-initiated real-account replacement to the Lifetime plan.
-- Every active paid plan can still register its first real account. Standard
-- and Pro membership timing remains an additional protection for eligible
-- Lifetime replacements. Administrator overrides stay available and audited.

create or replace function public.change_registered_real_account_client(
  p_auth_user_id uuid,
  p_request_id uuid,
  p_account_number text,
  p_broker text,
  p_broker_server text,
  p_platform text,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client public.clients%rowtype;
  current_account public.client_trading_accounts%rowtype;
  existing_change public.trading_account_changes%rowtype;
  v_has_registered_real_account boolean := false;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ID_REQUIRED';
  end if;

  -- Preserve the inner mutation's lock order: request id first, then client.
  -- Reacquiring this transaction-scoped advisory lock inside the helper is
  -- harmless and avoids lock-order inversion with administrator requests.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  -- The client row lock serializes first registrations, replacements, plan
  -- changes, and retries so simultaneous requests cannot bypass the rule.
  select * into target_client
  from public.clients
  where auth_user_id = p_auth_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;

  -- Preserve exact request-id replay behavior. The inner function validates
  -- that the actor and complete target identity still match the first call.
  select * into existing_change
  from public.trading_account_changes
  where request_id = p_request_id;
  if found then
    return public._replace_registered_real_account(
      target_client.id,
      p_request_id,
      p_account_number,
      p_broker,
      p_broker_server,
      p_platform,
      p_currency,
      'Client',
      p_auth_user_id,
      coalesce(target_client.email, 'client:' || target_client.id::text),
      null
    );
  end if;

  -- Re-submitting the already-active identity is reconciliation, not a
  -- replacement. Keep it available so license bindings can safely resync.
  select * into current_account
  from public.client_trading_accounts
  where client_id = target_client.id
    and account_type = 'Real'
    and status = 'Active'
  for update;
  if current_account.id is not null
    and current_account.account_number = btrim(coalesce(p_account_number, ''))
    and lower(btrim(current_account.broker_server)) = lower(btrim(coalesce(p_broker_server, '')))
    and current_account.platform = upper(btrim(coalesce(p_platform, ''))) then
    return public._replace_registered_real_account(
      target_client.id,
      p_request_id,
      p_account_number,
      p_broker,
      p_broker_server,
      p_platform,
      p_currency,
      'Client',
      p_auth_user_id,
      coalesce(target_client.email, 'client:' || target_client.id::text),
      null
    );
  end if;

  -- An archived identity still counts as a completed registration. This
  -- prevents Basic or Premium clients from bypassing the rule when no account
  -- is currently active; Orion support can use the audited admin override.
  select exists (
    select 1
    from public.client_trading_accounts
    where client_id = target_client.id
      and account_type = 'Real'
      and verified_at is not null
  ) into v_has_registered_real_account;

  if v_has_registered_real_account
    and target_client.plan is distinct from 'Lifetime' then
    raise exception using
      errcode = 'P0001',
      message = 'REAL_ACCOUNT_CHANGE_REQUIRES_LIFETIME';
  end if;

  return public._replace_registered_real_account(
    target_client.id,
    p_request_id,
    p_account_number,
    p_broker,
    p_broker_server,
    p_platform,
    p_currency,
    'Client',
    p_auth_user_id,
    coalesce(target_client.email, 'client:' || target_client.id::text),
    null
  );
end;
$$;

revoke all on function public.change_registered_real_account_client(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.change_registered_real_account_client(uuid, uuid, text, text, text, text, text) to service_role;

comment on function public.change_registered_real_account_client(uuid, uuid, text, text, text, text, text)
  is 'Registers the first real account for an eligible client; subsequent client replacements require the Lifetime plan and remain subject to membership security timing.';
