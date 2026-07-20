import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AuthAssurance = {
  currentLevel: 'aal1' | 'aal2' | null;
  hasVerifiedFactor: boolean;
  requiresChallenge: boolean;
};

export function hasVerifiedMfaFactor(user: User | null | undefined) {
  return Boolean(user?.factors?.some((factor) => factor.factor_type === 'totp' && factor.status === 'verified'));
}

/**
 * A verified factor makes AAL2 mandatory. Claim verification is intentionally
 * fail-closed in that case so a temporary claim error cannot bypass MFA.
 */
export async function getAuthAssurance(
  supabase: Pick<SupabaseClient, 'auth'>,
  user: User | null | undefined,
): Promise<AuthAssurance> {
  const hasVerifiedFactor = hasVerifiedMfaFactor(user);
  if (!hasVerifiedFactor) {
    return { currentLevel: 'aal1', hasVerifiedFactor: false, requiresChallenge: false };
  }

  const { data, error } = await supabase.auth.getClaims();
  const rawLevel = error ? null : data?.claims?.aal;
  const claimedLevel: AuthAssurance['currentLevel'] = rawLevel === 'aal1'
    ? 'aal1'
    : rawLevel === 'aal2' ? 'aal2' : null;
  return {
    currentLevel: claimedLevel,
    hasVerifiedFactor: true,
    requiresChallenge: claimedLevel !== 'aal2',
  };
}
