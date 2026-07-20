import { describe, expect, it } from 'vitest';
import { generateLicenseKey, hashLicenseKey, licenseKeyVersion, maskLicenseKey, normalizeLicenseKey, v2LicenseKeyPattern } from '@/lib/license-keys';

describe('Orion V2 license keys', () => {
  it('creates opaque readable keys using the approved format', () => {
    const keys = Array.from({ length: 100 }, () => generateLicenseKey());
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(v2LicenseKeyPattern);
      expect(key.split('-').slice(1).join('')).not.toMatch(/[01OIS5B8]/);
    }
  });

  it('normalizes and classifies V2 and legacy keys', () => {
    expect(normalizeLicenseKey(' orn-k7m4-r9tx-6wqp-v3hc ')).toBe('ORN-K7M4-R9TX-6WQP-V3HC');
    expect(licenseKeyVersion('ORN-K7M4-R9TX-6WQP-V3HC')).toBe('v2');
    expect(licenseKeyVersion('ORI-2026-B10001-D9A5')).toBe('legacy');
    expect(licenseKeyVersion('invalid-key')).toBeNull();
  });

  it('hashes normalized keys consistently and masks middle groups', () => {
    expect(hashLicenseKey('orn-k7m4-r9tx-6wqp-v3hc')).toBe(hashLicenseKey(' ORN-K7M4-R9TX-6WQP-V3HC '));
    expect(maskLicenseKey('ORN-K7M4-R9TX-6WQP-V3HC')).toBe('ORN-K7M4-••••-••••-V3HC');
  });
});
