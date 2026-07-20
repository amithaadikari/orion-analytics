'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, History, Settings2 } from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import ClientAvatar from '@/components/client-avatar';

type AdminProfileMenuProps = {
  admin: { email?: string | null; role?: string | null; displayName?: string | null; avatarKey?: string | null } | null;
  onNavigate: (section: string) => void;
};

function readableIdentity(email?: string | null) {
  if (!email) return 'Orion administrator';
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Orion administrator';
}

function identityInitials(name: string) {
  const initials = name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('');
  return (initials || 'O').toUpperCase();
}

export default function AdminProfileMenu({ admin, onNavigate }: AdminProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const displayName = useMemo(() => admin?.displayName?.trim() || readableIdentity(admin?.email), [admin?.displayName, admin?.email]);
  const initials = useMemo(() => identityInitials(displayName), [displayName]);
  const roleLabel = admin?.role === 'admin' ? 'Administrator' : 'Analytics viewer';

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus();
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [open]);

  const navigate = (section: string) => {
    setOpen(false);
    onNavigate(section);
  };

  return (
    <div className="command-profile" ref={rootRef}>
      <button ref={triggerRef} type="button" className="command-profile-trigger" aria-label={`Open administrator profile for ${displayName}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="command-profile-menu" onClick={() => setOpen((value) => !value)}>
        {admin?.avatarKey ? <ClientAvatar avatarKey={admin.avatarKey} size="small" className="command-profile-trading-avatar" /> : <span className="command-profile-avatar" aria-hidden="true">{initials}<i /></span>}
        <span className="command-profile-copy"><strong>{displayName}</strong><small>{roleLabel}</small></span>
        <ChevronDown className="command-profile-chevron" size={15} aria-hidden="true" />
      </button>
      {open && (
        <div ref={dialogRef} className="command-profile-menu" id="command-profile-menu" role="dialog" aria-modal="false" aria-label="Administrator profile options">
          <header>{admin?.avatarKey ? <ClientAvatar avatarKey={admin.avatarKey} size="medium" className="command-profile-trading-avatar command-profile-trading-avatar--large" /> : <span className="command-profile-avatar command-profile-avatar--large" aria-hidden="true">{initials}<i /></span>}<div><strong>{displayName}</strong><small>{admin?.email || 'Secure Orion account'}</small><b>{roleLabel}</b></div></header>
          <div className="command-profile-links">
            <button type="button" onClick={() => navigate('settings')}><Settings2 size={16} aria-hidden="true" /><span><strong>Profile & security</strong><small>Identity, authenticator and alerts</small></span></button>
            <button type="button" onClick={() => navigate('activity')}><History size={16} aria-hidden="true" /><span><strong>Audit trail</strong><small>Review administrative activity</small></span></button>
            <a href="https://orionscalper.com" target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" /><span><strong>Orion website</strong><small>Open the public customer site</small></span></a>
          </div>
          <footer><LogoutButton /></footer>
        </div>
      )}
    </div>
  );
}

export { identityInitials, readableIdentity };
