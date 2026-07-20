import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260730_orion_pro_trading_accounts_and_license_v2.sql', 'utf8').toLowerCase();

describe('Orion Pro and license V2 migration', () => {
  it('keeps membership separate from EA plans', () => {
    expect(migration).toContain("membership_tier in ('standard', 'pro')");
    expect(migration).toContain('membership_expires_at');
  });

  it('enforces one active real account per client and identity', () => {
    expect(migration).toContain('trading_accounts_active_real_client_idx');
    expect(migration).toContain('trading_accounts_active_real_identity_idx');
    expect(migration).toContain("account_type = 'real' and status = 'active'");
  });

  it('preserves legacy licenses while adding V2 metadata and history', () => {
    expect(migration).toContain("default 'legacy'");
    expect(migration).toContain("when license_key like 'orn-%' then 'v2' else 'legacy'");
    expect(migration).toContain('create table if not exists public.trading_account_changes');
    expect(migration).toContain('trading_account_id uuid references public.client_trading_accounts');
  });
});
