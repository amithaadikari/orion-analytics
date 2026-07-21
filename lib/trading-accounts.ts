export type MembershipTier = 'Standard' | 'Pro';
export type MembershipStatus = 'Active' | 'Expired' | 'Cancelled' | 'Suspended';
export type TradingPlatform = 'MT4' | 'MT5';
export type ClientPlan = 'Free' | 'Basic' | 'Premium' | 'Lifetime';

export type TradingAccountView = {
  id: string;
  accountNumber: string;
  maskedAccountNumber: string;
  broker: string;
  brokerServer: string;
  platform: TradingPlatform;
  currency: string | null;
  status: string;
  verifiedAt: string | null;
  registeredAt: string;
  deactivatedAt: string | null;
};

export type TradingAccountHistoryItem = {
  id: string;
  changedBy: 'Admin' | 'Client' | 'System';
  changeKind: 'Registration' | 'Replacement' | 'Reactivation';
  membershipTier: MembershipTier;
  previousAccount: Pick<TradingAccountView, 'maskedAccountNumber' | 'platform'> | null;
  newAccount: Pick<TradingAccountView, 'maskedAccountNumber' | 'platform' | 'broker' | 'brokerServer'>;
  overrideReason?: string | null;
  nextClientChangeAt: string | null;
  createdAt: string;
};

export type TradingAccountSnapshot = {
  serverTime: string;
  clientStatus: string;
  clientPlan: ClientPlan;
  membership: {
    storedTier: MembershipTier;
    effectiveTier: MembershipTier;
    status: MembershipStatus;
    startedAt: string | null;
    expiresAt: string | null;
  };
  currentAccount: TradingAccountView | null;
  hasRegisteredAccount: boolean;
  licensesBound: number;
  eligibleLicenses: number;
  eligiblePlatforms: TradingPlatform[];
  canChange: boolean;
  nextChangeAt: string | null;
  cooldownDays: number;
  cooldownReason: 'standard' | 'pro-security' | 'plan-locked' | 'inactive' | 'no-license' | null;
  legacyReview: {
    pendingCount: number;
    suggestedAccountNumber: string | null;
  };
  history: TradingAccountHistoryItem[];
};

export type MembershipRecord = {
  membership_tier?: string | null;
  membership_status?: string | null;
  membership_started_at?: string | null;
  membership_expires_at?: string | null;
};

export function effectiveMembership(record: MembershipRecord, now = new Date()) {
  const storedTier: MembershipTier = record.membership_tier === 'Pro' ? 'Pro' : 'Standard';
  const status: MembershipStatus = ['Active', 'Expired', 'Cancelled', 'Suspended'].includes(record.membership_status || '')
    ? record.membership_status as MembershipStatus
    : 'Active';
  const startedAt = record.membership_started_at || null;
  const expiresAt = record.membership_expires_at || null;
  const start = startedAt ? new Date(startedAt).getTime() : null;
  const expiry = expiresAt ? new Date(expiresAt).getTime() : null;
  const activePro = storedTier === 'Pro'
    && status === 'Active'
    && (start === null || (!Number.isNaN(start) && start <= now.getTime()))
    && (expiry === null || (!Number.isNaN(expiry) && expiry > now.getTime()));
  return { storedTier, effectiveTier: activePro ? 'Pro' as const : 'Standard' as const, status, startedAt, expiresAt };
}

export function accountChangeEligibility({
  clientPlan,
  membershipTier,
  currentAccount,
  hasRegisteredAccount,
  clientStatus,
  eligibleLicenses,
  history,
  now = new Date(),
}: {
  clientPlan: ClientPlan;
  membershipTier: MembershipTier;
  currentAccount: TradingAccountView | null;
  hasRegisteredAccount: boolean;
  clientStatus: string;
  eligibleLicenses: number;
  history: TradingAccountHistoryItem[];
  now?: Date;
}) {
  if (clientStatus !== 'Active') return { canChange: false, nextChangeAt: null, cooldownReason: 'inactive' as const };
  if (eligibleLicenses < 1) return { canChange: false, nextChangeAt: null, cooldownReason: 'no-license' as const };
  if (!currentAccount && !hasRegisteredAccount) return { canChange: true, nextChangeAt: null, cooldownReason: null };
  if (clientPlan !== 'Lifetime') return { canChange: false, nextChangeAt: null, cooldownReason: 'plan-locked' as const };

  const replacements = history
    .filter((item) => item.changedBy === 'Client' && ['Replacement', 'Reactivation'].includes(item.changeKind))
    .map((item) => new Date(item.createdAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((left, right) => right - left);

  if (membershipTier === 'Standard') {
    const last = replacements[0];
    const next = typeof last === 'number' ? last + 7 * 24 * 60 * 60 * 1000 : null;
    if (next && next > now.getTime()) return { canChange: false, nextChangeAt: new Date(next).toISOString(), cooldownReason: 'standard' as const };
    return { canChange: true, nextChangeAt: null, cooldownReason: null };
  }

  const recent = replacements.filter((time) => time > now.getTime() - 24 * 60 * 60 * 1000);
  if (recent.length >= 2) {
    const reset = Math.min(...recent) + 24 * 60 * 60 * 1000;
    return { canChange: false, nextChangeAt: new Date(reset).toISOString(), cooldownReason: 'pro-security' as const };
  }
  return { canChange: true, nextChangeAt: null, cooldownReason: null };
}

export function canonicalClientPlan(value: unknown): ClientPlan {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'basic') return 'Basic';
  if (normalized === 'premium') return 'Premium';
  if (normalized === 'lifetime') return 'Lifetime';
  return 'Free';
}

export function maskTradingAccount(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Not registered';
  if (normalized.length <= 4) return normalized;
  return `${'•'.repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function canonicalTradingAccountNumber(value: string) {
  return value.trim();
}

export function canonicalTradingAccountText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}
