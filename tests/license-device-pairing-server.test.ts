import { describe, expect, it } from 'vitest';
import { hashPairingPollProof, pairingPollProof } from '@/lib/license-device-pairing-server';

describe('installation approval polling proof', () => {
  it('is stable across normalized license and installation formatting', () => {
    const first = pairingPollProof(' orn-acde-fghj-klmn-pqrt ', ' orn-inst-abcd-efgh-jklm-npqr-stuv-wxyz ');
    const second = pairingPollProof('ORN-ACDE-FGHJ-KLMN-PQRT', 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores a second one-way hash rather than the proof itself', () => {
    const proof = pairingPollProof('ORN-ACDE-FGHJ-KLMN-PQRT', 'ORN-INST-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ');
    const stored = hashPairingPollProof(proof);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(proof);
  });
});
