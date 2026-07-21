import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260801_demo_license_installation_seats.sql', 'utf8').toLowerCase();

describe('Demo license and installation-seat migration', () => {
  it('creates every protected table before functions resolve its row type', () => {
    const lastTable = Math.max(
      migration.indexOf('create table if not exists public.license_demo_accounts'),
      migration.indexOf('create table if not exists public.license_demo_account_changes'),
      migration.indexOf('create table if not exists public.license_installations'),
      migration.indexOf('create table if not exists public.license_installation_changes'),
    );
    const firstFunction = migration.indexOf('create or replace function public.enforce_license_runtime_binding_reset');
    expect(lastTable).toBeGreaterThan(0);
    expect(firstFunction).toBeGreaterThan(lastTable);
    expect(migration.indexOf('create or replace function public.validate_orion_license_runtime')).toBeGreaterThan(firstFunction);
  });

  it('stores only hashed installation authority and enforces one active seat per license', () => {
    expect(migration).toContain("installation_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('constraint license_installations_hash_unique unique (installation_hash)');
    expect(migration).toContain('license_installations_active_license_idx');
    expect(migration).toMatch(/license_installations_active_license_idx[\s\S]{0,180}where status = 'active'/);
    expect(migration).not.toMatch(/\binstallation_(id|token|secret)\s+text\s+not null/);
    expect(migration).not.toContain('raw_installation');
  });

  it('enforces authoritative Demo and installation replacement policies atomically', () => {
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain('demo_account_change_cooldown:');
    expect(migration).toContain('pro_demo_change_rate_limit:');
    expect(migration).toContain('installation_change_rate_limit:');
    expect(migration).toContain('for update');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('license_demo_changes_request_unique');
    expect(migration).toContain('license_installation_changes_request_unique');
    expect(migration.match(/set binding_version = binding_version \+ 1/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('requires installation plus the exact Real or per-license Demo identity', () => {
    expect(migration).toContain("'code', 'installation_not_registered'");
    expect(migration).toContain("'code', 'installation_mismatch'");
    expect(migration).toContain("'code', 'account_not_registered'");
    expect(migration).toContain("'code', 'account_mismatch'");
    expect(migration).toContain("'code', 'demo_account_not_registered'");
    expect(migration).toContain("'code', 'demo_account_mismatch'");
    expect(migration).toContain("'accounttype', v_account_type");
    expect(migration).toMatch(/select \* into installation_record[\s\S]+if v_account_type = 'real'/);
  });

  it('keeps runtime audit evidence and blocks unsafe license owner or platform moves', () => {
    expect(migration.match(/on delete no action/g)?.length).toBeGreaterThanOrEqual(8);
    expect(migration).toContain('enforce_license_runtime_binding_reset');
    expect(migration).toContain('before update of client_id, platform on public.licenses');
    expect(migration).toContain('license_runtime_binding_reset_required');
  });

  it('exposes only exact service-role RPCs and disables the legacy validator bypass', () => {
    const signatures = [
      'set_license_demo_account_client(uuid, uuid, uuid, text, text)',
      'activate_license_installation_client(uuid, uuid, uuid, text, text, text)',
      'reset_license_installation_admin(uuid, uuid, uuid, uuid, text)',
      'validate_orion_license_runtime(text, text, text, text, text, text)',
    ];
    for (const signature of signatures) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(migration).toContain(`grant execute on function public.${signature} to service_role`);
    }
    expect(migration).toContain('revoke execute on function public.validate_orion_license_binding(text, text, text, text) from service_role');
    expect(migration).toContain('revoke insert, update, delete, truncate, references, trigger');
  });
});
