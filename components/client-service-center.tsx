'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Headphones, Plus, ShieldCheck } from 'lucide-react';
import PortalNotificationCenter from '@/components/portal-notification-center';
import { usePortalNotifications } from '@/components/portal-notifications-provider';
import SupportTicketCenter from '@/components/support-ticket-center';
import styles from './client-service-center.module.css';

type ServiceView = 'updates' | 'support';
type NotificationSummary = { unreadCount: number; totalCount: number; loaded: boolean };
type TicketSummary = { activeCount: number; totalCount: number; loaded: boolean };

export default function ClientServiceCenter() {
  const { notifications: notificationItems, markMany } = usePortalNotifications();
  const [view, setView] = useState<ServiceView>('updates');
  const [newTicketRequest, setNewTicketRequest] = useState(0);
  const [notifications, setNotifications] = useState<NotificationSummary>({ unreadCount: 0, totalCount: 0, loaded: false });
  const [tickets, setTickets] = useState<TicketSummary>({ activeCount: 0, totalCount: 0, loaded: false });
  const unreadRepliesByTicket = useMemo(() => notificationItems.reduce<Record<string, string[]>>((groups, notification) => {
    if (notification.read_at || !notification.ticketId) return groups;
    (groups[notification.ticketId] ||= []).push(notification.id);
    return groups;
  }, {}), [notificationItems]);

  const openView = useCallback((nextView: ServiceView, createTicket = false, updateAddress = true, focusPanel = false) => {
    const target = nextView === 'updates' ? 'notifications' : 'support';
    setView(nextView);
    if (createTicket) setNewTicketRequest((value) => value + 1);
    if (updateAddress && typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${target}`);
    }
    if (typeof window !== 'undefined') {
      const reveal = () => {
        const panel = document.getElementById(target);
        if (focusPanel) panel?.focus({ preventScroll: true });
        panel?.scrollIntoView?.({ block: 'start' });
      };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(reveal);
      else reveal();
    }
  }, []);

  useEffect(() => {
    function syncFromHash() {
      const hash = window.location.hash.slice(1);
      if (hash === 'support') openView('support', false, false, true);
      if (hash === 'notifications') openView('updates', false, false, true);
    }
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [openView]);

  return (
    <section className={styles.center} aria-labelledby="client-service-title">
      <header className={styles.heading}>
        <div className={styles.headingCopy}>
          <p className="eyebrow">Client service</p>
          <h2 id="client-service-title">Updates & Support Center</h2>
          <span>Follow important Orion account activity and speak with official support from one secure workspace.</span>
        </div>
        <div className={styles.summary} aria-label="Client service summary">
          <span data-tone={notifications.unreadCount ? 'new' : 'quiet'}><Bell size={16} aria-hidden="true" /><strong>{notifications.loaded ? notifications.unreadCount : '—'}</strong><small>Unread</small></span>
          <span data-tone={tickets.activeCount ? 'active' : 'quiet'}><Headphones size={16} aria-hidden="true" /><strong>{tickets.loaded ? tickets.activeCount : '—'}</strong><small>Recent active</small></span>
        </div>
        <button className={styles.newTicketButton} type="button" onClick={() => openView('support', true)}><Plus size={16} aria-hidden="true" />New support ticket</button>
        <strong className={styles.marker} aria-hidden="true">04</strong>
      </header>

      <div className={styles.securityLine}><ShieldCheck size={14} aria-hidden="true" /><span>Private account updates and official Orion support conversations</span></div>

      <div className={styles.tabs} role="group" aria-label="Updates and support">
        <button id="service-updates-tab" type="button" aria-label="Open account updates" aria-pressed={view === 'updates'} aria-controls="notifications" onClick={() => openView('updates')}>
          <span aria-hidden="true"><Bell size={16} /></span><strong>Account updates</strong><small>{notifications.loaded ? `${notifications.totalCount} recent` : 'Loading'}</small>{notifications.unreadCount > 0 && <b>{notifications.unreadCount}</b>}
        </button>
        <button id="service-support-tab" type="button" aria-label="Open support tickets" aria-pressed={view === 'support'} aria-controls="support" onClick={() => openView('support')}>
          <span aria-hidden="true"><Headphones size={16} /></span><strong>Support tickets</strong><small>{tickets.loaded ? `${tickets.totalCount} recent` : 'Loading'}</small>{tickets.activeCount > 0 && <b>{tickets.activeCount}</b>}
        </button>
      </div>

      <div className={styles.panel} id="notifications" role="region" aria-labelledby="service-updates-tab" hidden={view !== 'updates'} tabIndex={-1}>
        <PortalNotificationCenter embedded onSummaryChange={setNotifications} />
      </div>
      <div className={styles.panel} id="support" role="region" aria-labelledby="service-support-tab" hidden={view !== 'support'} tabIndex={-1}>
        <SupportTicketCenter
          portalEmbedded
          active={view === 'support'}
          newTicketRequest={newTicketRequest}
          onSummaryChange={setTickets}
          onReadNotifications={markMany}
          externalUnreadReplyNotifications={unreadRepliesByTicket}
        />
      </div>
    </section>
  );
}
