-- Orion Performance Intelligence Center.
--
-- One fully closed position is the only performance fact. Partial exits stay
-- visible in Execution Activity, but are rolled into the final position result
-- here so trade counts, streaks, calendars and exports never double count.

alter table public.orion_closed_deals
  add column if not exists currency text;

update public.orion_closed_deals as deal
set currency = snapshot.currency
from public.orion_account_snapshots as snapshot
where deal.currency is null
  and snapshot.client_id = deal.client_id
  and snapshot.account_scope_id = deal.account_scope_id
  and snapshot.request_id = deal.first_seen_request_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orion_closed_deals'::regclass
      and conname = 'orion_closed_deals_currency_check'
  ) then
    alter table public.orion_closed_deals
      add constraint orion_closed_deals_currency_check
      check (currency is null or currency ~ '^[A-Z0-9]{3,8}$');
  end if;
end;
$$;

create or replace function public.set_orion_closed_deal_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency text;
begin
  if new.currency is null then
    select snapshot.currency
      into v_currency
    from public.orion_account_snapshots as snapshot
    where snapshot.client_id = new.client_id
      and snapshot.account_scope_id = new.account_scope_id
      and snapshot.request_id = new.first_seen_request_id;
    new.currency := v_currency;
  end if;
  if new.currency is null then
    raise exception using
      errcode = '23514',
      message = 'Closed-deal currency evidence is required';
  end if;
  return new;
end;
$$;

drop trigger if exists set_orion_closed_deal_currency_on_insert
  on public.orion_closed_deals;
create trigger set_orion_closed_deal_currency_on_insert
before insert on public.orion_closed_deals
for each row execute function public.set_orion_closed_deal_currency();

create or replace function public.orion_closed_trade_rows(
  p_client_id uuid,
  p_account_scope_id uuid
)
returns table (
  position_id text,
  ticket text,
  symbol text,
  side text,
  volume numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  entry_price numeric,
  exit_price numeric,
  profit numeric,
  swap numeric,
  commission numeric,
  net_profit numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with grouped as (
    select
      deal.position_id,
      (array_agg(
        deal.order_ticket
        order by deal.deal_time_msc desc, deal.deal_ticket::numeric desc
      ) filter (where deal.entry in ('Out', 'OutBy')))[1] as ticket,
      (array_agg(
        deal.symbol
        order by deal.deal_time_msc, deal.deal_ticket::numeric
      ) filter (where deal.entry = 'In'))[1] as symbol,
      (array_agg(
        deal.side
        order by deal.deal_time_msc, deal.deal_ticket::numeric
      ) filter (where deal.entry = 'In'))[1] as side,
      coalesce(sum(deal.volume) filter (where deal.entry = 'In'), 0) as entry_volume,
      coalesce(sum(deal.volume) filter (where deal.entry in ('Out', 'OutBy')), 0) as exit_volume,
      min(deal.deal_time) filter (where deal.entry = 'In') as opened_at,
      max(deal.deal_time) filter (where deal.entry in ('Out', 'OutBy')) as closed_at,
      sum(deal.price * deal.volume) filter (where deal.entry = 'In')
        / nullif(sum(deal.volume) filter (where deal.entry = 'In'), 0) as entry_price,
      sum(deal.price * deal.volume) filter (where deal.entry in ('Out', 'OutBy'))
        / nullif(sum(deal.volume) filter (where deal.entry in ('Out', 'OutBy')), 0) as exit_price,
      sum(deal.profit) as profit,
      sum(deal.swap) as swap,
      sum(deal.commission + deal.fee) as commission,
      sum(deal.net_profit) as net_profit,
      bool_or(deal.entry = 'InOut') as has_netting_reversal
    from public.orion_closed_deals as deal
    where deal.client_id = p_client_id
      and deal.account_scope_id = p_account_scope_id
      and exists (
        select 1
        from public.orion_telemetry_account_scopes as scope
        where scope.id = p_account_scope_id
          and scope.client_id = p_client_id
      )
    group by deal.position_id
  )
  select
    grouped.position_id,
    grouped.ticket,
    grouped.symbol,
    grouped.side,
    grouped.exit_volume as volume,
    grouped.opened_at,
    grouped.closed_at,
    grouped.entry_price,
    grouped.exit_price,
    grouped.profit,
    grouped.swap,
    grouped.commission,
    grouped.net_profit
  from grouped
  where grouped.position_id <> '0'
    and grouped.opened_at is not null
    and grouped.closed_at is not null
    and grouped.symbol is not null
    and grouped.side in ('Buy', 'Sell')
    and grouped.entry_volume > 0
    and grouped.exit_volume = grouped.entry_volume
    and not grouped.has_netting_reversal
    and not exists (
      select 1
      from public.orion_open_positions as position
      where position.client_id = p_client_id
        and position.account_scope_id = p_account_scope_id
        and position.position_id = grouped.position_id
    );
$$;

create or replace function public.read_orion_performance_intelligence(
  p_client_id uuid,
  p_account_scope_id uuid,
  p_since timestamptz,
  p_until timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_client_id is null
    or p_account_scope_id is null
    or p_until is null
    or p_until > current_timestamp + interval '5 minutes'
    or (p_since is not null and p_since >= p_until)
    or not exists (
      select 1
      from public.orion_telemetry_account_scopes as scope
      join public.clients as client
        on client.id = scope.client_id
       and client.status = 'Active'
      join public.licenses as license
        on license.id = scope.license_id
       and license.client_id = scope.client_id
       and license.status = 'Active'
       and license.revoked_at is null
       and (license.expires_at is null or license.expires_at >= current_timestamp)
      where scope.id = p_account_scope_id
        and scope.client_id = p_client_id
        and exists (
          select 1
          from public.orion_telemetry_streams as stream
          where stream.account_scope_id = scope.id
            and stream.client_id = scope.client_id
            and stream.license_id = license.id
            and stream.status = 'Active'
            and stream.binding_version = license.binding_version
        )
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'PERFORMANCE_SCOPE_NOT_AUTHORIZED';
  end if;

  with
  trades as materialized (
    select trade.*
    from public.orion_closed_trade_rows(p_client_id, p_account_scope_id) as trade
    where (p_since is null or trade.closed_at >= p_since)
      and trade.closed_at < p_until
  ),
  overview as (
    select
      count(*)::integer as closed_trades,
      count(*) filter (where net_profit > 0)::integer as wins,
      count(*) filter (where net_profit < 0)::integer as losses,
      count(*) filter (where net_profit = 0)::integer as breakeven,
      coalesce(sum(net_profit), 0) as realized_net,
      coalesce(sum(net_profit) filter (where net_profit > 0), 0) as gross_profit,
      abs(coalesce(sum(net_profit) filter (where net_profit < 0), 0)) as gross_loss,
      avg(net_profit) filter (where net_profit > 0) as average_win,
      avg(net_profit) filter (where net_profit < 0) as average_loss,
      avg(net_profit) as expectancy,
      max(net_profit) as best_trade,
      min(net_profit) as worst_trade,
      min(closed_at) as coverage_start
    from trades
  ),
  equity_series as (
    select
      snapshot.observed_at,
      snapshot.equity,
      max(snapshot.equity) over (
        order by snapshot.observed_at, snapshot.id
        rows between unbounded preceding and current row
      ) as peak_equity
    from public.orion_account_snapshots as snapshot
    where snapshot.client_id = p_client_id
      and snapshot.account_scope_id = p_account_scope_id
      and (p_since is null or snapshot.observed_at >= p_since)
      and snapshot.observed_at < p_until
  ),
  drawdown as (
    select
      count(*) as sample_count,
      min(observed_at) as coverage_start,
      max(greatest(peak_equity - equity, 0)) as max_money,
      max(case
        when peak_equity > 0 then greatest(peak_equity - equity, 0) / peak_equity * 100
        else 0
      end) as max_percent
    from equity_series
  ),
  outcomes as (
    select
      closed_at,
      position_id,
      case when net_profit > 0 then 'win' when net_profit < 0 then 'loss' else 'flat' end as outcome
    from trades
  ),
  streak_rows as (
    select
      outcome,
      row_number() over (order by closed_at, position_id::numeric)
        - row_number() over (
          partition by outcome
          order by closed_at, position_id::numeric
        ) as streak_group
    from outcomes
  ),
  streak_counts as (
    select outcome, streak_group, count(*)::integer as streak_length
    from streak_rows
    group by outcome, streak_group
  ),
  streaks as (
    select
      max(streak_length) filter (where outcome = 'win') as max_win_streak,
      max(streak_length) filter (where outcome = 'loss') as max_loss_streak
    from streak_counts
  ),
  daily_rows as (
    select
      (closed_at at time zone 'UTC')::date as trade_date,
      count(*)::integer as closed_trades,
      count(*) filter (where net_profit > 0)::integer as wins,
      count(*) filter (where net_profit < 0)::integer as losses,
      count(*) filter (where net_profit = 0)::integer as breakeven,
      sum(net_profit) as net_profit
    from trades
    group by (closed_at at time zone 'UTC')::date
  ),
  calendar_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(trade_date, 'YYYY-MM-DD'),
          'netProfit', net_profit,
          'closedTrades', closed_trades,
          'wins', wins,
          'losses', losses,
          'breakeven', breakeven
        )
        order by trade_date
      ),
      '[]'::jsonb
    ) as value
    from daily_rows
  ),
  symbol_grouped as (
    select
      symbol as key,
      symbol as label,
      count(*)::integer as closed_trades,
      count(*) filter (where net_profit > 0)::integer as wins,
      count(*) filter (where net_profit < 0)::integer as losses,
      count(*) filter (where net_profit = 0)::integer as breakeven,
      sum(net_profit) as net_profit,
      avg(net_profit) as average_net
    from trades
    group by symbol
  ),
  symbol_ranked as (
    select
      grouped.*,
      row_number() over (order by closed_trades desc, key) as symbol_rank
    from symbol_grouped as grouped
  ),
  symbol_rows as (
    select
      key,
      label,
      closed_trades,
      wins,
      losses,
      breakeven,
      net_profit,
      average_net
    from symbol_ranked
    where symbol_rank <= 199
    union all
    select
      'other' as key,
      'Other symbols' as label,
      sum(closed_trades)::integer as closed_trades,
      sum(wins)::integer as wins,
      sum(losses)::integer as losses,
      sum(breakeven)::integer as breakeven,
      sum(net_profit) as net_profit,
      sum(net_profit) / nullif(sum(closed_trades), 0) as average_net
    from symbol_ranked
    where symbol_rank > 199
    having count(*) > 0
  ),
  symbol_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', key,
          'label', label,
          'netProfit', net_profit,
          'closedTrades', closed_trades,
          'wins', wins,
          'losses', losses,
          'breakeven', breakeven,
          'winRate', case when closed_trades > 0 then wins::numeric / closed_trades * 100 else null end,
          'averageNet', average_net
        )
        order by closed_trades desc, key
      ),
      '[]'::jsonb
    ) as value
    from symbol_rows
  ),
  direction_rows as (
    select
      lower(side) as key,
      side as label,
      count(*)::integer as closed_trades,
      count(*) filter (where net_profit > 0)::integer as wins,
      count(*) filter (where net_profit < 0)::integer as losses,
      count(*) filter (where net_profit = 0)::integer as breakeven,
      sum(net_profit) as net_profit,
      avg(net_profit) as average_net
    from trades
    group by side
  ),
  direction_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', key,
          'label', label,
          'netProfit', net_profit,
          'closedTrades', closed_trades,
          'wins', wins,
          'losses', losses,
          'breakeven', breakeven,
          'winRate', case when closed_trades > 0 then wins::numeric / closed_trades * 100 else null end,
          'averageNet', average_net
        )
        order by key
      ),
      '[]'::jsonb
    ) as value
    from direction_rows
  ),
  weekday_rows as (
    select
      extract(isodow from closed_at at time zone 'UTC')::integer as weekday_number,
      count(*)::integer as closed_trades,
      count(*) filter (where net_profit > 0)::integer as wins,
      count(*) filter (where net_profit < 0)::integer as losses,
      count(*) filter (where net_profit = 0)::integer as breakeven,
      sum(net_profit) as net_profit,
      avg(net_profit) as average_net
    from trades
    group by extract(isodow from closed_at at time zone 'UTC')::integer
  ),
  weekday_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', weekday_number::text,
          'label', case weekday_number
            when 1 then 'Monday'
            when 2 then 'Tuesday'
            when 3 then 'Wednesday'
            when 4 then 'Thursday'
            when 5 then 'Friday'
            when 6 then 'Saturday'
            else 'Sunday'
          end,
          'netProfit', net_profit,
          'closedTrades', closed_trades,
          'wins', wins,
          'losses', losses,
          'breakeven', breakeven,
          'winRate', case when closed_trades > 0 then wins::numeric / closed_trades * 100 else null end,
          'averageNet', average_net
        )
        order by weekday_number
      ),
      '[]'::jsonb
    ) as value
    from weekday_rows
  ),
  session_rows as (
    select
      case
        when extract(hour from opened_at at time zone 'UTC') < 8 then 1
        when extract(hour from opened_at at time zone 'UTC') < 13 then 2
        when extract(hour from opened_at at time zone 'UTC') < 21 then 3
        else 4
      end as session_number,
      count(*)::integer as closed_trades,
      count(*) filter (where net_profit > 0)::integer as wins,
      count(*) filter (where net_profit < 0)::integer as losses,
      count(*) filter (where net_profit = 0)::integer as breakeven,
      sum(net_profit) as net_profit,
      avg(net_profit) as average_net
    from trades
    group by case
      when extract(hour from opened_at at time zone 'UTC') < 8 then 1
      when extract(hour from opened_at at time zone 'UTC') < 13 then 2
      when extract(hour from opened_at at time zone 'UTC') < 21 then 3
      else 4
    end
  ),
  session_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', case session_number
            when 1 then 'asia'
            when 2 then 'london'
            when 3 then 'new-york'
            else 'late-utc'
          end,
          'label', case session_number
            when 1 then 'Asia entry'
            when 2 then 'London entry'
            when 3 then 'New York entry'
            else 'Late UTC entry'
          end,
          'netProfit', net_profit,
          'closedTrades', closed_trades,
          'wins', wins,
          'losses', losses,
          'breakeven', breakeven,
          'winRate', case when closed_trades > 0 then wins::numeric / closed_trades * 100 else null end,
          'averageNet', average_net
        )
        order by session_number
      ),
      '[]'::jsonb
    ) as value
    from session_rows
  ),
  raw_lifecycles as (
    select
      deal.position_id,
      bool_or(deal.entry = 'In') as has_entry,
      bool_or(deal.entry in ('Out', 'OutBy')) as has_exit,
      bool_or(deal.entry = 'InOut') as has_netting_reversal,
      coalesce(sum(deal.volume) filter (where deal.entry = 'In'), 0) as entry_volume,
      coalesce(sum(deal.volume) filter (where deal.entry in ('Out', 'OutBy')), 0) as exit_volume,
      max(deal.deal_time) filter (where deal.entry in ('Out', 'OutBy', 'InOut')) as lifecycle_closed_at
    from public.orion_closed_deals as deal
    where deal.client_id = p_client_id
      and deal.account_scope_id = p_account_scope_id
    group by deal.position_id
  ),
  quality_lifecycles as (
    select
      lifecycle.*,
      exists (
        select 1
        from public.orion_open_positions as position
        where position.client_id = p_client_id
          and position.account_scope_id = p_account_scope_id
          and position.position_id = lifecycle.position_id
      ) as currently_open
    from raw_lifecycles as lifecycle
    where lifecycle.lifecycle_closed_at < p_until
      and (p_since is null or lifecycle.lifecycle_closed_at >= p_since)
  ),
  quality_flags as (
    select
      coalesce(bool_or(has_exit and not has_entry and not has_netting_reversal), false)
        or coalesce(bool_or(position_id = '0' and has_exit), false) as incomplete_history_excluded,
      coalesce(bool_or(
        has_entry
        and has_exit
        and entry_volume <> exit_volume
        and not currently_open
        and not has_netting_reversal
      ), false) as volume_mismatch_excluded,
      coalesce(bool_or(has_netting_reversal), false) as netting_reversals_excluded
    from quality_lifecycles
  ),
  included_currency_evidence as (
    select deal.currency
    from trades
    join public.orion_closed_deals as deal
      on deal.client_id = p_client_id
     and deal.account_scope_id = p_account_scope_id
     and deal.position_id = trades.position_id
    union all
    select snapshot.currency
    from public.orion_account_snapshots as snapshot
    where snapshot.client_id = p_client_id
      and snapshot.account_scope_id = p_account_scope_id
      and (p_since is null or snapshot.observed_at >= p_since)
      and snapshot.observed_at < p_until
  ),
  currency_quality as (
    select
      count(*) = count(currency) as evidence_complete,
      count(distinct currency) > 1 as mixed,
      case when count(*) = count(currency) and count(distinct currency) = 1
        then max(currency)
        else null
      end as report_currency
    from included_currency_evidence
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'realizedNet', overview.realized_net,
      'winRate', case
        when overview.closed_trades > 0 then overview.wins::numeric / overview.closed_trades * 100
        else null
      end,
      'profitFactor', case
        when overview.gross_loss > 0 then overview.gross_profit / overview.gross_loss
        else null
      end,
      'maxDrawdownMoney', case
        when drawdown.sample_count >= 2
          and (
            (p_since is not null and drawdown.coverage_start <= p_since + interval '5 minutes')
            or (p_since is null and (
              overview.coverage_start is null
              or drawdown.coverage_start <= overview.coverage_start
            ))
          )
          then drawdown.max_money
        else null
      end,
      'maxDrawdownPercent', case
        when drawdown.sample_count >= 2
          and (
            (p_since is not null and drawdown.coverage_start <= p_since + interval '5 minutes')
            or (p_since is null and (
              overview.coverage_start is null
              or drawdown.coverage_start <= overview.coverage_start
            ))
          )
          then drawdown.max_percent
        else null
      end,
      'closedTrades', overview.closed_trades
    ),
    'metrics', jsonb_build_object(
      'averageWin', overview.average_win,
      'averageLoss', overview.average_loss,
      'expectancy', overview.expectancy,
      'bestTrade', overview.best_trade,
      'worstTrade', overview.worst_trade,
      'maxWinStreak', streaks.max_win_streak,
      'maxLossStreak', streaks.max_loss_streak
    ),
    'calendar', calendar_json.value,
    'breakdowns', jsonb_build_object(
      'symbols', symbol_json.value,
      'directions', direction_json.value,
      'weekdays', weekday_json.value,
      'sessions', session_json.value
    ),
    'dataQuality', jsonb_build_object(
      'partialClosesRolledIntoFinalClose', true,
      'incompleteHistoryExcluded', quality_flags.incomplete_history_excluded,
      'volumeMismatchExcluded', quality_flags.volume_mismatch_excluded,
      'nettingReversalsExcluded', quality_flags.netting_reversals_excluded,
      'mixedHistoricalCurrenciesDetected', currency_quality.mixed,
      'currencyEvidenceComplete', currency_quality.evidence_complete,
      'coverageStart', overview.coverage_start,
      'equityCoverageStart', drawdown.coverage_start,
      'equityCoverageComplete', (
        drawdown.sample_count >= 2
        and (
          (p_since is not null and drawdown.coverage_start <= p_since + interval '5 minutes')
          or (p_since is null and (
            overview.coverage_start is null
            or drawdown.coverage_start <= overview.coverage_start
          ))
        )
      ),
      'reportCurrency', currency_quality.report_currency,
      'calendarBasis', 'FINAL_CLOSE_UTC',
      'weekdayBasis', 'FINAL_CLOSE_UTC',
      'sessionBasis', 'ENTRY_TIME_UTC_FIXED_WINDOWS'
    )
  into v_result
  from overview
  cross join drawdown
  cross join streaks
  cross join calendar_json
  cross join symbol_json
  cross join direction_json
  cross join weekday_json
  cross join session_json
  cross join quality_flags
  cross join currency_quality;

  return v_result;
end;
$$;

revoke all on function public.orion_closed_trade_rows(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_orion_closed_deal_currency()
  from public, anon, authenticated, service_role;
revoke all on function public.read_orion_performance_intelligence(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.read_orion_performance_intelligence(uuid, uuid, timestamptz, timestamptz)
  to service_role;
