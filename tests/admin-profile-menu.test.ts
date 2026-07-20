import { describe, expect, it } from 'vitest';
import { identityInitials, readableIdentity } from '@/components/admin-profile-menu';

describe('administrator profile identity', () => {
  it('turns an email identifier into a readable dashboard name', () => {
    expect(readableIdentity('orion.admin-team@example.com')).toBe('Orion Admin Team');
  });

  it('uses concise initials and a safe fallback', () => {
    expect(identityInitials('Orion Admin Team')).toBe('OA');
    expect(readableIdentity(null)).toBe('Orion administrator');
    expect(identityInitials('')).toBe('O');
  });
});
