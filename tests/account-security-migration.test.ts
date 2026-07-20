import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260727_client_account_security.sql', 'utf8');

describe('account security migration', () => {
  it('requires AAL2 only for users who enrolled a verified factor', () => {
    expect(migration).toContain('from auth.mfa_factors');
    expect(migration).toContain("factor.status = 'verified'");
    expect(migration).toContain("auth.jwt() ->> 'aal'");
    expect(migration).toContain('public.has_sufficient_auth_aal()');
    expect(migration).toMatch(/clients_self_read[\s\S]*has_sufficient_auth_aal/);
    expect(migration).toMatch(/admins_self_read[\s\S]*has_sufficient_auth_aal/);
  });

  it('keeps security events server-written and excludes raw network identifiers', () => {
    expect(migration).toContain('client_security_events');
    expect(migration).not.toMatch(/\bip_address\b/i);
    expect(migration).not.toMatch(/\buser_agent\b/i);
    expect(migration).toContain('There are deliberately no authenticated INSERT/UPDATE/DELETE policies');
    expect(migration).toContain('email_license_reminders boolean not null default true');
  });
});
