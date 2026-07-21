import 'server-only';

import { createHash, randomInt } from 'node:crypto';
import { normalizeInstallationId } from '@/lib/license-runtime';
import { normalizeLicenseKey } from '@/lib/license-keys';

const POLL_PROOF_PREFIX = 'ORION-PAIR-V1';

export function pairingPollProof(licenseKey: string, installationId: string) {
  const identity = `${POLL_PROOF_PREFIX}|${normalizeLicenseKey(licenseKey)}|${normalizeInstallationId(installationId)}`;
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

export function hashPairingPollProof(proof: string) {
  return createHash('sha256').update(proof.trim().toLowerCase(), 'utf8').digest('hex');
}

export function generatePairingMatchCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
