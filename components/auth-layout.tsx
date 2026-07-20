import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import AuthExperience, { type AuthKind, type AuthMode } from '@/components/auth-experience';
import { authThemeCookie, normalizeAuthTheme } from '@/lib/auth-theme';

type AuthLayoutProps = {
  kind: AuthKind;
  mode?: AuthMode;
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

export default async function AuthLayout(props: AuthLayoutProps) {
  const cookieStore = await cookies();
  const initialTheme = normalizeAuthTheme(cookieStore.get(authThemeCookie)?.value);
  return <AuthExperience {...props} initialTheme={initialTheme} />;
}
