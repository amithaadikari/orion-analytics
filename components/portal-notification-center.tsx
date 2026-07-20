'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Headphones,
  Inbox,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  safeNotificationHref,
  usePortalNotifications,
  type PortalNotification,
} from '@/components/portal-notifications-provider';
import styles from './portal-notification-center.module.css';

type NotificationFilter = 'all' | 'unread' | 'billing' | 'license' | 'support' | 'security';
type NotificationSummary = { unreadCount: number; totalCount: number; loaded: boolean };

const filters: { id: NotificationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'license', label: 'Licenses' },
  { id: 'billing', label: 'Billing' },
  { id: 'support', label: 'Support' },
  { id: 'security', label: 'Security' },
];

type PortalNotificationCenterProps = {
  className?: string;
  embedded?: boolean;
  onSummaryChange?: (summary: NotificationSummary) => void;
};

export default function PortalNotificationCenter({ className = '', embedded = false, onSummaryChange }: PortalNotificationCenterProps) {
  const {
    notifications,
    unreadCount,
    loading,
    refreshing,
    error,
    notice,
    updating,
    refresh,
    markNotification,
    markAllRead,
    openNotification,
  } = usePortalNotifications();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    onSummaryChange?.({ unreadCount, totalCount: notifications.length, loaded: !loading && !error });
  }, [error, loading, notifications.length, onSummaryChange, unreadCount]);

  const filtered = useMemo(() => notifications.filter((notification) => matchesFilter(notification, filter)), [filter, notifications]);
  const visible = expanded ? filtered : filtered.slice(0, 5);
  const hiddenCount = filtered.length - visible.length;

  function selectFilter(nextFilter: NotificationFilter) {
    setFilter(nextFilter);
    setExpanded(false);
  }

  const headingId = embedded ? undefined : 'portal-notifications-title';
  return (
    <section className={`${styles.center} ${embedded ? styles.embedded : ''} ${className}`.trim()} id={embedded ? undefined : 'notifications'} aria-labelledby={headingId} aria-label={embedded ? 'Account notifications' : undefined} aria-busy={loading}>
      <header className={styles.header}>
        {embedded ? (
          <div className={styles.compactTitle}><span aria-hidden="true"><Bell size={18} /></span><div><small>Account timeline</small><strong>Recent Orion updates</strong></div></div>
        ) : (
          <div><p>Client updates</p><h2 id={headingId}>Notification center</h2><span>Security, payment, license, and support updates from your Orion account.</span></div>
        )}
        <div className={styles.headerActions}>
          <strong className={styles.unreadCount} aria-label={`${unreadCount} unread notifications`}>{unreadCount}<small>Unread</small></strong>
          {unreadCount > 0 && <button type="button" disabled={updating !== null} onClick={() => void markAllRead()}><CheckCheck size={14} aria-hidden="true" />{updating === 'all' ? 'Updating…' : 'Mark all read'}</button>}
          <button className={styles.iconButton} type="button" disabled={loading || refreshing || updating !== null} onClick={() => void refresh()} aria-label="Refresh notifications"><RefreshCw size={16} aria-hidden="true" /></button>
        </div>
      </header>

      {!loading && notifications.length > 0 && (
        <div className={styles.filters} role="group" aria-label="Filter account updates">
          {filters.map((option) => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => selectFilter(option.id)}>{option.label}<span>{filterCount(notifications, option.id)}</span></button>)}
        </div>
      )}

      {notice && <div className={styles.notice} role="status"><Check size={15} aria-hidden="true" />{notice}</div>}
      {error && <div className={styles.error} role="alert"><span aria-hidden="true">!</span><p>{error}</p><button type="button" onClick={() => void refresh()}>Try again</button></div>}
      {loading ? (
        <div className={styles.loading} role="status"><span /><span /><span /><p>Loading secure updates…</p></div>
      ) : error && notifications.length === 0 ? null : notifications.length === 0 ? (
        <EmptyState title="You’re up to date" text="New payment, license, support, and security updates will appear here when Orion records them." />
      ) : filtered.length === 0 ? (
        <EmptyState title={`No ${filters.find((option) => option.id === filter)?.label.toLowerCase()} updates`} text="Choose another filter to view the rest of your account activity." />
      ) : (
        <>
          <ol className={styles.list} id="notification-list">
            {visible.map((notification) => {
              const unread = !notification.read_at;
              const tone = kindTone(notification.kind);
              return (
                <li className={`${styles.item} ${unread ? styles.unread : ''}`} key={notification.id}>
                  <span className={styles.kind} data-kind={tone} aria-hidden="true"><KindIcon tone={tone} /></span>
                  <div className={styles.copy}>
                    <div><strong>{notification.title}</strong>{unread && <i>New</i>}</div>
                    <p>{notification.message}</p>
                    <time dateTime={notification.created_at}>{formatTime(notification.created_at)}</time>
                  </div>
                  <div className={styles.actions}>
                    {safeNotificationHref(notification.href) && <button className={styles.openButton} type="button" onClick={() => void openNotification(notification)}><ExternalLink size={14} aria-hidden="true" />Open</button>}
                    <button type="button" disabled={updating !== null} onClick={() => void markNotification(notification.id, unread)}>{updating === notification.id ? 'Saving…' : unread ? <><Check size={14} aria-hidden="true" />Mark read</> : 'Mark unread'}</button>
                  </div>
                </li>
              );
            })}
          </ol>
          {hiddenCount > 0 && <button className={styles.showMore} type="button" aria-expanded={false} aria-controls="notification-list" onClick={() => setExpanded(true)}>Show {hiddenCount} older update{hiddenCount === 1 ? '' : 's'} <ChevronDown size={14} aria-hidden="true" /></button>}
          {expanded && filtered.length > 5 && <button className={styles.showMore} type="button" aria-expanded aria-controls="notification-list" onClick={() => setExpanded(false)}>Show recent updates</button>}
        </>
      )}
    </section>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className={styles.empty} role="status"><span aria-hidden="true"><Inbox size={22} /></span><strong>{title}</strong><p>{text}</p></div>;
}

function KindIcon({ tone }: { tone: ReturnType<typeof kindTone> }) {
  if (tone === 'license') return <KeyRound size={18} />;
  if (tone === 'billing') return <CreditCard size={18} />;
  if (tone === 'support') return <Headphones size={18} />;
  if (tone === 'security') return <ShieldCheck size={18} />;
  return <Sparkles size={18} />;
}

function kindTone(kind: string) {
  const value = kind.toLowerCase();
  if (value.includes('license')) return 'license' as const;
  if (value.includes('payment') || value.includes('billing')) return 'billing' as const;
  if (value.includes('support') || value.includes('ticket')) return 'support' as const;
  if (value.includes('security') || value.includes('password') || value.includes('session')) return 'security' as const;
  return 'account' as const;
}

function matchesFilter(notification: PortalNotification, filter: NotificationFilter) {
  if (filter === 'all') return true;
  if (filter === 'unread') return !notification.read_at;
  return kindTone(notification.kind) === filter;
}

function filterCount(notifications: PortalNotification[], filter: NotificationFilter) {
  return notifications.filter((notification) => matchesFilter(notification, filter)).length;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
