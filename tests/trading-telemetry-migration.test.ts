import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260804_live_trading_telemetry.sql'),
  'utf8',
).toLowerCase();

describe('live trading telemetry migration', () => {
  it('uses stable account scopes with immutable exact registered identities', () => {
    expect(migration).toContain('create table if not exists public.orion_telemetry_account_scopes');
    expect(migration).toMatch(/orion_telemetry_account_scopes[\s\S]+account_number text not null[\s\S]+broker_server text not null/);
    expect(migration).toContain('orion_telemetry_scopes_real_owner_fk');
    expect(migration).toContain('orion_telemetry_scopes_demo_owner_fk');
    expect(migration).toContain('orion_telemetry_scopes_real_unique_idx');
    expect(migration).toContain('orion_telemetry_scopes_demo_unique_idx');
    expect(migration).toContain('enforce_orion_telemetry_scope_identity');
    expect(migration).toContain('telemetry_scope_identity_immutable');
  });

  it('stores efficient heartbeat and latest-account read fields on streams', () => {
    const streamTable = migration.match(/create table if not exists public\.orion_telemetry_streams \([\s\S]+?\n\);/)?.[0] || '';
    for (const column of [
      'last_sequence bigint', 'last_seen_at timestamptz', 'terminal_connected boolean',
      'terminal_trade_allowed boolean', 'mql_trade_allowed boolean', 'currency text',
      'balance numeric', 'equity numeric', 'margin numeric', 'margin_level numeric',
      'floating_profit numeric', 'open_position_count integer',
    ]) expect(streamTable).toContain(column);
    expect(migration).toContain('supersede_orion_telemetry_streams');
  });

  it('keeps idempotency and broker tickets stable across device streams', () => {
    expect(migration).toContain('request_id text primary key');
    expect(migration).toContain('orion_telemetry_batches_stream_sequence_unique');
    expect(migration).toContain('orion_telemetry_batches_scope_snapshot_unique');
    expect(migration).toContain('primary key (account_scope_id, position_ticket)');
    expect(migration).toContain('orion_closed_deals_scope_ticket_unique unique (account_scope_id, deal_ticket)');
    expect(migration).toContain("'request_id_conflict'");
    expect(migration).toContain("'stale_sequence'");
    expect(migration).toContain("'deal_conflict'");
  });

  it('validates and writes the whole batch in one locked security-definer RPC', () => {
    const start = migration.indexOf('create or replace function public.ingest_orion_trading_telemetry');
    const end = migration.indexOf('create or replace function public.read_orion_trading_equity', start);
    const rpc = migration.slice(start, end);
    expect(rpc).toContain('security definer');
    expect(rpc).toContain('pg_advisory_xact_lock');
    expect(rpc).toContain('validate_orion_license_runtime');
    expect(rpc).toContain('for update');
    expect(rpc).toContain('v_license.binding_version <> p_binding_version');
    expect(rpc).toContain('insert into public.orion_telemetry_batches');
    expect(rpc).toContain('insert into public.orion_account_snapshots');
    expect(rpc).toContain('insert into public.orion_open_positions');
    expect(rpc).toContain('delete from public.orion_open_positions');
    expect(rpc).toContain('insert into public.orion_closed_deals');
    expect(rpc).not.toMatch(/p_client_id|p_license_id|p_plan/);
  });

  it('computes drawdown from the complete filtered equity series before sampling', () => {
    const start = migration.indexOf('create or replace function public.read_orion_trading_equity');
    const end = migration.indexOf('create or replace function public.orion_closed_trade_rows', start);
    const equity = migration.slice(start, end);
    const seriesStart = equity.indexOf('with series as (');
    const series = equity.slice(seriesStart);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(equity).toContain('security definer');
    expect(equity).toContain('set search_path = public, pg_temp');
    expect(equity).toContain('and client_id = p_client_id');
    expect(equity).toContain('or p_max_points is null');
    expect(equity).toContain('ntile(least(p_max_points::bigint, v_count)::integer)');
    expect(seriesStart).toBeGreaterThan(equity.indexOf('from sampled;'));
    expect(series).toContain('from public.orion_account_snapshots');
    expect(series).toContain('max(equity) over (');
    expect(series).toContain('rows between unbounded preceding and current row');
    expect(series).not.toContain('from sampled');
  });

  it('aggregates ordinary partial closes once the position is fully closed', () => {
    const start = migration.indexOf('create or replace function public.orion_closed_trade_rows');
    const end = migration.indexOf('create or replace function public.read_orion_trading_performance', start);
    const trades = migration.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(trades).toContain('security definer');
    expect(trades).toContain('set search_path = public, pg_temp');
    expect(trades).toContain('and scope.client_id = p_client_id');
    expect(trades).toContain("sum(deal.volume) filter (where deal.entry in ('out', 'outby', 'inout')) as volume");
    expect(trades).toMatch(/sum\(deal\.price \* deal\.volume\) filter \(where deal\.entry in \('in', 'inout'\)\)[\s\S]+?nullif\(sum\(deal\.volume\) filter \(where deal\.entry in \('in', 'inout'\)\), 0\) as entry_price/);
    expect(trades).toMatch(/sum\(deal\.price \* deal\.volume\) filter \(where deal\.entry in \('out', 'outby', 'inout'\)\)[\s\S]+?nullif\(sum\(deal\.volume\) filter \(where deal\.entry in \('out', 'outby', 'inout'\)\), 0\) as exit_price/);
    expect(trades).toContain('sum(deal.profit) as profit');
    expect(trades).toContain('sum(deal.swap) as swap');
    expect(trades).toContain('sum(deal.commission + deal.fee) as commission');
    expect(trades).toContain('sum(deal.net_profit) as net_profit');
    expect(trades).toContain("bool_or(deal.entry = 'inout') as has_netting_reversal");
    expect(trades).toContain('and not grouped.has_netting_reversal');
    expect(trades).toMatch(/not exists \([\s\S]+?from public\.orion_open_positions[\s\S]+?position\.position_id = grouped\.position_id/);
  });

  it('uses deterministic descending keyset pagination for closed trades', () => {
    const start = migration.indexOf('create or replace function public.read_orion_trading_performance');
    const end = migration.indexOf('create or replace function public.cleanup_orion_trading_telemetry', start);
    const performance = migration.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(performance).toContain('security definer');
    expect(performance).toContain('set search_path = public, pg_temp');
    expect(performance).toContain('or p_page_size is null');
    expect(performance).toContain('or ((p_cursor_closed_at is null) <> (p_cursor_position_id is null))');
    expect(performance).toMatch(/from public\.orion_closed_trade_rows\(p_client_id, p_account_scope_id\) as trade\s+where p_since is null or trade\.closed_at >= p_since/);
    expect(performance).toContain('or (trade.closed_at, trade.position_id) < (p_cursor_closed_at, p_cursor_position_id)');
    expect(performance).toContain('order by trade.closed_at desc, trade.position_id desc');
    expect(performance).toContain('limit p_page_size + 1');
    expect(performance).toContain('(select count(*) > p_page_size from candidates)');
    expect(performance).toContain('order by closed_at desc, position_id desc');
    expect(performance).toContain("and deal.entry = 'inout'");
    expect(performance).toContain("'nettingreversalsexcluded', v_netting_reversals_excluded");
  });

  it('uses durable private rate limits and safe hashed rejection records', () => {
    expect(migration).toContain('create table if not exists public.orion_telemetry_rate_limits');
    expect(migration).toContain('consume_orion_telemetry_rate_limit');
    const rejectionTable = migration.match(/create table if not exists public\.orion_telemetry_rejections \([\s\S]+?\n\);/)?.[0] || '';
    expect(rejectionTable).toContain('request_ip_hash text not null');
    expect(rejectionTable).toContain('key_hash text not null');
    expect(rejectionTable).toContain('installation_hash text not null');
    expect(rejectionTable).not.toContain('account_number');
    expect(rejectionTable).not.toMatch(/payload\s+(?:jsonb|text)/);
    expect(migration).toContain("'telemetry_rate_limit'");
  });

  it('drains every stale retention class in bounded batches', () => {
    const start = migration.indexOf('create or replace function public.cleanup_orion_trading_telemetry');
    const end = migration.indexOf('revoke all on function public.enforce_orion_telemetry_scope_identity', start);
    const cleanup = migration.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(cleanup.match(/\n  loop\n/g)).toHaveLength(6);
    expect(cleanup.match(/limit 5000/g)).toHaveLength(6);
    expect(cleanup.match(/exit when v_deleted < 5000;/g)).toHaveLength(6);
    expect(cleanup).toContain('v_snapshots := v_snapshots + v_deleted');
    expect(cleanup).toContain('v_batches := v_batches + v_deleted');
  });

  it('enables RLS, removes browser writes, and exposes only shaped server access', () => {
    for (const table of [
      'orion_telemetry_account_scopes', 'orion_telemetry_streams', 'orion_telemetry_batches',
      'orion_account_snapshots', 'orion_open_positions', 'orion_closed_deals',
      'orion_telemetry_rate_limits', 'orion_telemetry_rejections',
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`);
    }
    expect(migration).toMatch(/grant execute on function public\.ingest_orion_trading_telemetry[\s\S]+to service_role/);
    expect(migration).toContain('revoke all on function public.orion_closed_trade_rows(uuid, uuid) from public, anon, authenticated, service_role');
    expect(migration).toContain('grant execute on function public.read_orion_trading_equity(uuid, uuid, timestamptz, integer) to service_role');
    expect(migration).toContain('grant execute on function public.read_orion_trading_performance(uuid, uuid, timestamptz, timestamptz, text, integer) to service_role');
    expect(migration).toContain('cleanup_orion_trading_telemetry');
    expect(migration).toContain("interval '30 days'");
  });
});
