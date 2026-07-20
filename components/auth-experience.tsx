'use client';

import { useState, type ReactNode } from 'react';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  Download,
  KeyRound,
  LockKeyhole,
  MailCheck,
  Palette,
  Radio,
  ShieldCheck,
  UserRound,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import OrionBrand from '@/components/orion-brand';
import { authThemeCookie, type AuthTheme } from '@/lib/auth-theme';

export type AuthKind = 'admin' | 'client';
export type AuthMode = 'login' | 'register' | 'recover' | 'reset';

export type AuthExperienceProps = {
  kind: AuthKind;
  mode?: AuthMode;
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  initialTheme: AuthTheme;
};

type Story = {
  context: 'ADMIN' | 'CLIENT';
  kicker: string;
  title: string;
  description: string;
  features: Array<{ icon: LucideIcon; label: string; tone: string }>;
};

const stories: Record<AuthKind, Story> = {
  admin: {
    context: 'ADMIN',
    kicker: 'Private intelligence',
    title: 'Every Orion signal, brought into focus.',
    description: 'A protected command center for acquisition, customer operations, licensing, revenue, and product delivery.',
    features: [
      { icon: Activity, label: 'Live acquisition signals', tone: 'cyan' },
      { icon: BarChart3, label: 'Commercial clarity', tone: 'gold' },
      { icon: ShieldCheck, label: 'Role-protected access', tone: 'green' },
    ],
  },
  client: {
    context: 'CLIENT',
    kicker: 'Orion private access',
    title: 'Your Orion access, clearly organized.',
    description: 'Move from secure account setup to licensing, downloads, payment records, notifications, and official support.',
    features: [
      { icon: KeyRound, label: 'License and status access', tone: 'gold' },
      { icon: Download, label: 'Verified product updates', tone: 'cyan' },
      { icon: ShieldCheck, label: 'Protected client workspace', tone: 'green' },
    ],
  },
};

const stages: Record<AuthMode, Array<{ label: string; icon: LucideIcon }>> = {
  login: [{ label: 'Identify', icon: UserRound }, { label: 'Verify', icon: ShieldCheck }, { label: 'Enter workspace', icon: BadgeCheck }],
  register: [{ label: 'Account details', icon: UserRound }, { label: 'Choose edition', icon: KeyRound }, { label: 'Confirm email', icon: MailCheck }],
  recover: [{ label: 'Account email', icon: UserRound }, { label: 'Secure link', icon: MailCheck }, { label: 'Reset access', icon: KeyRound }],
  reset: [{ label: 'New password', icon: KeyRound }, { label: 'Secure account', icon: ShieldCheck }, { label: 'Sign in again', icon: BadgeCheck }],
};

export default function AuthExperience({ kind, mode = 'login', eyebrow, title, subtitle, children, footer, wide = false, initialTheme }: AuthExperienceProps) {
  const story = stories[kind];
  const [theme, setTheme] = useState<AuthTheme>(initialTheme);
  const shellClass = ['auth-shell', 'orion-auth-shell', kind === 'client' ? 'client-auth' : '', wide ? 'register-shell orion-auth-shell--wide' : ''].filter(Boolean).join(' ');
  const cardClass = ['auth-card', 'orion-auth-card', wide ? 'register-card orion-auth-card--wide' : ''].filter(Boolean).join(' ');

  function selectTheme(nextTheme: AuthTheme) {
    setTheme(nextTheme);
    document.cookie = `${authThemeCookie}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <main className={shellClass} data-auth-kind={kind} data-auth-theme={theme}>
      <div className="orion-auth-atmosphere" aria-hidden="true">
        <span className="orion-auth-orbit orion-auth-orbit--one" />
        <span className="orion-auth-orbit orion-auth-orbit--two" />
        <span className="orion-auth-starfield" />
        <span className="orion-auth-aurora" />
      </div>

      <div className={`orion-auth-frame ${wide ? 'orion-auth-frame--wide' : ''}`.trim()}>
        <aside className="orion-auth-story" aria-label="Orion secure access">
          <div className="orion-auth-story-topline">
            <OrionBrand context={story.context} className="orion-auth-story-brand" />
            <span><LockKeyhole size={13} aria-hidden="true" />Protected route</span>
          </div>

          <div className="orion-auth-story-copy">
            <p className="eyebrow">{story.kicker}</p>
            <h2>{story.title}</h2>
            <p>{story.description}</p>
          </div>

          <ol className="orion-auth-journey" aria-label="Secure access journey">
            {stages[mode].map(({ label, icon: Icon }, index) => (
              <li key={label}>
                <span><Icon size={14} aria-hidden="true" /></span>
                <div><small>{String(index + 1).padStart(2, '0')}</small><strong>{label}</strong></div>
                <i aria-hidden="true" />
              </li>
            ))}
          </ol>

          <ul className="orion-auth-feature-list" aria-label="Workspace benefits">
            {story.features.map(({ icon: Icon, label, tone }) => (
              <li key={label} data-tone={tone}><span className="orion-auth-feature-icon" aria-hidden="true"><Icon size={15} /></span><span>{label}</span></li>
            ))}
          </ul>

          <div className="orion-auth-security-console" aria-label="Connection security status">
            <header><span><Radio size={14} aria-hidden="true" />Security status</span><b><i aria-hidden="true" />Live</b></header>
            <dl>
              <div><dt>Encrypted connection</dt><dd><Wifi size={13} aria-hidden="true" />Active</dd></div>
              <div><dt>Session validation</dt><dd><CheckCircle2 size={13} aria-hidden="true" />Ready</dd></div>
              <div><dt>Access scope</dt><dd><ShieldCheck size={13} aria-hidden="true" />{kind === 'admin' ? 'Admin' : 'Client'}</dd></div>
            </dl>
            <span aria-hidden="true" />
          </div>
        </aside>

        <section className={cardClass} aria-labelledby="orion-auth-title">
          <div className="orion-auth-card-utility">
            <OrionBrand context={story.context} className="orion-auth-card-brand" />
            <span className="orion-auth-protection"><ShieldCheck size={14} aria-hidden="true" />Official Orion access</span>
            <div className="orion-auth-theme" role="group" aria-label="Authentication page color theme">
              <span><Palette size={14} aria-hidden="true" />Theme</span>
              <button type="button" aria-pressed={theme === 'gold'} className={theme === 'gold' ? 'is-active' : ''} onClick={() => selectTheme('gold')}><i className="auth-theme-swatch auth-theme-swatch--gold" /><b>Gold</b></button>
              <button type="button" aria-pressed={theme === 'blue'} className={theme === 'blue' ? 'is-active' : ''} onClick={() => selectTheme('blue')}><i className="auth-theme-swatch auth-theme-swatch--blue" /><b>Blue</b></button>
            </div>
          </div>

          <header className="orion-auth-intro">
            <p className="eyebrow">{eyebrow}</p>
            <h1 id="orion-auth-title">{title}</h1>
            <p className="auth-subtitle">{subtitle}</p>
          </header>

          <div className="orion-auth-stage-strip" aria-label="Secure access steps">
            {stages[mode].map(({ label }, index) => <span key={label}><i aria-hidden="true">{String(index + 1).padStart(2, '0')}</i><b>{label}</b></span>)}
          </div>

          <div className="orion-auth-form-region">{children}</div>

          <div className="orion-auth-trust-row" aria-label="Security information">
            <span><ShieldCheck size={14} aria-hidden="true" />Encrypted</span>
            <span><LockKeyhole size={14} aria-hidden="true" />Private session</span>
            <span><CheckCircle2 size={14} aria-hidden="true" />Official Orion</span>
          </div>
          {footer ? <footer className="legal-note orion-auth-footer">{footer}</footer> : null}
        </section>
      </div>
    </main>
  );
}
