import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260808_performance_intelligence_center.sql'),
  'utf8',
).toLowerCase();

const closedTradeStart = migration.indexOf(
  'create or replace function public.orion_closed_trade_rows',
);
const intelligenceStart = migration.indexOf(
  'create or replace function public.read_orion_performance_intelligence',
);
const closedTradeFunction = migration.slice(closedTradeStart, intelligenceStart);
const intelligenceFunction = migration.slice(
  intelligenceStart,
  migration.indexOf('revoke all on function', intelligenceStart),
);

describe('performance intelligence migration', () => {
  it('adds protected performance storage and intelligence without coupling the existing analytics endpoint to it', () => {
    expect(closedTradeStart).toBeGreaterThanOrEqual(0);
    expect(intelligenceStart).toBeGreaterThan(closedTradeStart);
    expect(migration).toMatch(
      /read_orion_performance_intelligence\([\s\S]+?p_client_id uuid,[\s\S]+?p_account_scope_id uuid,[\s\S]+?p_since timestamptz,[\s\S]+?p_until timestamptz[\s\S]+?returns jsonb/,
    );
    expect(intelligenceFunction).toContain('language plpgsql');
    expect(intelligenceFunction).toContain('stable');
    expect(intelligenceFunction).toContain('security definer');
    expect(intelligenceFunction).toContain('set search_path = public, pg_temp');
    expect(migration).not.toContain(
      'create or replace function public.read_orion_trading_performance(',
    );
    expect(migration).not.toContain('drop function');
    expect(migration).not.toContain('create table');
    expect(migration).toContain(
      'alter table public.orion_closed_deals\n  add column if not exists currency text',
    );
  });

  it('backfills and requires immutable closed-deal currency evidence for future reports', () => {
    expect(migration).toMatch(
      /update public\.orion_closed_deals as deal[\s\S]+set currency = snapshot\.currency[\s\S]+snapshot\.request_id = deal\.first_seen_request_id/,
    );
    expect(migration).toContain("check (currency is null or currency ~ '^[a-z0-9]{3,8}$')");
    expect(migration).toContain('create or replace function public.set_orion_closed_deal_currency()');
    expect(migration).toMatch(
      /create trigger set_orion_closed_deal_currency_on_insert[\s\S]+before insert on public\.orion_closed_deals[\s\S]+execute function public\.set_orion_closed_deal_currency\(\)/,
    );
    expect(migration).toContain("message = 'closed-deal currency evidence is required'");
  });

  it('preserves one completed-position row only after exit volume exactly balances entry volume', () => {
    expect(closedTradeFunction).toContain('group by deal.position_id');
    expect(closedTradeFunction).toMatch(
      /sum\(deal\.volume\) filter \(where deal\.entry = 'in'\)[\s\S]+as entry_volume/,
    );
    expect(closedTradeFunction).toMatch(
      /sum\(deal\.volume\) filter \(where deal\.entry in \('out', 'outby'\)\)[\s\S]+as exit_volume/,
    );
    expect(closedTradeFunction).toContain('grouped.entry_volume > 0');
    expect(closedTradeFunction).toContain('grouped.exit_volume = grouped.entry_volume');
    expect(closedTradeFunction).not.toContain('grouped.exit_volume >= grouped.entry_volume');
    expect(closedTradeFunction).toContain('grouped.position_id <> \'0\'');
    expect(closedTradeFunction).toContain('and not grouped.has_netting_reversal');
    expect(closedTradeFunction).toMatch(
      /not exists \([\s\S]+from public\.orion_open_positions as position[\s\S]+position\.position_id = grouped\.position_id/,
    );
    expect(closedTradeFunction).toContain('sum(deal.net_profit) as net_profit');
    expect(closedTradeFunction).toContain('grouped.exit_volume as volume');
  });

  it('keeps the completed-trade helper signature compatible with existing live analytics', () => {
    for (const output of [
      'position_id text',
      'ticket text',
      'symbol text',
      'side text',
      'volume numeric',
      'opened_at timestamptz',
      'closed_at timestamptz',
      'entry_price numeric',
      'exit_price numeric',
      'profit numeric',
      'swap numeric',
      'commission numeric',
      'net_profit numeric',
    ]) {
      expect(closedTradeFunction).toContain(output);
    }
    expect(closedTradeFunction).toContain('where deal.client_id = p_client_id');
    expect(closedTradeFunction).toContain('and deal.account_scope_id = p_account_scope_id');
    expect(closedTradeFunction).toMatch(
      /from public\.orion_telemetry_account_scopes as scope[\s\S]+scope\.id = p_account_scope_id[\s\S]+scope\.client_id = p_client_id/,
    );
  });

  it('revalidates active client, license, stream, binding, and exact scope ownership', () => {
    const validation = intelligenceFunction.slice(
      0,
      intelligenceFunction.indexOf('with\n  trades as materialized'),
    );
    expect(validation).toContain('p_client_id is null');
    expect(validation).toContain('p_account_scope_id is null');
    expect(validation).toContain('p_until is null');
    expect(validation).toContain("p_until > current_timestamp + interval '5 minutes'");
    expect(validation).toContain('p_since is not null and p_since >= p_until');
    expect(validation).toContain("client.status = 'active'");
    expect(validation).toContain("license.status = 'active'");
    expect(validation).toContain('license.revoked_at is null');
    expect(validation).toContain('license.expires_at >= current_timestamp');
    expect(validation).toContain('scope.client_id = p_client_id');
    expect(validation).toContain("stream.status = 'active'");
    expect(validation).toContain('stream.binding_version = license.binding_version');
  });

  it('materializes completed positions once and derives every KPI from that lifecycle-safe set', () => {
    expect(intelligenceFunction).toMatch(
      /trades as materialized \([\s\S]+from public\.orion_closed_trade_rows\(p_client_id, p_account_scope_id\) as trade[\s\S]+trade\.closed_at >= p_since[\s\S]+trade\.closed_at < p_until/,
    );
    expect(intelligenceFunction).toContain('snapshot.observed_at < p_until');
    expect(intelligenceFunction.match(/orion_closed_trade_rows\(/g)).toHaveLength(1);
    expect(intelligenceFunction).toContain('avg(net_profit) filter (where net_profit > 0) as average_win');
    expect(intelligenceFunction).toContain('avg(net_profit) filter (where net_profit < 0) as average_loss');
    expect(intelligenceFunction).toContain('avg(net_profit) as expectancy');
    expect(intelligenceFunction).toContain('max(net_profit) as best_trade');
    expect(intelligenceFunction).toContain('min(net_profit) as worst_trade');
    expect(intelligenceFunction).toContain('from trades');
    expect(intelligenceFunction).not.toContain('read_orion_trade_execution_activity');
  });

  it('computes deterministic win and loss streaks while treating breakeven as a reset', () => {
    expect(intelligenceFunction).toContain(
      "case when net_profit > 0 then 'win' when net_profit < 0 then 'loss' else 'flat' end as outcome",
    );
    expect(intelligenceFunction).toMatch(
      /row_number\(\) over \(order by closed_at, position_id::numeric\)[\s\S]+row_number\(\) over \([\s\S]+partition by outcome[\s\S]+order by closed_at, position_id::numeric/,
    );
    expect(intelligenceFunction).toContain(
      "max(streak_length) filter (where outcome = 'win') as max_win_streak",
    );
    expect(intelligenceFunction).toContain(
      "max(streak_length) filter (where outcome = 'loss') as max_loss_streak",
    );
  });

  it('uses final-close UTC for the calendar and weekday dimensions', () => {
    expect(intelligenceFunction).toContain(
      "(closed_at at time zone 'utc')::date as trade_date",
    );
    expect(intelligenceFunction).toContain(
      "group by (closed_at at time zone 'utc')::date",
    );
    expect(intelligenceFunction).toContain(
      "extract(isodow from closed_at at time zone 'utc')::integer as weekday_number",
    );
    expect(intelligenceFunction).toContain("'calendarbasis', 'final_close_utc'");
    expect(intelligenceFunction).toContain("'weekdaybasis', 'final_close_utc'");
  });

  it('uses completed-position entry time for the fixed UTC session boundaries', () => {
    const sessionStart = intelligenceFunction.indexOf('session_rows as (');
    const sessionEnd = intelligenceFunction.indexOf('session_json as (', sessionStart);
    const sessions = intelligenceFunction.slice(sessionStart, sessionEnd);

    expect(sessionStart).toBeGreaterThanOrEqual(0);
    expect(sessions).toContain(
      "extract(hour from opened_at at time zone 'utc') < 8",
    );
    expect(sessions).toContain(
      "extract(hour from opened_at at time zone 'utc') < 13",
    );
    expect(sessions).toContain(
      "extract(hour from opened_at at time zone 'utc') < 21",
    );
    expect(intelligenceFunction).toContain("when 1 then 'asia'");
    expect(intelligenceFunction).toContain("when 2 then 'london'");
    expect(intelligenceFunction).toContain("when 3 then 'new-york'");
    expect(intelligenceFunction).toContain("else 'late-utc'");
    expect(intelligenceFunction).toContain("'sessionbasis', 'entry_time_utc_fixed_windows'");
    expect(sessions).not.toContain('closed_at at time zone');
  });

  it('returns bounded shaped breakdowns and explicit data-quality evidence', () => {
    for (const key of [
      'averagewin',
      'averageloss',
      'expectancy',
      'besttrade',
      'worsttrade',
      'maxwinstreak',
      'maxlossstreak',
      'symbols',
      'directions',
      'weekdays',
      'sessions',
      'partialclosesrolledintofinalclose',
      'incompletehistoryexcluded',
      'volumemismatchexcluded',
      'nettingreversalsexcluded',
      'mixedhistoricalcurrenciesdetected',
      'currencyevidencecomplete',
      'coveragestart',
      'equitycoveragestart',
      'equitycoveragecomplete',
      'reportcurrency',
    ]) {
      expect(intelligenceFunction).toContain(`'${key}'`);
    }
    expect(intelligenceFunction).toContain('trades as materialized');
    expect(intelligenceFunction).toContain('included_currency_evidence as (');
    expect(intelligenceFunction).toMatch(
      /included_currency_evidence as \([\s\S]+select deal\.currency[\s\S]+from trades[\s\S]+join public\.orion_closed_deals as deal[\s\S]+deal\.position_id = trades\.position_id/,
    );
    expect(intelligenceFunction).toContain('count(*) = count(currency) as evidence_complete');
    expect(intelligenceFunction).toContain('count(distinct currency) > 1 as mixed');
    expect(intelligenceFunction).toMatch(
      /case when count\(\*\) = count\(currency\) and count\(distinct currency\) = 1[\s\S]+then max\(currency\)[\s\S]+else null[\s\S]+end as report_currency/,
    );
    expect(intelligenceFunction).toContain('drawdown.coverage_start <= overview.coverage_start');
  });

  it('revokes browser and direct service-role access before granting only the shaped RPC', () => {
    expect(migration).toMatch(
      /revoke all on function public\.orion_closed_trade_rows\(uuid, uuid\)[\s\S]+from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.read_orion_performance_intelligence\(uuid, uuid, timestamptz, timestamptz\)[\s\S]+from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.set_orion_closed_deal_currency\(\)[\s\S]+from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.read_orion_performance_intelligence\(uuid, uuid, timestamptz, timestamptz\)[\s\S]+to service_role/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.orion_closed_trade_rows[\s\S]+to (?:anon|authenticated)/,
    );
  });
});
