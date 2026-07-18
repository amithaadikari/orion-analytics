import Link from 'next/link';
import LogoutButton from '@/components/logout-button';
import OrionBrand from '@/components/orion-brand';

type PortalTopbarProps = {
  clientName: string;
};

export default function PortalTopbar({ clientName }: PortalTopbarProps) {
  return (
    <header className="portal-topbar orion-portal-topbar" aria-label="Orion client navigation">
      <Link className="portal-home-link" href="/portal" aria-label="Open Orion client portal home">
        <OrionBrand context="CLIENT" />
      </Link>
      <div className="portal-user-actions">
        <span className="portal-user-context">
          <small>Signed in as</small>
          <strong className="portal-user">{clientName}</strong>
        </span>
        <LogoutButton redirectTo="/client-login" />
      </div>
    </header>
  );
}
