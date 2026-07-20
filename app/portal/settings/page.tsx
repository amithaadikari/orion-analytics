import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { requireClient } from '@/lib/auth';
import ClientAccountSettings from '@/components/client-account-settings';
import PortalWorkspaceShell from '@/components/portal-workspace-shell';
import { clientProfileDisplayName, readClientProfile } from '@/lib/client-profile';
import { normalizePortalTheme, portalThemeCookie } from '@/lib/portal-theme';
import { securityDeviceFromRequest, securityDeviceLabel } from '@/lib/client-security';

export const dynamic = 'force-dynamic';

export default async function ClientAccountSettingsPage() {
  const { user, client } = await requireClient('/portal/settings');
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const initialTheme = normalizePortalTheme(cookieStore.get(portalThemeCookie)?.value);
  const profile = readClientProfile(user.user_metadata, {
    telegramUsername: client.telegram_username,
    phoneNumber: client.phone,
  });
  const displayName = clientProfileDisplayName(profile, client.full_name);
  const request = new Request('https://app.orionscalper.com/portal/settings', { headers: new Headers(requestHeaders) });
  const currentDevice = securityDeviceLabel(securityDeviceFromRequest(request));
  const verifiedFactor = user.factors?.find((factor) => factor.factor_type === 'totp' && factor.status === 'verified');

  return (
    <PortalWorkspaceShell
      currentView="settings"
      clientName={client.full_name}
      clientDisplayName={displayName}
      clientAvatarKey={profile.avatarKey}
      clientPlan={client.plan}
      clientStatus={client.status}
      initialTheme={initialTheme}
    >
      <section className="portal-content portal-workspace-content" aria-labelledby="account-security-title">
        <h1 className="orion-visually-hidden" id="account-security-title">Account security and settings</h1>
        <nav className="portal-profile-page-nav" aria-label="Account settings navigation">
          <Link href="/portal"><ArrowLeft size={14} aria-hidden="true" />Back to Overview</Link>
          <span><ShieldCheck size={13} aria-hidden="true" />Protected account settings</span>
        </nav>
        <ClientAccountSettings
          email={user.email || client.email || ''}
          emailVerified={Boolean(user.email_confirmed_at)}
          pendingEmail={user.new_email || null}
          accountCreatedAt={user.created_at}
          lastSignInAt={user.last_sign_in_at || null}
          currentDevice={currentDevice}
          initialFactorId={verifiedFactor?.id || null}
        />
      </section>
    </PortalWorkspaceShell>
  );
}
