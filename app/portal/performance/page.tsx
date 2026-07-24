import { cookies } from 'next/headers';
import ClientPerformanceCenter from '@/components/client-performance-center';
import PortalWorkspaceShell from '@/components/portal-workspace-shell';
import { requireClient } from '@/lib/auth';
import { clientProfileDisplayName, readClientProfile } from '@/lib/client-profile';
import { normalizePortalTheme, portalThemeCookie } from '@/lib/portal-theme';

export const dynamic = 'force-dynamic';

export default async function ClientPerformancePage() {
  const { user, client } = await requireClient('/portal/performance');
  const cookieStore = await cookies();
  const initialTheme = normalizePortalTheme(cookieStore.get(portalThemeCookie)?.value);
  const profile = readClientProfile(user.user_metadata, {
    telegramUsername: client.telegram_username,
    phoneNumber: client.phone,
  });
  const displayName = clientProfileDisplayName(profile, client.full_name);

  return (
    <PortalWorkspaceShell
      currentView="performance"
      clientName={client.full_name}
      clientDisplayName={displayName}
      clientAvatarKey={profile.avatarKey}
      clientPlan={client.plan}
      clientStatus={client.status}
      initialTheme={initialTheme}
    >
      <section className="portal-content portal-workspace-content" id="performance">
        <ClientPerformanceCenter />
      </section>
    </PortalWorkspaceShell>
  );
}
