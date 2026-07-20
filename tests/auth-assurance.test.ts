import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getAuthAssurance, hasVerifiedMfaFactor } from '@/lib/auth-assurance';

function userWithFactor(status?: 'verified' | 'unverified') {
  return {
    id: 'user-1',
    factors: status ? [{ id: 'factor-1', factor_type: 'totp', status }] : [],
  } as unknown as User;
}

function authClient(level: 'aal1' | 'aal2' | null, error = false) {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue(error
        ? { data: null, error: new Error('claim failure') }
        : { data: { claims: { aal: level } }, error: null }),
    },
  } as unknown as Pick<SupabaseClient, 'auth'>;
}

describe('authenticator assurance', () => {
  it('allows ordinary AAL1 access when the user has no verified factor', async () => {
    const client = authClient(null);
    await expect(getAuthAssurance(client, userWithFactor())).resolves.toEqual({
      currentLevel: 'aal1',
      hasVerifiedFactor: false,
      requiresChallenge: false,
    });
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });

  it('requires AAL2 for a verified factor and passes a verified AAL2 claim', async () => {
    expect(hasVerifiedMfaFactor(userWithFactor('unverified'))).toBe(false);
    expect(hasVerifiedMfaFactor(userWithFactor('verified'))).toBe(true);
    await expect(getAuthAssurance(authClient('aal1'), userWithFactor('verified'))).resolves.toMatchObject({ requiresChallenge: true });
    await expect(getAuthAssurance(authClient('aal2'), userWithFactor('verified'))).resolves.toMatchObject({ currentLevel: 'aal2', requiresChallenge: false });
  });

  it('does not enforce unsupported factor types that the Orion challenge cannot verify', async () => {
    const phoneUser = { id: 'user-1', factors: [{ id: 'phone-1', factor_type: 'phone', status: 'verified' }] } as unknown as User;
    expect(hasVerifiedMfaFactor(phoneUser)).toBe(false);
    await expect(getAuthAssurance(authClient('aal1'), phoneUser)).resolves.toMatchObject({ requiresChallenge: false });
  });

  it('fails closed when claims cannot be verified for an enrolled account', async () => {
    await expect(getAuthAssurance(authClient(null, true), userWithFactor('verified'))).resolves.toEqual({
      currentLevel: null,
      hasVerifiedFactor: true,
      requiresChallenge: true,
    });
  });
});
