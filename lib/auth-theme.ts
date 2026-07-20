export type AuthTheme = 'gold' | 'blue';

export const authThemeCookie = 'orion-auth-theme';

export function normalizeAuthTheme(value?: string | null): AuthTheme {
  return value === 'blue' ? 'blue' : 'gold';
}
