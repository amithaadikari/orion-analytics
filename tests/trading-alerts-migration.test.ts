import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260807_trading_alerts_risk_center.sql'),
  'utf8',
).toLowerCase();

function functionBody(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf(`\n$$;`, start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('trading alerts and risk center migration', () => {
  it('creates private preferences, state, event, and durable run records', () => {
    for (const table of [
      'client_trading_alert_preferences',
      'client_trading_alert_states',
      'client_trading_alert_events',
      'client_trading_alert_runs',
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`);
    }
    expect(migration).toContain('client_trading_alert_preferences_scope_owner_fk');
    expect(migration).toContain('references public.orion_telemetry_account_scopes(id, client_id, license_id, platform)');
    expect(migration).toContain('client_trading_alert_states_current_event_owner_fk');
    expect(migration).toContain('references public.client_trading_alert_events(id, account_scope_id, client_id, license_id)');
    expect(migration).toContain('client_trading_alert_events_client_timeline_idx');
    expect(migration).toContain("job_name in ('trading-alert-evaluator')");
    expect(migration).toContain('events_deduplicated integer not null default 0');
    const recorder = functionBody('_record_orion_trading_alert_event');
    expect(recorder).toContain("licensed.plan = p_plan");
    expect(recorder).toContain("'trading_alert_entitlement_changed'");
    expect(recorder).not.toMatch(/for (?:update|share) of (?:scope|licensed|client|stream|installation)/);
  });

  it('matches the server-side table and RPC contract exactly', () => {
    for (const column of [
      'connection_health', 'final_close', 'trade_opened', 'partial_close',
      'daily_loss_enabled', 'daily_loss_limit', 'drawdown_enabled',
      'drawdown_percent', 'equity_floor_enabled', 'equity_floor', 'risk_currency',
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(migration).toContain("check (severity in ('info', 'warning', 'critical'))");
    expect(migration).not.toContain("'high', 'critical'");
    for (const column of [
      'status', 'started_at', 'completed_at', 'scopes_evaluated', 'deals_evaluated',
      'alerts_created', 'notifications_created', 'states_opened', 'states_resolved',
      'error_code',
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`));
    }

    const setterStart = migration.indexOf('create or replace function public.set_orion_trading_alert_preferences');
    const setterHeader = migration.slice(setterStart, migration.indexOf('returns jsonb', setterStart));
    const parameters = [...setterHeader.matchAll(/\b(p_[a-z_]+)\s+(?:uuid|boolean|numeric|text)\b/g)]
      .map((match) => match[1]);
    expect(parameters).toEqual([
      'p_client_id', 'p_account_scope_id', 'p_connection_health',
      'p_connection_health_changed', 'p_final_close', 'p_trade_opened', 'p_partial_close',
      'p_daily_loss_enabled', 'p_daily_loss_limit',
      'p_drawdown_enabled', 'p_drawdown_percent', 'p_equity_floor_enabled',
      'p_equity_floor', 'p_risk_currency',
    ]);
    expect(functionBody('set_orion_trading_alert_preferences')).toContain("'ok', true");
  });

  it('derives exact license-plan entitlements, blocks Basic activation, and preserves saved advanced settings', () => {
    const setter = functionBody('set_orion_trading_alert_preferences');
    expect(setter).toContain('from public.licenses as licensed');
    expect(setter).toContain("licensed.status = 'active'");
    expect(setter).toContain('licensed.revoked_at is null');
    expect(setter).toContain('licensed.expires_at >= v_now');
    expect(setter).toContain("v_advanced := v_license.plan in ('premium', 'lifetime')");
    expect(setter).toContain('from public.orion_telemetry_streams as stream');
    expect(setter).toContain('stream.binding_version = v_license.binding_version');
    expect(setter).toContain("stream.status = 'active'");
    expect(setter).toContain('join public.license_installations as installation');
    expect(setter).toContain("installation.status = 'active'");
    expect(setter).toContain('v_advanced and p_trade_opened');
    expect(setter).toContain('v_advanced and p_daily_loss_enabled');
    expect(setter).toContain('case when v_advanced then excluded.trade_opened else preference.trade_opened end');
    expect(setter).toContain('case when v_advanced then excluded.daily_loss_limit else preference.daily_loss_limit end');
    expect(setter).toContain('case when v_advanced then excluded.risk_currency else preference.risk_currency end');
    expect(setter).toContain("'trade_cursor'");
    expect(setter).toContain("'initializedby', 'preference_save'");
    expect(setter).toMatch(/order by deal\.deal_time_msc desc, deal\.deal_ticket::numeric desc[\s\S]+limit 1/);
    expect(setter).toContain('deal.received_at <= v_now');
    expect(setter).toContain('on conflict (account_scope_id, alert_type) do nothing');
    expect(setter).not.toContain('membership_tier');
    expect(setter).not.toContain('membership_status');
  });

  it('accepts preference changes only for the current active licensed installation stream', () => {
    const setter = functionBody('set_orion_trading_alert_preferences');
    expect(setter).toContain('from public.orion_telemetry_streams as stream');
    expect(setter).toContain('join public.license_installations as installation');
    expect(setter).toContain('stream.account_scope_id = v_scope.id');
    expect(setter).toContain('stream.binding_version = v_license.binding_version');
    expect(setter).toContain("stream.status = 'active'");
    expect(setter).toContain("installation.status = 'active'");
    expect(setter).toContain("message = 'trading_alert_connection_not_active'");
  });

  it('defaults connection monitoring only to the newest eligible scope without overriding client choices', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(migration).toContain('connection_health_explicit boolean not null default false');
    expect(evaluator).toMatch(/row_number\(\) over \([\s\S]+partition by scope\.license_id[\s\S]+scope\.last_seen_at desc/);
    expect(evaluator).toContain('eligible.newest_rank = 1');
    expect(evaluator).toContain('preference.connection_health_explicit = false');
    const setter = functionBody('set_orion_trading_alert_preferences');
    expect(setter).toContain('p_connection_health_changed boolean');
    expect(setter).toContain('p_connection_health, p_connection_health_changed, p_final_close');
    expect(setter).toContain('when p_connection_health_changed then excluded.connection_health');
    expect(setter).toContain('else preference.connection_health');
    expect(setter).toContain('connection_health_explicit = preference.connection_health_explicit or p_connection_health_changed');
  });

  it('initializes a durable maximum deal cursor and always advances it separately from telemetry ingestion', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(evaluator).toContain("'trade_cursor'");
    expect(evaluator).toContain("jsonb_build_object('historicaldealssuppressed', true)");
    expect(evaluator).toMatch(/order by deal\.deal_time_msc desc, deal\.deal_ticket::numeric desc[\s\S]+limit 1/);
    expect(evaluator).toContain('deal.received_at <= v_now');
    expect(evaluator).toContain('cursor_deal_time_msc = v_cursor_time');
    expect(evaluator).toContain('cursor_deal_ticket = v_cursor_ticket');
    expect(evaluator).toContain('v_deal.received_at <= v_cursor.cursor_initialized_at');
    expect(evaluator).toMatch(/v_cursor_ticket := v_deal\.deal_ticket::numeric;[\s\S]+?received_at <= v_cursor\.cursor_initialized_at[\s\S]+?continue;/);
    expect(evaluator).toContain('limit 500');
    expect(migration).not.toMatch(/create trigger[^;]+on public\.orion_(?:telemetry|account|open|closed)/);
  });

  it('processes canonical trade lifecycle events with immutable dedupe keys', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(evaluator).toContain("v_deal.entry = 'in'");
    expect(evaluator).toContain("v_deal.entry in ('out', 'outby')");
    expect(evaluator).toContain("prior.entry = 'inout'");
    expect(evaluator).toContain('v_remaining_volume := greatest(v_entry_volume - v_exit_volume, 0)');
    expect(evaluator).toContain('coalesce(sum(prior.net_profit), 0)');
    expect(evaluator).toContain('v_position_net_profit, null, v_scope.currency');
    expect(evaluator).toContain("case when v_position_net_profit < 0 then 'warning' else 'info' end");
    expect(evaluator).toContain("'trade-open:' || v_scope.id::text || ':' || v_deal.position_id");
    expect(evaluator).toContain("'trade-partial-close:' || v_scope.id::text || ':' || v_deal.deal_ticket");
    expect(evaluator).toContain("'trade-final-close:' || v_scope.id::text || ':' || v_deal.deal_ticket");
    expect(migration).toContain('dedupe_key text not null unique');
    expect(migration).toContain("'trading-alert:' || v_event_id::text");
  });

  it('evaluates stateful connection and fresh-snapshot risk rules with recovery hysteresis', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(evaluator).toContain('v_age_seconds <= 180');
    expect(evaluator).toContain('v_age_seconds <= 600');
    expect(evaluator).toContain('stream.last_captured_at');
    expect(evaluator).toContain('v_capture_age_seconds');
    expect(evaluator).toContain('v_capture_age_seconds > 180');
    expect(evaluator).toContain("'connection_delayed'");
    expect(evaluator).toContain("'connection_offline'");
    expect(evaluator).toContain("'daily_loss'");
    expect(evaluator).toContain("'drawdown'");
    expect(evaluator).toContain("'equity_floor'");
    expect(evaluator).toContain("date_trunc('day', v_now at time zone 'utc') at time zone 'utc'");
    expect(migration).toContain('orion_closed_deals_alert_daily_candidates_idx');
    expect(migration).toMatch(/orion_closed_deals_scope_position_timeline_idx[\s\S]+account_scope_id,[\s\S]+position_id,[\s\S]+deal_time_msc/);
    expect(evaluator).toContain('with today_candidates as');
    expect(evaluator).toContain("deal.entry in ('out', 'outby')");
    expect(evaluator).toContain('join public.orion_closed_deals as history');
    expect(evaluator).toContain('sum(history.net_profit) as net_profit');
    expect(evaluator).toContain('from public.orion_open_positions as position');
    expect(evaluator).toContain("'fully_closed_orion_positions'");
    expect(evaluator).toMatch(/'drawdown', 'critical'[\s\S]+?'balance_to_equity'\),[\s\S]+?false/);
    expect(evaluator).toMatch(/'equity_floor', 'critical'[\s\S]+?jsonb_build_object\('balance'[\s\S]+?false/);
    expect(evaluator).toContain('greatest(v_scope.drawdown_percent - 1, v_scope.drawdown_percent * 0.9)');
    expect(evaluator).toContain('v_scope.equity_floor * 1.02');
    expect(evaluator).toContain('v_scope.currency is null');
    expect(evaluator).toContain("'account_currency_changed'");
  });

  it('uses receipt time for connection health but capture time for financial freshness', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(evaluator).toContain('stream.last_seen_at');
    expect(evaluator).toContain('stream.last_captured_at');
    expect(evaluator).toContain('v_now - v_scope.last_seen_at');
    expect(evaluator).toContain('v_now - v_scope.last_captured_at');
    expect(evaluator).toContain('if v_capture_age_seconds is null or v_capture_age_seconds > 180 then');
  });

  it('serializes evaluators, records failures, and returns every stable result counter', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(evaluator).toContain('pg_try_advisory_xact_lock');
    expect(evaluator).toContain("'concurrent_evaluation'");
    const lockMiss = evaluator.slice(
      evaluator.indexOf('if not v_lock_acquired then'),
      evaluator.indexOf('end if;', evaluator.indexOf('if not v_lock_acquired then')),
    );
    expect(lockMiss).toContain('v_run_id := gen_random_uuid()');
    expect(lockMiss).not.toContain('insert into public.client_trading_alert_runs');
    expect(evaluator).toMatch(/insert into public\.client_trading_alert_runs[\s\S]+?'failed'[\s\S]+?sqlstate/);
    for (const field of [
      'scopesevaluated',
      'dealsevaluated',
      'alertscreated',
      'notificationscreated',
      'statesopened',
      'statesresolved',
      'eventsdeduplicated',
    ]) {
      expect(evaluator).toContain(`'${field}'`);
    }
  });

  it('never mutates telemetry, license, account, or client source records', () => {
    const evaluator = functionBody('evaluate_orion_trading_alerts');
    expect(evaluator).not.toMatch(/(?:insert into|update|delete from) public\.orion_(?:telemetry|account|open|closed)/);
    expect(evaluator).not.toMatch(/(?:insert into|update|delete from) public\.(?:licenses|clients|license_installations)/);
  });

  it('uses bounded plan-aware event cleanup and exposes only service-role entrypoints', () => {
    const cleanup = functionBody('cleanup_orion_trading_alerts');
    expect(cleanup).toContain("when 'basic' then interval '90 days'");
    expect(cleanup).toContain("when 'premium' then interval '365 days'");
    expect(cleanup).toContain("else interval '1825 days'");
    expect(cleanup).toContain('p_limit not between 1 and 5000');
    expect(cleanup).toContain('for update of event skip locked');
    expect(cleanup).toContain("run.completed_at < v_now - interval '90 days'");
    expect(migration).toContain('grant execute on function public.set_orion_trading_alert_preferences');
    expect(migration).toContain('grant execute on function public.evaluate_orion_trading_alerts() to service_role');
    expect(migration).not.toMatch(/grant execute on function public\._(?:record|open|resolve)_orion_trading_alert[^;]+to authenticated/);
  });
});
