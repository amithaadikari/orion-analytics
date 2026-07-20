import { describe, expect, it } from 'vitest';
import { clientInitials, normalizePortalTheme } from '@/lib/portal-theme';

describe('client portal themes', () => {
  it('accepts Aurora Blue and safely falls back to Royal Gold', () => {
    expect(normalizePortalTheme('blue')).toBe('blue');
    expect(normalizePortalTheme('gold')).toBe('gold');
    expect(normalizePortalTheme('unknown')).toBe('gold');
    expect(normalizePortalTheme()).toBe('gold');
  });

  it('creates compact client initials for the profile controls', () => {
    expect(clientInitials('Ishanka Adhikari')).toBe('IA');
    expect(clientInitials('  Orion  ')).toBe('O');
    expect(clientInitials('')).toBe('O');
  });
});
