import { requireAdmin } from '@/lib/auth';
import Dashboard from '@/components/analytics-dashboard';
import type { AdminAccountSnapshot } from '@/components/admin-settings-panel';
import { cookies, headers } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { readAdminPreferences, readAdminProfile } from '@/lib/admin-account';
import { securityDeviceFromRequest, securityDeviceLabel } from '@/lib/client-security';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  const { admin, user } = await requireAdmin();
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const db = createSupabaseAdminClient();
  const { data: preferenceRow } = await db
    .from('admin_account_preferences')
    .select('display_name,avatar_key,dashboard_theme,registration_alerts,payment_alerts,license_alerts,support_alerts')
    .eq('admin_id', admin.id)
    .maybeSingle();
  const profile = readAdminProfile(preferenceRow, user.email || admin.email);
  const preferences = readAdminPreferences(preferenceRow);
  const themeCookie = cookieStore.get('orion-admin-theme')?.value;
  const initialTheme = themeCookie === 'black' || themeCookie === 'royal' ? themeCookie : preferences.theme;
  const request = new Request('https://admin.orionscalper.com/dashboard', { headers: new Headers(requestHeaders) });
  const currentDevice = securityDeviceLabel(securityDeviceFromRequest(request));
  const verifiedFactor = user.factors?.find((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
  const account: AdminAccountSnapshot = {
    email: user.email || admin.email || '',
    emailVerified: Boolean(user.email_confirmed_at),
    pendingEmail: user.new_email || null,
    role: admin.role,
    accountCreatedAt: user.created_at,
    lastSignInAt: user.last_sign_in_at || null,
    currentDevice,
    initialFactorId: verifiedFactor?.id || null,
    profile,
    preferences: { ...preferences, theme: initialTheme },
  };
  const params = await searchParams;
  const initialSection = typeof params.section === 'string' ? params.section : undefined;
  return <Dashboard admin={admin} account={account} initialTheme={initialTheme} initialSection={initialSection} />;
}
