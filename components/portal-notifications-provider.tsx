'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type PortalNotification = {
  id: string;
  kind: string;
  title: string;
  message: string;
  href: string | null;
  ticketId: string | null;
  read_at: string | null;
  created_at: string;
};

type NotificationResponse = {
  notifications: PortalNotification[];
  unreadCount: number;
};

type NotificationContextValue = NotificationResponse & {
  loading: boolean;
  refreshing: boolean;
  error: string;
  notice: string;
  updating: string | null;
  refresh: () => Promise<void>;
  markNotification: (id: string, read: boolean) => Promise<boolean>;
  markMany: (ids: string[], read?: boolean) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  openNotification: (notification: PortalNotification) => Promise<void>;
  clearFeedback: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

type PortalNotificationsProviderProps = {
  children: ReactNode;
  limit?: number;
};

export function PortalNotificationsProvider({ children, limit = 30 }: PortalNotificationsProviderProps) {
  const [data, setData] = useState<NotificationResponse>({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadedRef = useRef(false);
  const requestRef = useRef<Promise<void> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mutationVersionRef = useRef(0);

  const load = useCallback((quiet = false) => {
    if (requestRef.current) return requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!quiet || !loadedRef.current) setLoading(true);
    else setRefreshing(true);
    if (!quiet) {
      setError('');
      setNotice('');
    }
    const mutationVersion = mutationVersionRef.current;

    const request = (async () => {
      try {
        const response = await fetch(`/api/notifications?limit=${Math.min(100, Math.max(1, limit))}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as NotificationResponse | { error?: string } | null;
        if (!response.ok || !payload || !('notifications' in payload)) {
          throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load notifications.');
        }
        if (!mountedRef.current) return;
        if (mutationVersion === mutationVersionRef.current) {
          setData({
            unreadCount: payload.unreadCount,
            notifications: payload.notifications.map((notification) => ({ ...notification, ticketId: notification.ticketId ?? null })),
          });
        }
        loadedRef.current = true;
        setError('');
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (mountedRef.current && (!quiet || !loadedRef.current)) {
          setError(reason instanceof Error ? reason.message : 'Unable to load notifications.');
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          requestRef.current = null;
        }
      }
    })();
    requestRef.current = request;
    return request;
  }, [limit]);

  useEffect(() => {
    mountedRef.current = true;
    void load();

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') void load(true);
    }

    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestRef.current = null;
    };
  }, [load]);

  const updateReadState = useCallback(async (target: string | string[] | undefined, read: boolean) => {
    const ids = Array.isArray(target) ? target : null;
    const id = typeof target === 'string' ? target : undefined;
    if (ids && ids.length === 0) return true;
    if (requestRef.current) await requestRef.current;
    mutationVersionRef.current += 1;
    setUpdating(ids ? 'many' : id || 'all');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ids ? { ids, read } : id ? { id, read } : { all: true, read }),
      });
      const payload = await response.json().catch(() => null) as { unreadCount?: number; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to update notifications.');
      const readAt = read ? new Date().toISOString() : null;
      setData((current) => ({
        unreadCount: typeof payload?.unreadCount === 'number' ? payload.unreadCount : current.unreadCount,
        notifications: current.notifications.map((item) => ((!id && !ids) || item.id === id || ids?.includes(item.id)) ? { ...item, read_at: readAt } : item),
      }));
      setNotice(ids
        ? `${ids.length} update${ids.length === 1 ? '' : 's'} marked as ${read ? 'read' : 'unread'}.`
        : id ? read ? 'Update marked as read.' : 'Update marked as unread.' : 'All updates marked as read.');
      if (typeof payload?.unreadCount !== 'number') void load(true);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update notifications.');
      return false;
    } finally {
      mutationVersionRef.current += 1;
      setUpdating(null);
    }
  }, [load]);

  const markNotification = useCallback((id: string, read: boolean) => updateReadState(id, read), [updateReadState]);
  const markMany = useCallback((ids: string[], read = true) => updateReadState([...new Set(ids)].slice(0, 100), read), [updateReadState]);
  const markAllRead = useCallback(() => updateReadState(undefined, true), [updateReadState]);
  const openNotification = useCallback(async (notification: PortalNotification) => {
    const destination = safeNotificationHref(notification.href);
    if (!destination) return;
    try {
      if (!notification.read_at) await updateReadState(notification.id, true);
    } finally {
      navigateToNotification(destination);
    }
  }, [updateReadState]);
  const refresh = useCallback(() => load(false), [load]);
  const clearFeedback = useCallback(() => {
    setError('');
    setNotice('');
  }, []);

  const value = useMemo<NotificationContextValue>(() => ({
    ...data,
    loading,
    refreshing,
    error,
    notice,
    updating,
    refresh,
    markNotification,
    markMany,
    markAllRead,
    openNotification,
    clearFeedback,
  }), [clearFeedback, data, error, loading, markAllRead, markMany, markNotification, notice, openNotification, refresh, refreshing, updating]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function usePortalNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('usePortalNotifications must be used inside PortalNotificationsProvider.');
  return value;
}

export function safeNotificationHref(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://portal.invalid');
    if (url.origin !== 'https://portal.invalid') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function navigateToNotification(destination: string) {
  const target = new URL(destination, window.location.origin);
  if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search && target.hash) {
    window.location.hash = target.hash;
    return;
  }
  window.location.assign(destination);
}
