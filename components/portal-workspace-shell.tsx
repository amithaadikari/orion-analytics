'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Bell,
  Download,
  Headphones,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Palette,
  ReceiptText,
  UserRound,
} from 'lucide-react';
import ClientAvatar from '@/components/client-avatar';
import LogoutButton from '@/components/logout-button';
import OrionBrand from '@/components/orion-brand';
import { portalThemeCookie, type PortalTheme } from '@/lib/portal-theme';
import type { ClientAvatarKey } from '@/lib/client-profile';

const workspaceSections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'setup', label: 'Setup', icon: ListChecks },
  { id: 'licenses', label: 'Licenses', icon: KeyRound },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'payments', label: 'Payments', icon: ReceiptText },
  { id: 'notifications', label: 'Updates', icon: Bell },
  { id: 'support', label: 'Support', icon: Headphones },
] as const;

type PortalWorkspaceShellProps = {
  currentView: 'overview' | 'profile';
  clientName: string;
  clientDisplayName: string;
  clientAvatarKey: ClientAvatarKey;
  clientPlan: string;
  clientStatus: string;
  initialTheme: PortalTheme;
  children: ReactNode;
};

export default function PortalWorkspaceShell({ currentView, clientName, clientDisplayName, clientAvatarKey, clientPlan, clientStatus, initialTheme, children }: PortalWorkspaceShellProps) {
  const [theme, setTheme] = useState<PortalTheme>(initialTheme);
  const [activeSection, setActiveSection] = useState<(typeof workspaceSections)[number]['id']>(currentView);
  const sectionVisibility = useRef(new Map<string, number>());

  useEffect(() => {
    setActiveSection(currentView);
    if (currentView === 'profile') return;
    const sections = workspaceSections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!sections.length || !('IntersectionObserver' in window)) return;
    const visibility = sectionVisibility.current;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => visibility.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
      const hashTarget = window.location.hash.slice(1);
      const visibleId = hashTarget && (visibility.get(hashTarget) || 0) > 0
        ? hashTarget
        : [...visibility.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
      if (visibleId) setActiveSection(visibleId as (typeof workspaceSections)[number]['id']);
    }, { rootMargin: '-18% 0px -66% 0px', threshold: [0, .12, .35] });

    sections.forEach((section) => observer.observe(section));
    return () => { observer.disconnect(); visibility.clear(); };
  }, [currentView]);

  function sectionHref(id: (typeof workspaceSections)[number]['id']) {
    if (id === 'profile') return '/portal/profile';
    if (currentView === 'overview') return `#${id}`;
    return id === 'overview' ? '/portal' : `/portal#${id}`;
  }

  function selectTheme(nextTheme: PortalTheme) {
    setTheme(nextTheme);
    document.cookie = `${portalThemeCookie}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <main className="portal-shell portal-workspace-shell" data-portal-theme={theme}>
      <a className="portal-skip-link" href="#portal-content">Skip to client workspace</a>
      <header className="portal-workspace-topbar" aria-label="Orion client navigation">
        <Link className="portal-home-link" href="/portal" aria-label="Open Orion client portal home">
          <OrionBrand context="CLIENT" />
        </Link>
        <div className="portal-workspace-topbar-actions">
          <button className="portal-theme-quick-toggle" type="button" onClick={() => selectTheme(theme === 'gold' ? 'blue' : 'gold')} aria-label={`Switch to ${theme === 'gold' ? 'Aurora Blue' : 'Royal Gold'} theme`}>
            <Palette size={15} aria-hidden="true" />
            <span>{theme === 'gold' ? 'Royal Gold' : 'Aurora Blue'}</span>
            <i aria-hidden="true" />
          </button>
          <Link className="portal-profile-summary" href="/portal/profile" aria-label="Open your Orion profile">
            <ClientAvatar avatarKey={clientAvatarKey} size="small" />
            <div><small>Client profile</small><strong>{clientDisplayName}</strong></div>
          </Link>
          <LogoutButton redirectTo="/client-login" />
        </div>
      </header>

      <div className="portal-workspace-frame">
        <aside className="portal-workspace-sidebar" aria-label="Client workspace sections">
          <div className="portal-sidebar-account">
            <ClientAvatar avatarKey={clientAvatarKey} size="small" />
            <div><small>{clientDisplayName === clientName ? 'Signed in' : clientName}</small><strong>{clientDisplayName}</strong><p>{clientPlan} plan</p></div>
            <b data-status={clientStatus.toLowerCase()}>{clientStatus}</b>
          </div>

          <nav className="portal-workspace-nav" aria-label="Portal navigation">
            {workspaceSections.map(({ id, label, icon: Icon }) => (
              <Link className={activeSection === id ? 'is-active' : ''} href={sectionHref(id)} key={id} onClick={() => setActiveSection(id)} aria-current={activeSection === id ? (id === 'profile' ? 'page' : 'location') : undefined}>
                <span aria-hidden="true"><Icon size={16} /></span>
                <strong>{label}</strong>
                <i aria-hidden="true" />
              </Link>
            ))}
          </nav>

          <div className="portal-theme-card">
            <div><Palette size={15} aria-hidden="true" /><span><small>Appearance</small><strong>Workspace theme</strong></span></div>
            <div role="radiogroup" aria-label="Client portal color theme">
              <button type="button" role="radio" aria-checked={theme === 'gold'} className={theme === 'gold' ? 'is-active' : ''} onClick={() => selectTheme('gold')}><i className="portal-theme-swatch portal-theme-swatch--gold" /><span>Royal Gold</span></button>
              <button type="button" role="radio" aria-checked={theme === 'blue'} className={theme === 'blue' ? 'is-active' : ''} onClick={() => selectTheme('blue')}><i className="portal-theme-swatch portal-theme-swatch--blue" /><span>Aurora Blue</span></button>
            </div>
          </div>

          <Link className="portal-sidebar-support" href={currentView === 'overview' ? '#support' : '/portal#support'}><Headphones size={16} aria-hidden="true" /><span><small>Need help?</small><strong>Open secure support</strong></span><b aria-hidden="true">→</b></Link>
        </aside>

        <div className="portal-workspace-main" id="portal-content">{children}</div>
      </div>
    </main>
  );
}
