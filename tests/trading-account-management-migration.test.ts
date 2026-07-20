import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260731_trading_account_self_service.sql', 'utf8').toLowerCase();

describe('trading-account self-service migration', () => {
  it('queues legacy values for verification instead of activating guessed identities', () => {
    expect(migration).toContain('legacy_trading_account_backfill_queue');
    expect(migration).toContain("resolution_status text not null default 'pending'");
    expect(migration).not.toMatch(/insert into public\.client_trading_accounts[\s\S]{0,500}from public\.licenses/);
  });

  it('reserves normalized real identities and enforces same-client ownership', () => {
    expect(migration).toContain('trading_accounts_active_real_identity_normalized_idx');
    expect(migration).toContain('enforce_trading_account_identity_owner');
    expect(migration).toContain('lower(btrim(broker_server))');
    expect(migration).toContain('licenses_trading_account_owner_fk');
    expect(migration).toContain('trading_account_changes_new_owner_fk');
    expect(migration).toContain('license_account_platform_mismatch');
    expect(migration).toContain('deferrable initially deferred');
    expect(migration).toContain('client_trading_accounts_active_real_verified_check');
  });

  it('uses row locking, idempotent request ids, and database-derived membership', () => {
    expect(migration).toContain('for update');
    expect(migration).toContain('trading_account_changes_request_idx');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("target_client.membership_tier = 'pro'");
    expect(migration).toContain("target_client.membership_status = 'active'");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain('v_pro_change_count >= 2');
  });

  it('requires audited admin overrides and atomically rebinds licenses', () => {
    expect(migration).toContain('admin_override_reason_required');
    expect(migration).toContain('char_length(btrim(override_reason)) >= 10');
    expect(migration).toContain('binding_version = binding_version + 1');
    expect(migration).toContain('insert into public.trading_account_changes');
    expect(migration).toContain('insert into public.client_activity');
    expect(migration).toContain('insert into public.client_notifications');
  });

  it('snapshots payment identity before mutable license bindings can change', () => {
    expect(migration).toContain('account_number_snapshot');
    expect(migration).toContain('account_snapshot_captured_at');
    expect(migration).toContain('capture_payment_license_identity');
  });

  it('exposes only service-role account changes, membership writes, and validation', () => {
    expect(migration).toContain('change_registered_real_account_client');
    expect(migration).toContain('change_registered_real_account_admin');
    expect(migration).toContain('set_client_membership_admin');
    expect(migration).toContain('validate_orion_license_binding');
    expect(migration).toMatch(/revoke all on function public\.change_registered_real_account_client[\s\S]+from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.validate_orion_license_binding[\s\S]+to service_role/);
  });
});
