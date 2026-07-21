import type { MembershipStatus, MembershipTier, TradingPlatform } from '@/lib/trading-accounts';

export type OrionLicensePlan = 'Basic' | 'Premium' | 'Lifetime';

export type LicenseDemoAccountView = {
  id: string;
  maskedAccountNumber: string;
  brokerServer: string;
  platform: TradingPlatform;
  registeredAt: string;
};

export type LicenseInstallationView = {
  id: string;
  hint: string;
  label: string;
  activatedAt: string;
  lastSeenAt: string | null;
};

export type PendingInstallationRequestView = {
  id: string;
  hint: string;
  label: string;
  maskedAccountNumber: string;
  brokerServer: string;
  accountType: 'Demo' | 'Real';
  platform: TradingPlatform;
  matchCode: string;
  requestedAt: string;
  expiresAt: string;
};

export type LicenseRuntimeItem = {
  id: string;
  maskedLicenseKey: string;
  plan: OrionLicensePlan;
  platform: TradingPlatform;
  status: string;
  expiresAt: string | null;
  bindingVersion: number;
  eligible: boolean;
  demoAccount: LicenseDemoAccountView | null;
  installation: LicenseInstallationView | null;
  pendingInstallationRequest: PendingInstallationRequestView | null;
  canChangeDemo: boolean;
  nextDemoChangeAt: string | null;
  demoCooldownReason: 'standard' | 'pro-security' | 'inactive' | 'license-inactive' | null;
  canReplaceInstallation: boolean;
  nextInstallationChangeAt: string | null;
  installationCooldownReason: 'security-limit' | 'inactive' | 'license-inactive' | null;
};

export type LicenseRuntimeSnapshot = {
  serverTime: string;
  clientStatus: string;
  membership: {
    storedTier: MembershipTier;
    effectiveTier: MembershipTier;
    status: MembershipStatus;
    startedAt: string | null;
    expiresAt: string | null;
  };
  licenses: LicenseRuntimeItem[];
};

export const installationIdPattern = /^ORN-INST-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}$/;

export function normalizeInstallationId(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function isInstallationId(value: string) {
  return installationIdPattern.test(normalizeInstallationId(value));
}

export function installationHint(value: string) {
  const normalized = normalizeInstallationId(value);
  return normalized ? `••••-${normalized.slice(-4)}` : 'Not paired';
}

export function maskLicenseKey(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return 'Unassigned license';
  const tail = normalized.slice(-4);
  return `${normalized.slice(0, 3)}-••••-••••-••••-${tail}`;
}
