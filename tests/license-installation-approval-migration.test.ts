import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260802_pending_installation_approvals.sql', 'utf8').toLowerCase();

describe('pending installation approval migration', () => {
  it('adds a ten-minute, one-request lifecycle without changing the active seat table', () => {
    expect(migration).toContain('create table if not exists public.license_installation_requests');
    expect(migration).toContain("status in ('pending', 'approved', 'rejected', 'expired', 'superseded')");
    expect(migration).toContain("expires_at <= requested_at + interval '10 minutes'");
    expect(migration).toMatch(/license_installation_requests_pending_license_idx[\s\S]{0,180}where status = 'pending'/);
    expect(migration).toMatch(/license_installation_requests_pending_installation_idx[\s\S]{0,180}where status = 'pending'/);
    expect(migration).not.toContain('alter table public.license_installations add');
  });

  it('stores only hashed installation and polling authority behind service-role reads', () => {
    expect(migration).toContain("installation_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("poll_proof_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("request_ip_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).not.toMatch(/\binstallation_id\s+text/);
    expect(migration).not.toMatch(/\bpoll_proof\s+text/);
    expect(migration).not.toMatch(/\brequest_ip\s+text/);
    expect(migration).toContain('alter table public.license_installation_requests enable row level security');
    expect(migration).toContain('alter table public.license_installation_request_rate_limits enable row level security');
    expect(migration).toContain('revoke all on table public.license_installation_requests from public, anon, authenticated');
    expect(migration).toContain('revoke all on table public.license_installation_request_rate_limits from public, anon, authenticated, service_role');
    expect(migration).toContain('revoke insert, update, delete, truncate, references, trigger');
    expect(migration).toContain('grant select on table public.license_installation_requests to service_role');
  });

  it('requires the exact account identity before creating a request', () => {
    expect(migration).toContain("'code', 'account_not_registered'");
    expect(migration).toContain("'code', 'account_mismatch'");
    expect(migration).toContain("'code', 'demo_account_not_registered'");
    expect(migration).toContain("'code', 'demo_account_mismatch'");
    expect(migration).toMatch(/request_license_installation_approval[\s\S]+client_trading_accounts[\s\S]+license_demo_accounts/);
    expect(migration).toContain('binding_version_at_request');
  });

  it('uses persistent request limits, locks, expiry, and non-enumerating polling', () => {
    expect(migration).toContain('create table if not exists public.license_installation_request_rate_limits');
    expect(migration).toContain('consume_license_installation_request_limit');
    expect(migration).toContain('cleanup_license_installation_approval_state');
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain("updated_at < v_now - interval '24 hours'");
    expect(migration).toContain("consume_license_installation_request_limit('ip', v_request_ip_hash, 30)");
    expect(migration).toContain("consume_license_installation_request_limit('license', v_key_hash, 12)");
    expect(migration).toContain("consume_license_installation_request_limit('installation', v_installation_hash, 12)");
    expect(migration).toContain("requested_at > v_now - interval '15 minutes'");
    expect(migration).toContain('v_recent_license_requests >= 5');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('for update');
    expect(migration).toContain("'code', 'invalid_pairing_request'");
    expect(migration).toContain('poll_license_installation_approval');
  });

  it('approves atomically through the existing authoritative activation policy', () => {
    expect(migration).toContain('select public.activate_license_installation_client(');
    expect(migration).toContain('resolve_license_installation_approval_client');
    expect(migration).toContain("target_license.binding_version <> target_request.binding_version_at_request");
    expect(migration).toContain('settle_license_installation_requests');
    expect(migration).toContain("another installation was activated");
    expect(migration).toContain('(license_id = new.license_id or installation_hash = new.installation_hash)');
    expect(migration).toContain('settle_license_installation_change_requests');
    expect(migration).toContain("new.change_kind = 'reset'");
    expect(migration).toContain('supersede_stale_license_installation_requests');
    expect(migration).toContain('or exists (select 1 from public.license_installation_requests where license_id = old.id)');
  });

  it('exposes only the exact request RPCs to the service role', () => {
    const signatures = [
      'cleanup_license_installation_approval_state()',
      'request_license_installation_approval(text, text, text, text, text, text, text, text, text, text, text)',
      'poll_license_installation_approval(uuid, text)',
      'resolve_license_installation_approval_client(uuid, uuid, text)',
    ];
    for (const signature of signatures) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(migration).toContain(`grant execute on function public.${signature} to service_role`);
    }
  });

  it('keeps the six-digit match code display-only and clears it at resolution', () => {
    expect(migration).toContain("match_code is null or match_code ~ '^[0-9]{6}$'");
    expect(migration).toMatch(/status = 'pending'[\s\S]{0,120}match_code is not null[\s\S]{0,80}match_code ~ '\^\[0-9\]\{6\}\$'/);
    expect(migration.match(/match_code = null/g)?.length).toBeGreaterThanOrEqual(8);
    expect(migration).not.toMatch(/resolve_license_installation_approval_client\([\s\S]{0,180}p_match_code/);
  });

  it('keeps retry authority immutable and serializes approval with manual activation', () => {
    expect(migration).not.toContain('set installation_hint = v_installation_hint');
    expect(migration).not.toContain('request_ip_hash = v_request_ip_hash');
    expect(migration).toContain("'installation-request:' || p_request_id::text");
    expect(migration).toContain("'installation-id:' || v_installation_hash");
    expect(migration).toMatch(/all request-row work[\s\S]{0,400}pg_advisory_xact_lock[\s\S]{0,250}update public\.license_installation_requests/);
    expect(migration).toMatch(/where installation_hash = v_installation_hash[\s\S]{0,180}and expires_at <= v_now/);
    expect(migration).toMatch(/settle_license_installation_requests\(\)[\s\S]+and expires_at <= v_now[\s\S]+and expires_at > v_now/);
  });
});
