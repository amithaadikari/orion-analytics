'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  CheckCheck,
  CreditCard,
  Headphones,
  Inbox,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  safeNotificationHref,
  usePortalNotifications,
  type PortalNotification,
} from '@/components/portal-notifications-provider';
import styles from './portal-notification-bell.module.css';

export default function PortalNotificationBell() {
  const {
    notifications,
    unreadCount,
    loading,
    error,
    updating,
    markNotification,
    markAllRead,
    openNotification,
  } = usePortalNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => [...notifications]
    .sort((left, right) => dateValue(right.created_at) - dateValue(left.created_at))
    .slice(0, 5), [notifications]);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      const restoreFocus = Boolean(panelRef.current?.contains(document.activeElement));
      setOpen(false);
      if (restoreFocus) {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => buttonRef.current?.focus());
        else buttonRef.current?.focus();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  async function openItem(notification: PortalNotification) {
    setOpen(false);
    await openNotification(notification);
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        className={styles.trigger}
        type="button"
        ref={buttonRef}
        aria-label={unreadCount === 0 ? 'Notifications, none unread' : `Notifications, ${unreadCount} unread`}
        aria-expanded={open}
        aria-controls="portal-notification-popover"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={17} aria-hidden="true" />
        {unreadCount > 0 && <span className={styles.badge} aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className={styles.popover} id="portal-notification-popover" role="region" aria-label="Recent notifications" ref={panelRef}>
          <header className={styles.header}>
            <div><small>Client updates</small><strong>Notifications</strong></div>
            <span>{unreadCount} unread</span>
          </header>

          {unreadCount > 0 && (
            <button className={styles.markAll} type="button" disabled={updating !== null} onClick={() => void markAllRead()}>
              <CheckCheck size={14} aria-hidden="true" />{updating === 'all' ? 'Updating…' : 'Mark all as read'}
            </button>
          )}

          <div className={styles.content}>
            {loading && notifications.length === 0 ? (
              <div className={styles.loading} role="status"><span /><span /><span /><p>Loading updates…</p></div>
            ) : error && notifications.length === 0 ? (
              <div className={styles.empty} role="alert"><span aria-hidden="true">!</span><strong>Updates unavailable</strong><p>{error}</p></div>
            ) : recent.length === 0 ? (
              <div className={styles.empty} role="status"><Inbox size={20} aria-hidden="true" /><strong>You’re up to date</strong><p>New Orion account activity will appear here.</p></div>
            ) : (
              <ol className={styles.list}>
                {recent.map((notification) => {
                  const unread = !notification.read_at;
                  const href = safeNotificationHref(notification.href);
                  const tone = kindTone(notification.kind);
                  return (
                    <li className={unread ? styles.unread : ''} key={notification.id}>
                      {href ? (
                        <button className={styles.itemMain} type="button" onClick={() => void openItem(notification)}>
                          <KindIcon tone={tone} />
                          <NotificationCopy notification={notification} />
                          {unread && <i aria-label="Unread" />}
                        </button>
                      ) : (
                        <div className={styles.itemMain}>
                          <KindIcon tone={tone} />
                          <NotificationCopy notification={notification} />
                          {unread && <i aria-label="Unread" />}
                        </div>
                      )}
                      {unread && !href && (
                        <button className={styles.markOne} type="button" disabled={updating !== null} onClick={() => void markNotification(notification.id, true)} aria-label={`Mark ${notification.title} as read`}>
                          <Check size={13} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <Link className={styles.viewAll} href="/portal#notifications" onClick={() => setOpen(false)}>
            View all account updates <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function NotificationCopy({ notification }: { notification: PortalNotification }) {
  return <span className={styles.copy}><strong>{notification.title}</strong><small>{notification.message}</small><time dateTime={notification.created_at}>{formatTime(notification.created_at)}</time></span>;
}

function KindIcon({ tone }: { tone: ReturnType<typeof kindTone> }) {
  const Icon = tone === 'license' ? KeyRound : tone === 'billing' ? CreditCard : tone === 'support' ? Headphones : tone === 'security' ? ShieldCheck : Sparkles;
  return <span className={styles.kind} data-kind={tone} aria-hidden="true"><Icon size={15} /></span>;
}

function kindTone(kind: string) {
  const value = kind.toLowerCase();
  if (value.includes('license')) return 'license' as const;
  if (value.includes('payment') || value.includes('billing')) return 'billing' as const;
  if (value.includes('support') || value.includes('ticket')) return 'support' as const;
  if (value.includes('security') || value.includes('password') || value.includes('session')) return 'security' as const;
  return 'account' as const;
}

function dateValue(value: string) {
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? 0 : result;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
