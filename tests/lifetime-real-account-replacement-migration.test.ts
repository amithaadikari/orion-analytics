import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260803_lifetime_real_account_replacement.sql', 'utf8').toLowerCase();

describe('Lifetime-only real-account replacement migration', () => {
  it('keeps the mutation lock order and exact request replay ahead of the plan gate', () => {
    const advisoryLock = migration.indexOf('pg_advisory_xact_lock');
    const clientRowLock = migration.indexOf('for update');
    const replay = migration.indexOf('where request_id = p_request_id');
    const sameIdentity = migration.indexOf('current_account.account_number');
    const planGate = migration.indexOf('real_account_change_requires_lifetime');
    expect(advisoryLock).toBeGreaterThan(-1);
    expect(advisoryLock).toBeLessThan(clientRowLock);
    expect(replay).toBeLessThan(planGate);
    expect(sameIdentity).toBeLessThan(planGate);
  });

  it('counts only a previously verified Real identity and requires Lifetime afterward', () => {
    expect(migration).toContain("account_type = 'real'");
    expect(migration).toContain('verified_at is not null');
    expect(migration).toContain("target_client.plan is distinct from 'lifetime'");
    expect(migration).toContain("message = 'real_account_change_requires_lifetime'");
  });

  it('changes only the client entry point and preserves service-role-only execution', () => {
    expect(migration).toContain('create or replace function public.change_registered_real_account_client');
    expect(migration).not.toContain('create or replace function public.change_registered_real_account_admin');
    expect(migration).not.toContain('create or replace function public._replace_registered_real_account');
    expect(migration).toMatch(/revoke all on function public\.change_registered_real_account_client[\s\S]+from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.change_registered_real_account_client[\s\S]+to service_role/);
  });
});
