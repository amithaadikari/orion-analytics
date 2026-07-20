import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { cookies } from 'next/headers';
import { requireClient } from '@/lib/auth';
import ClientProfileEditor from '@/components/client-profile-editor';
import PortalWorkspaceShell from '@/components/portal-workspace-shell';
import { clientProfileDisplayName, readClientProfile } from '@/lib/client-profile';
import { normalizePortalTheme, portalThemeCookie } from '@/lib/portal-theme';

export const dynamic = 'force-dynamic';

export default async function ClientProfilePage() {
  const { user, client } = await requireClient('/portal/profile');
  const cookieStore = await cookies();
  const initialTheme = normalizePortalTheme(cookieStore.get(portalThemeCookie)?.value);
  const profile = readClientProfile(user.user_metadata, {
    telegramUsername: client.telegram_username,
    phoneNumber: client.phone,
  });
  const displayName = clientProfileDisplayName(profile, client.full_name);

  return (
    <PortalWorkspaceShell currentView="profile" clientName={client.full_name} clientDisplayName={displayName} clientAvatarKey={profile.avatarKey} clientPlan={client.plan} clientStatus={client.status} initialTheme={initialTheme}>
      <section className="portal-content portal-workspace-content portal-profile-page" aria-labelledby="client-profile-page-title">
        <h1 className="orion-visually-hidden" id="client-profile-page-title">Client profile settings</h1>
        <nav className="portal-profile-page-nav" aria-label="Profile page navigation">
          <Link href="/portal"><ArrowLeft size={14} aria-hidden="true" />Back to Overview</Link>
          <span><ShieldCheck size={13} aria-hidden="true" />Secure profile settings</span>
        </nav>
        <ClientProfileEditor
          fullName={client.full_name}
          email={client.email || null}
          country={client.country || null}
          plan={client.plan}
          status={client.status}
          initialProfile={profile}
        />
      </section>
    </PortalWorkspaceShell>
  );
}
