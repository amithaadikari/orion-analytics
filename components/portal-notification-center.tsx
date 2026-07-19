'use client';

import { useCallback, useEffect, useState } from 'react';
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

export default function PortalNotificationCenter({ limit = 30, className = '' }: { limit?: number; className?: string }) {
  const [data, setData] = useState<NotificationResponse>({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
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

  async function updateReadState(id: string | undefined, read: boolean, destination?: string | null) {
    setUpdating(id || 'all');
    setError('');
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
      if (destination) window.location.assign(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update notifications.');
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section className={`${styles.center} ${className}`.trim()} id="notifications" aria-labelledby="portal-notifications-title" aria-busy={loading}>
      <header className={styles.header}>
        <div>
          <p>Client updates</p>
          <h2 id="portal-notifications-title">Notification center</h2>
          <span>License, payment, and support updates from your secure Orion account.</span>
        </div>
        <div className={styles.headerActions}>
          <strong aria-label={`${data.unreadCount} unread notifications`}>{data.unreadCount}<small>Unread</small></strong>
          {data.unreadCount > 0 && <button type="button" disabled={updating !== null} onClick={() => void updateReadState(undefined, true)}>{updating === 'all' ? 'Updating…' : 'Mark all read'}</button>}
          <button type="button" disabled={loading || updating !== null} onClick={() => void load()} aria-label="Refresh notifications">↻</button>
        </div>
      </header>

      {error && <div className={styles.error} role="alert"><span aria-hidden="true">!</span><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
      {loading ? (
        <div className={styles.loading} role="status"><span /><span /><span /><p>Loading secure notifications…</p></div>
      ) : data.notifications.length ? (
        <ol className={styles.list} aria-live="polite">
          {data.notifications.map((notification) => {
            const unread = !notification.read_at;
            return (
              <li className={`${styles.item} ${unread ? styles.unread : ''}`} key={notification.id}>
                <span className={styles.kind} data-kind={notification.kind.toLowerCase()} aria-hidden="true">{kindIcon(notification.kind)}</span>
                <div className={styles.copy}>
                  <div><strong>{notification.title}</strong>{unread && <i>New</i>}</div>
                  <p>{notification.message}</p>
                  <time dateTime={notification.created_at}>{formatTime(notification.created_at)}</time>
                </div>
                <div className={styles.actions}>
                  {notification.href && <button type="button" disabled={updating !== null} onClick={() => void updateReadState(notification.id, true, notification.href)}>Open <span aria-hidden="true">→</span></button>}
                  <button type="button" disabled={updating !== null} onClick={() => void updateReadState(notification.id, unread)}>{updating === notification.id ? 'Saving…' : unread ? 'Mark read' : 'Mark unread'}</button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.empty} role="status"><span aria-hidden="true">✓</span><strong>You’re up to date</strong><p>New account updates will appear here when Orion records them.</p></div>
      )}
    </section>
  );
}

function kindIcon(kind: string) {
  const value = kind.toLowerCase();
  if (value.includes('license')) return '◇';
  if (value.includes('payment')) return '▣';
  if (value.includes('support')) return '◎';
  return '✦';
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
