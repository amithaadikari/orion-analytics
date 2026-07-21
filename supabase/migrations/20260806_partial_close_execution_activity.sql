-- Orion V5.2 immutable partial-close execution activity.
--
-- The original closed-trade helper intentionally emits one row only after a
-- whole position closes. This additive read model preserves that lifecycle
-- report while exposing each broker exit deal as its own immutable activity
-- row. Cumulative position state is calculated before the requested time
-- filter, so an older partial exit never becomes Closed after a later exit.

create index if not exists orion_closed_deals_scope_position_timeline_idx
  on public.orion_closed_deals (
    account_scope_id,
    position_id,
    deal_time_msc,
    ((deal_ticket)::numeric)
  );

create index if not exists orion_closed_deals_scope_exit_activity_idx
  on public.orion_closed_deals (
    account_scope_id,
    deal_time_msc desc,
    ((deal_ticket)::numeric) desc
  )
  where entry in ('Out', 'OutBy');

create or replace function public.read_orion_trade_execution_activity(
  p_client_id uuid,
  p_account_scope_id uuid,
  p_since timestamptz,
  p_page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_incomplete_history_excluded boolean := false;
begin
  if p_client_id is null
    or p_account_scope_id is null
    or p_page_size is null
    or p_page_size not between 1 and 100
    or not exists (
      select 1
      from public.orion_telemetry_account_scopes as scope
      where scope.id = p_account_scope_id
        and scope.client_id = p_client_id
    ) then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'hasMore', false,
      'incompleteHistoryExcluded', false
    );
  end if;

  -- Preserve explicit evidence when an exit cannot be classified from retained
  -- broker history. Never infer its entry side or claim that it fully closed.
  select exists (
    select
      1
    from public.orion_closed_deals as exit_deal
    where exit_deal.client_id = p_client_id
      and exit_deal.account_scope_id = p_account_scope_id
      and exit_deal.entry in ('Out', 'OutBy')
      and (p_since is null or exit_deal.deal_time >= p_since)
      and (
        exit_deal.position_id = '0'
        or not exists (
          select 1
          from public.orion_closed_deals as entry_deal
          where entry_deal.account_scope_id = exit_deal.account_scope_id
            and entry_deal.position_id = exit_deal.position_id
            and entry_deal.entry = 'In'
            and entry_deal.volume > 0
            and (entry_deal.deal_time_msc, entry_deal.deal_ticket::numeric)
              <= (exit_deal.deal_time_msc, exit_deal.deal_ticket::numeric)
        )
      )
  ) into v_incomplete_history_excluded;

  with valid_candidates as (
    select
      exit_deal.deal_ticket,
      exit_deal.order_ticket,
      exit_deal.position_id,
      exit_deal.deal_time_msc,
      exit_deal.deal_time,
      exit_deal.symbol,
      lifecycle.original_side,
      exit_deal.volume,
      exit_deal.price,
      exit_deal.profit,
      exit_deal.swap,
      exit_deal.commission + exit_deal.fee as commission,
      exit_deal.net_profit,
      greatest(
        lifecycle.cumulative_entry_volume - lifecycle.cumulative_exit_volume,
        0
      ) as remaining_volume,
      case
        when lifecycle.cumulative_exit_volume >= lifecycle.cumulative_entry_volume
          then 'Closed'
        else 'Partial'
      end as execution_status
    from public.orion_closed_deals as exit_deal
    cross join lateral (
      select
        (
          array_agg(prior_deal.side order by prior_deal.deal_time_msc, prior_deal.deal_ticket::numeric)
            filter (where prior_deal.entry = 'In')
        )[1] as original_side,
        coalesce(
          sum(prior_deal.volume) filter (where prior_deal.entry = 'In'),
          0
        ) as cumulative_entry_volume,
        coalesce(
          sum(prior_deal.volume) filter (where prior_deal.entry in ('Out', 'OutBy')),
          0
        ) as cumulative_exit_volume
      from public.orion_closed_deals as prior_deal
      where prior_deal.account_scope_id = exit_deal.account_scope_id
        and prior_deal.position_id = exit_deal.position_id
        and (prior_deal.deal_time_msc, prior_deal.deal_ticket::numeric)
          <= (exit_deal.deal_time_msc, exit_deal.deal_ticket::numeric)
    ) as lifecycle
    where exit_deal.client_id = p_client_id
      and exit_deal.account_scope_id = p_account_scope_id
      and exit_deal.entry in ('Out', 'OutBy')
      and exit_deal.position_id <> '0'
      and (p_since is null or exit_deal.deal_time >= p_since)
      and lifecycle.original_side in ('Buy', 'Sell')
      and lifecycle.cumulative_entry_volume > 0
      and not exists (
        select 1
        from public.orion_closed_deals as reversal_deal
        where reversal_deal.account_scope_id = exit_deal.account_scope_id
          and reversal_deal.position_id = exit_deal.position_id
          and reversal_deal.entry = 'InOut'
      )
    order by exit_deal.deal_time_msc desc, exit_deal.deal_ticket::numeric desc
    limit p_page_size + 1
  ), page as (
    select candidate.*
    from valid_candidates as candidate
    order by candidate.deal_time_msc desc, candidate.deal_ticket::numeric desc
    limit p_page_size
  )
  select
    (select count(*) > p_page_size from valid_candidates),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', page.deal_ticket,
          'positionId', page.position_id,
          'ticket', page.order_ticket,
          'symbol', page.symbol,
          'side', page.original_side,
          'volume', page.volume,
          'executedAt', page.deal_time,
          'exitPrice', page.price,
          'profit', page.profit,
          'swap', page.swap,
          'commission', page.commission,
          'netProfit', page.net_profit,
          'remainingVolume', page.remaining_volume,
          'status', page.execution_status
        ) order by page.deal_time_msc desc, page.deal_ticket::numeric desc
      ),
      '[]'::jsonb
    )
  into v_has_more, v_items
  from page;

  return jsonb_build_object(
    'items', v_items,
    'hasMore', v_has_more,
    'incompleteHistoryExcluded', v_incomplete_history_excluded
  );
end;
$$;

revoke all on function public.read_orion_trade_execution_activity(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.read_orion_trade_execution_activity(uuid, uuid, timestamptz, integer)
  to service_role;
