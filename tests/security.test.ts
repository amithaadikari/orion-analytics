import { describe, expect, it } from 'vitest';
import { sanitizeUrl, sanitizeString } from '@/lib/security';

describe('input safety', () => {
  it('rejects non-http URLs and strips control characters', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeString('<script>\u0000safe</script>')).toBe('scriptsafe/script');
  });
});
