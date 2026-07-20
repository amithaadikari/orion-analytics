import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260728_admin_account_security.sql', 'utf8');
const client360 = readFileSync('app/api/client-360/[clientId]/route.ts', 'utf8');
const retentionJob = readFileSync('scripts/visitor-deletion.ts', 'utf8');

describe('administrator account security migration', () => {
  it('makes administrator activity server-only and removes direct client security reads', () => {
    expect(migration).toContain('revoke all on table public.client_security_events from public, anon, authenticated');
    expect(migration).toContain('revoke all on table public.admin_account_events from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.record_admin_account_event_atomic');
    expect(migration).toContain('to service_role');
    expect(migration).not.toMatch(/\bip_address\b/i);
    expect(migration).not.toMatch(/\buser_agent\b/i);
  });

  it('validates administrator ownership inside the atomic event function', () => {
    expect(migration).toMatch(/where id = p_admin_id\s+and user_id = p_auth_user_id/);
    expect(migration).toContain("raise exception 'Administrator ownership mismatch'");
    expect(migration).toContain('public.has_sufficient_auth_aal()');
    expect(migration).toContain('admin_account_events_session_security_event_idx');
  });

  it('keeps Client 360 security responses on an explicit safe-column contract', () => {
    expect(client360).toContain(".select('id,event_type,title,browser,os,device,country,created_at')");
    expect(client360).not.toMatch(/client_security_events[\s\S]{0,220}\.select\([^)]*session_id/);
    expect(client360).not.toMatch(/client_security_events[\s\S]{0,220}\.select\([^)]*ip_hash/);
    expect(client360).toContain('Promise.allSettled');
  });

  it('connects the stated 180-day administrator activity retention to the protected cleanup job', () => {
    expect(retentionJob).toContain("supabase.rpc('purge_admin_account_events', { p_retain_days: 180 })");
    expect(retentionJob).toContain('isMissingAdminAccountRelation');
  });
});
