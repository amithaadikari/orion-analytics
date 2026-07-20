export type PortalTheme = 'gold' | 'blue';

export const portalThemeCookie = 'orion-portal-theme';

export function normalizePortalTheme(value?: string | null): PortalTheme {
  return value === 'blue' ? 'blue' : 'gold';
}

export function clientInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return initials || 'O';
}
