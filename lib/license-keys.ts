import { createHash, randomInt } from 'node:crypto';

const LICENSE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ234679';
const LICENSE_GROUPS = 4;
const LICENSE_GROUP_LENGTH = 4;

export const v2LicenseKeyPattern = /^ORN-[ACDEFGHJKLMNPQRTUVWXYZ234679]{4}(?:-[ACDEFGHJKLMNPQRTUVWXYZ234679]{4}){3}$/;
export const legacyLicenseKeyPattern = /^ORI-/i;

export function generateLicenseKey() {
  const groups = Array.from({ length: LICENSE_GROUPS }, () =>
    Array.from({ length: LICENSE_GROUP_LENGTH }, () => LICENSE_ALPHABET[randomInt(LICENSE_ALPHABET.length)]).join('')
  );
  return `ORN-${groups.join('-')}`;
}

export function normalizeLicenseKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function licenseKeyVersion(value: string) {
  const normalized = normalizeLicenseKey(value);
  if (v2LicenseKeyPattern.test(normalized)) return 'v2' as const;
  if (legacyLicenseKeyPattern.test(normalized)) return 'legacy' as const;
  return null;
}

export function hashLicenseKey(value: string) {
  return createHash('sha256').update(normalizeLicenseKey(value), 'utf8').digest('hex');
}

export function maskLicenseKey(value: string) {
  const normalized = normalizeLicenseKey(value);
  const sections = normalized.split('-');
  if (sections.length < 3) return normalized;
  return [sections[0], sections[1], ...sections.slice(2, -1).map(() => '••••'), sections.at(-1)].join('-');
}
