import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260806_partial_close_execution_activity.sql'),
  'utf8',
).toLowerCase();

describe('partial-close execution activity migration', () => {
  it('adds one protected service-role read RPC without replacing the original migration', () => {
    expect(migration).toContain('create or replace function public.read_orion_trade_execution_activity(');
    expect(migration).toMatch(/p_client_id uuid,[\s\S]+p_account_scope_id uuid,[\s\S]+p_since timestamptz,[\s\S]+p_page_size integer[\s\S]+returns jsonb/);
    expect(migration).toContain('language plpgsql');
    expect(migration).toContain('stable');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public, pg_temp');
    expect(migration).not.toContain('create table');
    expect(migration).not.toContain('alter table');
  });

  it('adds timeline and newest-exit indexes for bounded candidate-first reads', () => {
    expect(migration).toMatch(/create index if not exists orion_closed_deals_scope_position_timeline_idx[\s\S]+account_scope_id,[\s\S]+position_id,[\s\S]+deal_time_msc,[\s\S]+deal_ticket\)::numeric/);
    expect(migration).toMatch(/create index if not exists orion_closed_deals_scope_exit_activity_idx[\s\S]+account_scope_id,[\s\S]+deal_time_msc desc,[\s\S]+deal_ticket\)::numeric\) desc[\s\S]+where entry in \('out', 'outby'\)/);
  });

  it('validates exact scope ownership and the bounded page size before reading deals', () => {
    const validation = migration.slice(0, migration.indexOf('with valid_candidates as ('));
    expect(validation).toContain('p_client_id is null');
    expect(validation).toContain('p_account_scope_id is null');
    expect(validation).toContain('p_page_size is null');
    expect(validation).toContain('p_page_size not between 1 and 100');
    expect(validation).toMatch(/from public\.orion_telemetry_account_scopes as scope[\s\S]+scope\.id = p_account_scope_id[\s\S]+scope\.client_id = p_client_id/);
    expect(validation).toContain("'items', '[]'::jsonb");
    expect(validation).toContain("'hasmore', false");
    expect(validation).toContain("'incompletehistoryexcluded', false");
  });

  it('drives from newest in-range exits and probes only each candidate timeline', () => {
    const candidatesStart = migration.indexOf('with valid_candidates as (');
    const pageStart = migration.indexOf('), page as (', candidatesStart);
    const candidates = migration.slice(candidatesStart, pageStart);

    expect(candidates).toContain('from public.orion_closed_deals as exit_deal');
    expect(candidates).toContain('cross join lateral (');
    expect(candidates).toContain('from public.orion_closed_deals as prior_deal');
    expect(candidates).toContain('prior_deal.account_scope_id = exit_deal.account_scope_id');
    expect(candidates).toContain('prior_deal.position_id = exit_deal.position_id');
    expect(candidates).toMatch(/prior_deal\.deal_time_msc, prior_deal\.deal_ticket::numeric\)[\s\S]+<= \(exit_deal\.deal_time_msc, exit_deal\.deal_ticket::numeric\)/);
    expect(candidates).toContain("exit_deal.entry in ('out', 'outby')");
    expect(candidates).toContain("exit_deal.position_id <> '0'");
    expect(candidates).toContain('p_since is null or exit_deal.deal_time >= p_since');
    expect(candidates).toMatch(/order by exit_deal\.deal_time_msc desc, exit_deal\.deal_ticket::numeric desc[\s\S]+limit p_page_size \+ 1/);
    expect(candidates).not.toContain(' over ');
    expect(candidates).not.toContain('window position_timeline');
    expect(candidates).not.toContain('rows between unbounded preceding');
  });

  it('classifies each valid exit from cumulative prior deals without current-position state', () => {
    expect(migration).toContain("array_agg(prior_deal.side order by prior_deal.deal_time_msc, prior_deal.deal_ticket::numeric)");
    expect(migration).toContain("filter (where prior_deal.entry = 'in')");
    expect(migration).toContain("sum(prior_deal.volume) filter (where prior_deal.entry = 'in')");
    expect(migration).toContain("sum(prior_deal.volume) filter (where prior_deal.entry in ('out', 'outby'))");
    expect(migration).toContain("lifecycle.original_side in ('buy', 'sell')");
    expect(migration).toContain('lifecycle.cumulative_entry_volume > 0');
    expect(migration).toContain('lifecycle.cumulative_exit_volume >= lifecycle.cumulative_entry_volume');
    expect(migration).toContain("then 'closed'");
    expect(migration).toContain("else 'partial'");
    expect(migration).toMatch(/greatest\([\s\S]+lifecycle\.cumulative_entry_volume - lifecycle\.cumulative_exit_volume,[\s\S]+0[\s\S]+\) as remaining_volume/);
    expect(migration).toContain('exit_deal.commission + exit_deal.fee as commission');
    expect(migration).toContain("reversal_deal.entry = 'inout'");
    expect(migration).not.toContain('orion_open_positions');
    expect(migration).not.toContain('group by');
    expect(migration).not.toContain('exit_side');
  });

  it('excludes missing entry history and returns durable data-quality evidence', () => {
    const evidenceStart = migration.indexOf('select exists (');
    const candidatesStart = migration.indexOf('with valid_candidates as (');
    const evidence = migration.slice(evidenceStart, candidatesStart);

    expect(migration).toContain('v_incomplete_history_excluded boolean := false');
    expect(evidence).toContain("exit_deal.entry in ('out', 'outby')");
    expect(evidence).toContain('p_since is null or exit_deal.deal_time >= p_since');
    expect(evidence).toContain("exit_deal.position_id = '0'");
    expect(evidence).toContain('or not exists (');
    expect(evidence).toContain("entry_deal.entry = 'in'");
    expect(evidence).toContain('entry_deal.volume > 0');
    expect(evidence).toMatch(/entry_deal\.deal_time_msc, entry_deal\.deal_ticket::numeric\)[\s\S]+<= \(exit_deal\.deal_time_msc, exit_deal\.deal_ticket::numeric\)/);
    expect(evidence).toContain('into v_incomplete_history_excluded');
    expect(migration).toContain("'incompletehistoryexcluded', v_incomplete_history_excluded");
  });

  it('returns the exact execution shape in deterministic newest-first order', () => {
    for (const key of [
      'id', 'positionid', 'ticket', 'symbol', 'side', 'volume', 'executedat',
      'exitprice', 'profit', 'swap', 'commission', 'netprofit',
      'remainingvolume', 'status',
    ]) expect(migration).toContain(`'${key}'`);

    expect(migration).toContain("'id', page.deal_ticket");
    expect(migration).toContain("'side', page.original_side");
    expect(migration).toContain("'status', page.execution_status");
    expect(migration).toMatch(/order by exit_deal\.deal_time_msc desc, exit_deal\.deal_ticket::numeric desc[\s\S]+limit p_page_size \+ 1/);
    expect(migration).toMatch(/order by candidate\.deal_time_msc desc, candidate\.deal_ticket::numeric desc[\s\S]+limit p_page_size/);
    expect(migration).toContain('(select count(*) > p_page_size from valid_candidates)');
    expect(migration).toContain("'items', v_items");
    expect(migration).toContain("'hasmore', v_has_more");
    expect(migration).toContain("'incompletehistoryexcluded', v_incomplete_history_excluded");
  });

  it('revokes all callers before granting only service-role execution', () => {
    expect(migration).toMatch(/revoke all on function public\.read_orion_trade_execution_activity\(uuid, uuid, timestamptz, integer\)[\s\S]+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant execute on function public\.read_orion_trade_execution_activity\(uuid, uuid, timestamptz, integer\)[\s\S]+to service_role/);
  });
});
