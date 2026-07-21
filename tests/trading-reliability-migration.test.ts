import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260805_trading_reliability_center.sql'),
  'utf8',
).toLowerCase();

describe('trading reliability migration', () => {
  it('creates private incident and scheduled-job evidence with acknowledgements', () => {
    expect(migration).toContain('create table if not exists public.trading_reliability_incidents');
    expect(migration).toContain('create table if not exists public.trading_reliability_runs');
    expect(migration).toContain('acknowledged_at timestamptz');
    expect(migration).toContain('acknowledged_by uuid references public.admins(id) on delete set null');
    expect(migration).toContain("job_name in ('reliability-evaluator', 'telemetry-retention')");
    expect(migration).toMatch(/create unique index[\s\S]+trading_reliability_incidents\(dedupe_key\)[\s\S]+where status = 'open'/);
  });

  it('evaluates all three bounded incident classes and resolves recovered keys', () => {
    const start = migration.indexOf('create or replace function public.evaluate_orion_trading_reliability');
    const end = migration.indexOf('revoke all on function public.evaluate_orion_trading_reliability', start);
    const evaluator = migration.slice(start, end);
    expect(evaluator).toContain('pg_try_advisory_xact_lock');
    expect(evaluator).toContain("interval '10 minutes'");
    expect(evaluator).toContain("'offline_with_open_positions'");
    expect(evaluator).toContain("'offline_stream'");
    expect(evaluator).toContain("interval '15 minutes'");
    expect(evaluator).toContain('if v_rejections >= 25');
    expect(evaluator).toContain("'rejection_spike'");
    expect(evaluator).toMatch(/set status = 'resolved',[\s\S]+resolved_at = v_now,[\s\S]+recoveredat/);
    expect(evaluator).toMatch(/insert into public\.trading_reliability_runs[\s\S]+?'failed'[\s\S]+?sqlstate/);
    expect(evaluator).toContain("stream.binding_version = license.binding_version");
  });

  it('never mutates trading, account, position, deal, license, or client source records', () => {
    const start = migration.indexOf('create or replace function public.evaluate_orion_trading_reliability');
    const end = migration.indexOf('revoke all on function public.evaluate_orion_trading_reliability', start);
    const evaluator = migration.slice(start, end);
    expect(evaluator).not.toMatch(/(?:insert into|update|delete from) public\.orion_(?:telemetry|account|open|closed)/);
    expect(evaluator).not.toMatch(/(?:insert into|update|delete from) public\.(?:licenses|clients|license_installations)/);
  });

  it('keeps browser roles out and exposes only the evaluator to service role', () => {
    for (const table of ['trading_reliability_incidents', 'trading_reliability_runs']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`);
    }
    expect(migration).toContain('revoke all on function public.evaluate_orion_trading_reliability() from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.evaluate_orion_trading_reliability() to service_role');
    expect(migration).not.toMatch(/grant (?:select|insert|update|delete|execute)[\s\S]+ to authenticated/);
  });
});
