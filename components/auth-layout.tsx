import type { ReactNode } from 'react';
import OrionBrand from '@/components/orion-brand';

type AuthKind = 'admin' | 'client';

type AuthLayoutProps = {
  kind: AuthKind;
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

const stories = {
  admin: {
    context: 'ADMIN' as const,
    kicker: 'Private intelligence',
    title: 'Every Orion signal, brought into focus.',
    description: 'A protected command center for acquisition, customer operations and product delivery.',
    features: [
      { icon: 'pulse', label: 'Live acquisition signals' },
      { icon: 'chart', label: 'Campaign-to-conversion clarity' },
      { icon: 'shield', label: 'Role-protected workspace' },
    ],
  },
  client: {
    context: 'CLIENT' as const,
    kicker: 'Orion private access',
    title: 'Your trading access. One secure destination.',
    description: 'Move from account setup to verified licensing with every important detail kept in one place.',
    features: [
      { icon: 'key', label: 'License and status access' },
      { icon: 'download', label: 'Verified product updates' },
      { icon: 'shield', label: 'Protected account workspace' },
    ],
  },
};

export default function AuthLayout({ kind, eyebrow, title, subtitle, children, footer, wide = false }: AuthLayoutProps) {
  const story = stories[kind];
  const shellClass = [
    'auth-shell',
    'orion-auth-shell',
    kind === 'client' ? 'client-auth' : '',
    wide ? 'register-shell orion-auth-shell--wide' : '',
  ].filter(Boolean).join(' ');
  const cardClass = [
    'auth-card',
    'orion-auth-card',
    wide ? 'register-card orion-auth-card--wide' : '',
  ].filter(Boolean).join(' ');

  return (
    <main className={shellClass} data-auth-kind={kind}>
      <div className="orion-auth-atmosphere" aria-hidden="true">
        <span className="orion-auth-orbit orion-auth-orbit--one" />
        <span className="orion-auth-orbit orion-auth-orbit--two" />
        <span className="orion-auth-starfield" />
      </div>

      <div className={`orion-auth-frame ${wide ? 'orion-auth-frame--wide' : ''}`.trim()}>
        <aside className="orion-auth-story" aria-label="Orion secure access">
          <OrionBrand context={story.context} className="orion-auth-story-brand" />
          <div className="orion-auth-story-copy">
            <p className="eyebrow">{story.kicker}</p>
            <h2>{story.title}</h2>
            <p>{story.description}</p>
          </div>
          <ul className="orion-auth-feature-list" aria-label="Workspace benefits">
            {story.features.map((feature) => (
              <li key={feature.label}>
                <AuthFeatureIcon name={feature.icon} />
                <span>{feature.label}</span>
              </li>
            ))}
          </ul>
          <p className="orion-auth-story-note"><span aria-hidden="true" /> Secure Orion environment</p>
        </aside>

        <section className={cardClass} aria-labelledby="orion-auth-title">
          <OrionBrand context={story.context} className="orion-auth-card-brand" />
          <header className="orion-auth-intro">
            <p className="eyebrow">{eyebrow}</p>
            <h1 id="orion-auth-title">{title}</h1>
            <p className="auth-subtitle">{subtitle}</p>
          </header>
          <div className="orion-auth-form-region">{children}</div>
          {footer ? <footer className="legal-note orion-auth-footer">{footer}</footer> : null}
        </section>
      </div>
    </main>
  );
}

function AuthFeatureIcon({ name }: { name: string }) {
  return (
    <span className={`orion-auth-feature-icon orion-auth-feature-icon--${name}`} aria-hidden="true">
      {name === 'shield' ? '◇' : name === 'key' ? '⌁' : name === 'download' ? '↓' : name === 'chart' ? '↗' : '∿'}
    </span>
  );
}
