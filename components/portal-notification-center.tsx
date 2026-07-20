'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Sparkles,
} from 'lucide-react';
import styles from './portal-notification-center.module.css';

type Notification = {
  id: string;
  kind: string;
  title: string;
  message: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

type NotificationResponse = { notifications: Notification[]; unreadCount: number };
type NotificationFilter = 'all' | 'unread' | 'billing' | 'license' | 'support';
type NotificationSummary = { unreadCount: number; totalCount: number; loaded: boolean };

const filters: { id: NotificationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'license', label: 'Licenses' },
  { id: 'billing', label: 'Billing' },
  { id: 'support', label: 'Support' },
];

type PortalNotificationCenterProps = {
  limit?: number;
  className?: string;
  embedded?: boolean;
  onSummaryChange?: (summary: NotificationSummary) => void;
};

export default function PortalNotificationCenter({ limit = 30, className = '', embedded = false, onSummaryChange }: PortalNotificationCenterProps) {
  const [data, setData] = useState<NotificationResponse>({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/notifications?limit=${Math.min(100, Math.max(1, limit))}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const payload = await response.json().catch(() => null) as NotificationResponse | { error?: string } | null;
      if (!response.ok || !payload || !('notifications' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load notifications.');
      setData(payload);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to load notifications.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    onSummaryChange?.({ unreadCount: data.unreadCount, totalCount: data.notifications.length, loaded: !loading && !error });
  }, [data.notifications.length, data.unreadCount, error, loading, onSummaryChange]);

  const filtered = useMemo(() => data.notifications.filter((notification) => matchesFilter(notification, filter)), [data.notifications, filter]);
  const visible = expanded ? filtered : filtered.slice(0, 5);
  const hiddenCount = filtered.length - visible.length;

  function selectFilter(nextFilter: NotificationFilter) {
    setFilter(nextFilter);
    setExpanded(false);
  }

  async function updateReadState(id: string | undefined, read: boolean, destination?: string | null) {
    setUpdating(id || 'all');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(id ? { id, read } : { all: true, read }),
      });
      const payload = await response.json().catch(() => null) as { unreadCount?: number; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to update notifications.');
      const readAt = read ? new Date().toISOString() : null;
      setData((current) => ({
        unreadCount: typeof payload?.unreadCount === 'number' ? payload.unreadCount : current.unreadCount,
        notifications: current.notifications.map((item) => !id || item.id === id ? { ...item, read_at: readAt } : item),
      }));
      setNotice(id ? read ? 'Update marked as read.' : 'Update marked as unread.' : 'All updates marked as read.');
      if (destination) navigateTo(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update notifications.');
    } finally {
      setUpdating(null);
    }
  }

  const headingId = embedded ? undefined : 'portal-notifications-title';
  return (
    <section className={`${styles.center} ${embedded ? styles.embedded : ''} ${className}`.trim()} id={embedded ? undefined : 'notifications'} aria-labelledby={headingId} aria-label={embedded ? 'Account notifications' : undefined} aria-busy={loading}>
      <header className={styles.header}>
        {embedded ? (
          <div className={styles.compactTitle}><span aria-hidden="true"><Bell size={18} /></span><div><small>Account timeline</small><strong>Recent Orion updates</strong></div></div>
        ) : (
          <div><p>Client updates</p><h2 id={headingId}>Notification center</h2><span>Payment, license, and support updates from your secure Orion account.</span></div>
        )}
        <div className={styles.headerActions}>
          <strong className={styles.unreadCount} aria-label={`${data.unreadCount} unread notifications`}>{data.unreadCount}<small>Unread</small></strong>
          {data.unreadCount > 0 && <button type="button" disabled={updating !== null} onClick={() => void updateReadState(undefined, true)}><CheckCheck size={14} aria-hidden="true" />{updating === 'all' ? 'Updating…' : 'Mark all read'}</button>}
          <button className={styles.iconButton} type="button" disabled={loading || updating !== null} onClick={() => void load()} aria-label="Refresh notifications"><RefreshCw size={16} aria-hidden="true" /></button>
        </div>
      </header>

      {!loading && data.notifications.length > 0 && (
        <div className={styles.filters} role="group" aria-label="Filter account updates">
          {filters.map((option) => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => selectFilter(option.id)}>{option.label}<span>{filterCount(data.notifications, option.id)}</span></button>)}
        </div>
      )}

      {notice && <div className={styles.notice} role="status"><Check size={15} aria-hidden="true" />{notice}</div>}
      {error && <div className={styles.error} role="alert"><span aria-hidden="true">!</span><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
      {loading ? (
        <div className={styles.loading} role="status"><span /><span /><span /><p>Loading secure updates…</p></div>
      ) : error && data.notifications.length === 0 ? null : data.notifications.length === 0 ? (
        <EmptyState title="You’re up to date" text="New payment, license, and support updates will appear here when Orion records them." />
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
                    {notification.href && <button className={styles.openButton} type="button" disabled={updating !== null} onClick={() => void updateReadState(notification.id, true, notification.href)}><ExternalLink size={14} aria-hidden="true" />Open</button>}
                    <button type="button" disabled={updating !== null} onClick={() => void updateReadState(notification.id, unread)}>{updating === notification.id ? 'Saving…' : unread ? <><Check size={14} aria-hidden="true" />Mark read</> : 'Mark unread'}</button>
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
  return <Sparkles size={18} />;
}

function kindTone(kind: string) {
  const value = kind.toLowerCase();
  if (value.includes('license')) return 'license' as const;
  if (value.includes('payment') || value.includes('billing')) return 'billing' as const;
  if (value.includes('support') || value.includes('ticket')) return 'support' as const;
  return 'account' as const;
}

function matchesFilter(notification: Notification, filter: NotificationFilter) {
  if (filter === 'all') return true;
  if (filter === 'unread') return !notification.read_at;
  return kindTone(notification.kind) === filter;
}

function filterCount(notifications: Notification[], filter: NotificationFilter) {
  return notifications.filter((notification) => matchesFilter(notification, filter)).length;
}

function navigateTo(destination: string) {
  const target = new URL(destination, window.location.origin);
  if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search && target.hash) {
    window.location.hash = target.hash;
    return;
  }
  window.location.assign(destination);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
