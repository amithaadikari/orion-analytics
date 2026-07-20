export type ActivationLicense = {
  plan: string;
  platform: string;
  status: string;
  expires_at?: string | null;
};

export type ActivationRelease = {
  id: string;
  platform: string;
  download_url?: string | null;
};

export function effectiveLicenseStatus(license: ActivationLicense, asOf = Date.now()) {
  if (license.expires_at) {
    const expiry = Date.parse(`${license.expires_at.slice(0, 10)}T23:59:59.999Z`);
    if (Number.isFinite(expiry) && expiry < asOf) return 'expired';
  }
  return normalizeActivationValue(license.status);
}

export function activeLicensesForPlan(plan: string, licenses: ActivationLicense[], asOf = Date.now()) {
  const normalizedPlan = normalizeActivationValue(plan);
  return licenses.filter((license) => normalizeActivationValue(license.plan) === normalizedPlan && effectiveLicenseStatus(license, asOf) === 'active');
}

export function compatibleReleaseForPlan<T extends ActivationRelease>(plan: string, licenses: ActivationLicense[], releases: T[], asOf = Date.now()) {
  const activePlatforms = new Set(activeLicensesForPlan(plan, licenses, asOf).map((license) => normalizeActivationValue(license.platform)));
  if (activePlatforms.size === 0) return undefined;
  return releases.find((release) => Boolean(release.download_url) && (normalizeActivationValue(release.platform) === 'both' || activePlatforms.has(normalizeActivationValue(release.platform))));
}

export function normalizeActivationValue(value: string) {
  return value.trim().toLowerCase();
}
