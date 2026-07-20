'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Headphones,
  Inbox,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  TicketCheck,
  X,
} from 'lucide-react';
import styles from './support-ticket-center.module.css';

type TicketMessage = { id: string; authorType: 'Client' | 'Admin' | 'System'; body: string; createdAt: string };
type Ticket = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  client?: { fullName: string; email: string | null } | null;
  messages: TicketMessage[];
};
type TicketPageInfo = { hasMore: boolean; nextCursor: string | null };
type TicketResponse = {
  actor: { type: 'client' | 'admin'; canManage: boolean };
  tickets: Ticket[];
  unreadReplyNotifications: Record<string, string[]>;
  pageInfo: TicketPageInfo;
};
type TicketFilter = 'active' | 'waiting' | 'resolved' | 'closed' | 'all';
type TicketSummary = { activeCount: number; totalCount: number; loaded: boolean };

const categories = ['General', 'License', 'Payment', 'Setup', 'Technical'];
const priorities = ['Low', 'Normal', 'High', 'Urgent'];
const statuses = ['Open', 'Waiting on client', 'In progress', 'Resolved', 'Closed'];
const ticketFilters: { id: TicketFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'waiting', label: 'Reply needed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

type SupportTicketCenterProps = {
  className?: string;
  embedded?: boolean;
  portalEmbedded?: boolean;
  active?: boolean;
  newTicketRequest?: number;
  onSummaryChange?: (summary: TicketSummary) => void;
  onReadNotifications?: (ids: string[]) => Promise<boolean | void>;
  externalUnreadReplyNotifications?: Record<string, string[]>;
};

const emptyPageInfo: TicketPageInfo = { hasMore: false, nextCursor: null };
const emptyUnreadReplies: Record<string, string[]> = {};

export default function SupportTicketCenter({ className = '', embedded = false, portalEmbedded = false, active = false, newTicketRequest = 0, onSummaryChange, onReadNotifications, externalUnreadReplyNotifications = emptyUnreadReplies }: SupportTicketCenterProps) {
  const [data, setData] = useState<TicketResponse>({ actor: { type: 'client', canManage: false }, tickets: [], unreadReplyNotifications: {}, pageInfo: emptyPageInfo });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [reply, setReply] = useState('');
  const [manageStatus, setManageStatus] = useState('Open');
  const [managePriority, setManagePriority] = useState('Normal');
  const [filter, setFilter] = useState<TicketFilter>('active');
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const ticketButtons = useRef(new Map<string, HTMLButtonElement>());
  const mobileBackButton = useRef<HTMLButtonElement>(null);
  const lastOpenedTicket = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const quietRefreshInFlight = useRef(false);
  const readNotificationsInFlight = useRef(new Set<string>());
  const wasActive = useRef(active);
  const endpoint = portalEmbedded ? '/api/support-tickets?scope=self' : '/api/support-tickets';
  const listEndpoint = portalEmbedded ? '/api/support-tickets?scope=self&limit=12' : '/api/support-tickets';

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const ticketQuery = portalEmbedded ? readPortalTicketQuery() : { present: false, id: null };
      if (ticketQuery.present && !ticketQuery.id) cleanPortalTicketQuery();
      const isNewLinkedTarget = Boolean(ticketQuery.id && ticketQuery.id !== selectedIdRef.current);
      const preferredId = ticketQuery.id || (portalEmbedded ? selectedIdRef.current : null);
      const firstPage = await requestTickets(listEndpoint, signal);
      let exactTicket: TicketResponse | null = null;
      if (portalEmbedded && preferredId && !firstPage.tickets.some((ticket) => ticket.id === preferredId)) {
        exactTicket = await requestTickets(`${listEndpoint}&ticketId=${encodeURIComponent(preferredId)}`, signal);
      }

      const preferredTicket = firstPage.tickets.find((ticket) => ticket.id === preferredId)
        || exactTicket?.tickets.find((ticket) => ticket.id === preferredId)
        || null;
      if (ticketQuery.id && !preferredTicket) cleanPortalTicketQuery();

      const freshData: TicketResponse = {
        actor: firstPage.actor,
        tickets: mergeTickets(firstPage.tickets, exactTicket?.tickets || []),
        unreadReplyNotifications: mergeUnreadReplies(firstPage.unreadReplyNotifications, exactTicket?.unreadReplyNotifications || {}),
        pageInfo: firstPage.pageInfo,
      };
      setData((current) => {
        if (!quiet) return freshData;
        const refreshedTicketIds = new Set(freshData.tickets.map((ticket) => ticket.id));
        const retainedUnread = Object.fromEntries(Object.entries(current.unreadReplyNotifications)
          .filter(([ticketId]) => !refreshedTicketIds.has(ticketId)));
        return {
          ...freshData,
          tickets: mergeTickets(freshData.tickets, current.tickets),
          unreadReplyNotifications: mergeUnreadReplies(retainedUnread, freshData.unreadReplyNotifications),
          pageInfo: current.tickets.length > freshData.tickets.length ? current.pageInfo : freshData.pageInfo,
        };
      });
      setHasLoaded(true);
      const selectableTickets = freshData.tickets;
      const nextSelectedId = preferredTicket?.id
        || (selectedIdRef.current && selectableTickets.some((ticket) => ticket.id === selectedIdRef.current) ? selectedIdRef.current : null)
        || [...selectableTickets].sort((left, right) => waitPriority(left.status, firstPage.actor.type === 'client') - waitPriority(right.status, firstPage.actor.type === 'client') || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]?.id
        || null;
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
      if (isNewLinkedTarget && preferredTicket) {
        setFilter(filterForLinkedTicket(preferredTicket.status));
        lastOpenedTicket.current = preferredTicket.id;
        if (isMobileTicketLayout()) setMobileThreadOpen(true);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to load support tickets.');
    } finally {
      if (!signal?.aborted && !quiet) setLoading(false);
    }
  }, [listEndpoint, portalEmbedded]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refreshQuietly = useCallback(async () => {
    if (quietRefreshInFlight.current) return;
    quietRefreshInFlight.current = true;
    try {
      await load(undefined, true);
    } finally {
      quietRefreshInFlight.current = false;
    }
  }, [load]);

  useEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
    if (portalEmbedded && becameActive && hasLoaded) void refreshQuietly();
  }, [active, hasLoaded, portalEmbedded, refreshQuietly]);

  useEffect(() => {
    if (!portalEmbedded) return;
    const refreshWhenVisible = () => {
      if (active && (typeof document === 'undefined' || document.visibilityState === 'visible')) void refreshQuietly();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [active, portalEmbedded, refreshQuietly]);

  useEffect(() => {
    if (newTicketRequest > 0) {
      setShowNew(true);
      setMobileThreadOpen(false);
    }
  }, [newTicketRequest]);

  const activeCount = data.tickets.filter((ticket) => !['Resolved', 'Closed'].includes(ticket.status)).length;
  useEffect(() => {
    onSummaryChange?.({ activeCount, totalCount: data.tickets.length, loaded: !loading && !error });
  }, [activeCount, data.tickets.length, error, loading, onSummaryChange]);

  const visibleTickets = useMemo(() => data.tickets
    .filter((ticket) => matchesTicketFilter(ticket.status, filter))
    .sort((left, right) => waitPriority(left.status, portalEmbedded || data.actor.type === 'client') - waitPriority(right.status, portalEmbedded || data.actor.type === 'client') || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [data.actor.type, data.tickets, filter, portalEmbedded]);
  const selected = useMemo(() => data.tickets.find((ticket) => ticket.id === selectedId) || null, [data.tickets, selectedId]);
  const visibleUnreadReplies = useMemo(() => mergeUnreadReplies(data.unreadReplyNotifications, externalUnreadReplyNotifications), [data.unreadReplyNotifications, externalUnreadReplyNotifications]);

  useEffect(() => {
    if (!visibleTickets.length) {
      selectedIdRef.current = null;
      setSelectedId(null);
      setMobileThreadOpen(false);
      return;
    }
    if (!selectedId || !visibleTickets.some((ticket) => ticket.id === selectedId)) {
      selectedIdRef.current = visibleTickets[0].id;
      setSelectedId(visibleTickets[0].id);
      setMobileThreadOpen(false);
    }
  }, [selectedId, visibleTickets]);

  useEffect(() => {
    setReply('');
    setConfirmClose(false);
  }, [selectedId]);
  useEffect(() => {
    if (!selected) return;
    setManageStatus(selected.status);
    setManagePriority(selected.priority);
  }, [selected]);

  useEffect(() => {
    if (!portalEmbedded || !active || !selectedId || readPortalTicketQuery().id) return;
    setPortalTicketUrl(selectedId);
  }, [active, portalEmbedded, selectedId]);

  useEffect(() => {
    if (!portalEmbedded || !active || !selectedId || !onReadNotifications) return;
    if (isMobileTicketLayout() && !mobileThreadOpen) return;
    const notificationIds = visibleUnreadReplies[selectedId] || [];
    if (!notificationIds.length) return;
    const uniqueIds = [...new Set(notificationIds)];
    const requestKey = `${selectedId}:${[...uniqueIds].sort().join(',')}`;
    if (readNotificationsInFlight.current.has(requestKey)) return;
    readNotificationsInFlight.current.add(requestKey);
    void onReadNotifications(uniqueIds)
      .then((result) => {
        if (result === false) return;
        const markedIds = new Set(uniqueIds);
        setData((current) => {
          const unreadForTicket = current.unreadReplyNotifications[selectedId] || [];
          const remaining = unreadForTicket.filter((id) => !markedIds.has(id));
          if (remaining.length === unreadForTicket.length) return current;
          const nextUnread = { ...current.unreadReplyNotifications };
          if (remaining.length) nextUnread[selectedId] = remaining;
          else delete nextUnread[selectedId];
          return { ...current, unreadReplyNotifications: nextUnread };
        });
      })
      .catch(() => undefined)
      .finally(() => readNotificationsInFlight.current.delete(requestKey));
  }, [active, mobileThreadOpen, onReadNotifications, portalEmbedded, selectedId, visibleUnreadReplies]);

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy('create');
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: fields.get('subject'),
          category: fields.get('category'),
          priority: fields.get('priority'),
          message: fields.get('message'),
        }),
      });
      const payload = await response.json().catch(() => null) as { ticketId?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to create the support ticket.');
      form.reset();
      setShowNew(false);
      setFilter('active');
      setNotice('Your ticket was sent securely to Orion support.');
      if (payload?.ticketId && portalEmbedded) {
        selectedIdRef.current = payload.ticketId;
        setPortalTicketUrl(payload.ticketId);
      }
      await load(undefined, true);
      if (payload?.ticketId) {
        selectedIdRef.current = payload.ticketId;
        setSelectedId(payload.ticketId);
        setMobileThreadOpen(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the support ticket.');
    } finally {
      setBusy('');
    }
  }

  async function patchTicket(update: { message?: string; status?: string; priority?: string }, success: string) {
    if (!selected) return;
    setBusy(update.message ? 'reply' : 'manage');
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: selected.id, ...update }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to update the support ticket.');
      setReply('');
      setConfirmClose(false);
      setNotice(success);
      await load(undefined, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the support ticket.');
    } finally {
      setBusy('');
    }
  }

  async function loadOlderTickets() {
    const cursor = data.pageInfo.nextCursor;
    if (!portalEmbedded || !data.pageInfo.hasMore || !cursor || busy) return;
    setBusy('older');
    setError('');
    try {
      const olderPage = await requestTickets(`${listEndpoint}&cursor=${encodeURIComponent(cursor)}`);
      setData((current) => ({
        actor: olderPage.actor,
        tickets: mergeTickets(current.tickets, olderPage.tickets),
        unreadReplyNotifications: mergeUnreadReplies(current.unreadReplyNotifications, olderPage.unreadReplyNotifications),
        pageInfo: olderPage.pageInfo,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load older support tickets.');
    } finally {
      setBusy('');
    }
  }

  function selectFilter(nextFilter: TicketFilter) {
    setFilter(nextFilter);
    setMobileThreadOpen(false);
    const currentTicket = data.tickets.find((ticket) => ticket.id === selectedId && matchesTicketFilter(ticket.status, nextFilter));
    const nextTicket = currentTicket || data.tickets
      .filter((ticket) => matchesTicketFilter(ticket.status, nextFilter))
      .sort((left, right) => waitPriority(left.status, portalEmbedded || data.actor.type === 'client') - waitPriority(right.status, portalEmbedded || data.actor.type === 'client') || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (nextTicket && nextTicket.id !== selectedId) {
      selectedIdRef.current = nextTicket.id;
      setSelectedId(nextTicket.id);
      if (portalEmbedded) setPortalTicketUrl(nextTicket.id);
    } else if (!nextTicket) {
      selectedIdRef.current = null;
      setSelectedId(null);
      if (portalEmbedded) cleanPortalTicketQuery();
    }
  }

  function openTicket(ticketId: string) {
    selectedIdRef.current = ticketId;
    setSelectedId(ticketId);
    setMobileThreadOpen(true);
    lastOpenedTicket.current = ticketId;
    if (portalEmbedded) setPortalTicketUrl(ticketId);
    if (isMobileTicketLayout()) focusAfterRender(() => mobileBackButton.current);
  }

  function closeMobileThread() {
    setMobileThreadOpen(false);
    const ticketId = lastOpenedTicket.current;
    if (ticketId && isMobileTicketLayout()) focusAfterRender(() => ticketButtons.current.get(ticketId) || null);
  }

  const headingId = portalEmbedded ? undefined : 'support-center-title';
  return (
    <section className={`${styles.center} ${embedded ? styles.adminEmbedded : ''} ${portalEmbedded ? styles.portalEmbedded : ''} ${className}`.trim()} id={portalEmbedded ? undefined : 'support'} aria-labelledby={headingId} aria-label={portalEmbedded ? 'Support tickets' : undefined} aria-busy={loading}>
      <header className={styles.header}>
        {portalEmbedded ? (
          <div className={styles.compactTitle}><span aria-hidden="true"><Headphones size={18} /></span><div><small>Official assistance</small><strong>Secure support conversations</strong></div></div>
        ) : embedded ? <h2 className="orion-visually-hidden" id={headingId}>Ticket workspace</h2> : <div><p>Official assistance</p><h2 id={headingId}>Support tickets</h2><span>Keep setup, license, and payment questions inside your secure Orion workspace.</span></div>}
        <div className={styles.headerActions}>
          <strong>{activeCount}<small>{data.pageInfo.hasMore ? 'Loaded active' : 'Active tickets'}</small></strong>
          {hasLoaded && data.actor.type === 'client' && <button type="button" onClick={() => setShowNew((value) => !value)}>{showNew ? <><X size={15} aria-hidden="true" />Cancel</> : <><Plus size={15} aria-hidden="true" />New ticket</>}</button>}
          <button className={styles.iconButton} type="button" disabled={loading || Boolean(busy)} onClick={() => void load()} aria-label="Refresh support tickets"><RefreshCw size={16} aria-hidden="true" /></button>
        </div>
      </header>

      {notice && <div className={styles.notice} role="status"><Check size={15} aria-hidden="true" />{notice}</div>}
      {error && <div className={styles.error} role="alert"><CircleAlert size={16} aria-hidden="true" /><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}

      {showNew && hasLoaded && !loading && data.actor.type === 'client' && (
        <form className={styles.newTicket} onSubmit={createTicket} aria-busy={busy === 'create'}>
          <header><div><span aria-hidden="true"><MessageSquare size={18} /></span><div><small>New request</small><strong>Tell Orion how we can help</strong></div></div><button type="button" onClick={() => setShowNew(false)} aria-label="Close new ticket form"><X size={16} aria-hidden="true" /></button></header>
          <label>Subject<input name="subject" required minLength={4} maxLength={180} placeholder="A short summary of the problem" /></label>
          <div className={styles.formOptions}><label>Category<select name="category" defaultValue="General">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Priority<select name="priority" defaultValue="Normal">{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label></div>
          <label>Message<textarea name="message" required maxLength={4000} rows={5} placeholder="Include your platform, the exact problem, and any steps already tried." /></label>
          <footer><span><ShieldCheck size={14} aria-hidden="true" />Sent only to official Orion support</span><button type="submit" disabled={Boolean(busy)}>{busy === 'create' ? 'Sending…' : 'Send secure ticket'}<Send size={15} aria-hidden="true" /></button></footer>
        </form>
      )}

      {!loading && data.tickets.length > 0 && (
        <div className={styles.filters} role="group" aria-label="Filter loaded support tickets">
          {ticketFilters.map((option) => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => selectFilter(option.id)}>{option.label}<span>{ticketFilterCount(data.tickets, option.id)}</span></button>)}
        </div>
      )}

      {loading ? (
        <div className={styles.loading} role="status"><span /><span /><p>Loading your support workspace…</p></div>
      ) : error && data.tickets.length === 0 ? null : data.tickets.length === 0 ? (
        <EmptyTickets onCreate={data.actor.type === 'client' ? () => setShowNew(true) : undefined} />
      ) : visibleTickets.length === 0 ? (
        <div className={styles.filterEmpty} role="status"><Inbox size={21} aria-hidden="true" /><div><strong>No {ticketFilters.find((option) => option.id === filter)?.label.toLowerCase()} tickets in loaded history</strong><p>{data.pageInfo.hasMore ? 'There may be matching tickets in your older history.' : 'Choose another filter to view the rest of your ticket history.'}</p>{portalEmbedded && data.pageInfo.hasMore && <button className={styles.loadOlder} type="button" disabled={Boolean(busy)} onClick={() => void loadOlderTickets()}>{busy === 'older' ? 'Loading older tickets…' : 'Load older tickets'}</button>}</div></div>
      ) : (
        <div className={styles.workspace} data-mobile-thread={mobileThreadOpen ? 'true' : 'false'}>
          <nav className={styles.ticketList} aria-label="Support tickets">
            <header><span><TicketCheck size={16} aria-hidden="true" />Ticket history</span><small>{visibleTickets.length} shown{data.pageInfo.hasMore ? ' · more available' : ''}</small></header>
            {visibleTickets.map((ticket) => {
              const lastMessage = ticket.messages[ticket.messages.length - 1];
              const hasUnreadReply = Boolean(visibleUnreadReplies[ticket.id]?.length);
              return (
                <button ref={(node) => { if (node) ticketButtons.current.set(ticket.id, node); else ticketButtons.current.delete(ticket.id); }} type="button" key={ticket.id} onClick={() => openTicket(ticket.id)} aria-pressed={ticket.id === selectedId}>
                  <span><i data-status={statusTone(ticket.status)} />{ticket.category}{hasUnreadReply && <mark className={styles.newReply}><MessageSquare size={10} aria-hidden="true" />New reply</mark>}<em>#{ticket.id.slice(0, 8).toUpperCase()}</em></span>
                  <strong>{ticket.subject}</strong>
                  {ticket.client && <small>{ticket.client.fullName}</small>}
                  <small>{lastMessage ? `Last reply: ${authorLabel(lastMessage.authorType, portalEmbedded || data.actor.type === 'client')}` : 'No messages recorded'}</small>
                  <div><time dateTime={ticket.updatedAt}>{shortDate(ticket.updatedAt)}</time><b data-status={statusTone(ticket.status)}>{friendlyStatus(ticket.status, portalEmbedded)}</b><ChevronRight size={14} aria-hidden="true" /></div>
                </button>
              );
            })}
            {portalEmbedded && data.pageInfo.hasMore && <div className={styles.listFooter}><button className={styles.loadOlder} type="button" disabled={Boolean(busy)} onClick={() => void loadOlderTickets()}>{busy === 'older' ? 'Loading older tickets…' : 'Load older tickets'}</button><small>Older tickets load in place.</small></div>}
          </nav>

          {selected && (
            <article className={styles.thread} aria-labelledby={`ticket-${selected.id}`}>
              <button ref={mobileBackButton} className={styles.mobileBack} type="button" onClick={closeMobileThread}><ArrowLeft size={15} aria-hidden="true" />Back to tickets</button>
              <header className={styles.threadHeader}>
                <div><p>{selected.category} · {selected.priority} priority · #{selected.id.slice(0, 8).toUpperCase()}</p><h3 id={`ticket-${selected.id}`}>{selected.subject}</h3>{selected.client && <span>{selected.client.fullName}{selected.client.email ? ` · ${selected.client.email}` : ''}</span>}<small>Updated {formatDate(selected.updatedAt)} · {selected.messages.length} message{selected.messages.length === 1 ? '' : 's'}</small></div>
                <b data-status={statusTone(selected.status)}>{friendlyStatus(selected.status, portalEmbedded)}</b>
              </header>

              {data.actor.canManage && (
                <div className={styles.manage}>
                  <label>Status<select value={manageStatus} onChange={(event) => setManageStatus(event.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                  <label>Priority<select value={managePriority} onChange={(event) => setManagePriority(event.target.value)}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
                  <button type="button" disabled={Boolean(busy) || (manageStatus === selected.status && managePriority === selected.priority)} onClick={() => void patchTicket({ status: manageStatus, priority: managePriority }, 'Ticket settings updated.')}>{busy === 'manage' ? 'Saving…' : 'Save settings'}</button>
                </div>
              )}

              <ol className={styles.messages} aria-label={`Conversation for ${selected.subject}`}>
                {selected.messages.map((message) => (
                  <li className={message.authorType === 'Client' ? styles.clientMessage : message.authorType === 'System' ? styles.systemMessage : styles.supportMessage} key={message.id}>
                    <div><strong>{authorLabel(message.authorType, portalEmbedded || data.actor.type === 'client')}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time></div>
                    <p>{message.body}</p>
                  </li>
                ))}
              </ol>

              {selected.status !== 'Closed' && (data.actor.type === 'client' || data.actor.canManage) ? (
                <form className={styles.reply} onSubmit={(event) => { event.preventDefault(); if (reply.trim()) void patchTicket({ message: reply.trim() }, 'Reply sent securely.'); }}>
                  <label htmlFor={`reply-${selected.id}`}>Reply to this ticket</label>
                  <textarea id={`reply-${selected.id}`} value={reply} onChange={(event) => setReply(event.target.value)} required maxLength={4000} rows={4} placeholder="Write a clear reply…" />
                  <div>
                    {data.actor.type === 'client' && (confirmClose ? <span className={styles.closeConfirm}><strong>Close this ticket?</strong><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmClose(false)}>Keep open</button><button type="button" disabled={Boolean(busy)} onClick={() => void patchTicket({ status: 'Closed' }, 'Ticket closed.')}>Confirm close</button></span> : <button className={styles.closeButton} type="button" disabled={Boolean(busy)} onClick={() => setConfirmClose(true)}>Close ticket</button>)}
                    <button type="submit" disabled={Boolean(busy) || !reply.trim()}>{busy === 'reply' ? 'Sending…' : 'Send reply'}<Send size={15} aria-hidden="true" /></button>
                  </div>
                </form>
              ) : (
                <div className={styles.closed}><TicketCheck size={18} aria-hidden="true" /><div><strong>{selected.status === 'Closed' ? 'This ticket is closed' : 'This conversation is read-only'}</strong><p>{selected.status === 'Closed' ? data.actor.type === 'client' ? 'Start a new ticket if you need more help.' : data.actor.canManage ? 'Change the status to reopen this conversation.' : 'Your role can view this conversation.' : 'Your role can view this conversation but cannot reply.'}</p></div>{selected.status === 'Closed' && data.actor.type === 'client' && <button type="button" onClick={() => { setShowNew(true); setMobileThreadOpen(false); }}>Start a new ticket</button>}</div>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyTickets({ onCreate }: { onCreate?: () => void }) {
  return <div className={styles.empty} role="status"><span aria-hidden="true"><Headphones size={22} /></span><strong>No support tickets yet</strong><p>Create a secure ticket when you need official help with setup, licensing, or a recorded payment.</p>{onCreate && <button type="button" onClick={onCreate}><Plus size={15} aria-hidden="true" />Create your first ticket</button>}</div>;
}

function matchesTicketFilter(status: string, filter: TicketFilter) {
  if (filter === 'all') return true;
  if (filter === 'active') return !['Resolved', 'Closed'].includes(status);
  if (filter === 'waiting') return status === 'Waiting on client';
  if (filter === 'resolved') return status === 'Resolved';
  return status === 'Closed';
}

function ticketFilterCount(tickets: Ticket[], filter: TicketFilter) {
  return tickets.filter((ticket) => matchesTicketFilter(ticket.status, filter)).length;
}

function waitPriority(status: string, clientPerspective: boolean) {
  if (clientPerspective && status === 'Waiting on client') return 0;
  if (!clientPerspective && status === 'Open') return 0;
  if (status === 'In progress') return 1;
  if (clientPerspective && status === 'Open') return 2;
  if (!clientPerspective && status === 'Waiting on client') return 2;
  if (status === 'Resolved') return 3;
  return 4;
}

function statusTone(status: string) {
  if (status === 'Resolved' || status === 'Closed') return 'closed';
  if (status === 'Waiting on client') return 'waiting';
  if (status === 'In progress') return 'progress';
  return 'active';
}

function friendlyStatus(status: string, clientView: boolean) {
  if (!clientView) return status;
  if (status === 'Open') return 'Waiting for Orion';
  if (status === 'Waiting on client') return 'Your reply needed';
  if (status === 'In progress') return 'Orion is working';
  return status;
}

async function requestTickets(url: string, signal?: AbortSignal): Promise<TicketResponse> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal });
  const payload = await response.json().catch(() => null) as Partial<TicketResponse> & { error?: string } | null;
  if (!response.ok || !payload || !Array.isArray(payload.tickets) || !payload.actor) {
    throw new Error(payload?.error || 'Unable to load support tickets.');
  }
  return {
    actor: payload.actor,
    tickets: payload.tickets,
    unreadReplyNotifications: payload.unreadReplyNotifications || {},
    pageInfo: payload.pageInfo || emptyPageInfo,
  };
}

function mergeTickets(primary: Ticket[], secondary: Ticket[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((ticket) => {
    if (seen.has(ticket.id)) return false;
    seen.add(ticket.id);
    return true;
  });
}

function mergeUnreadReplies(primary: Record<string, string[]>, secondary: Record<string, string[]>) {
  const merged: Record<string, string[]> = {};
  for (const [ticketId, ids] of [...Object.entries(primary), ...Object.entries(secondary)]) {
    merged[ticketId] = [...new Set([...(merged[ticketId] || []), ...ids])];
  }
  return merged;
}

function filterForLinkedTicket(status: string): TicketFilter {
  if (status === 'Resolved') return 'resolved';
  if (status === 'Closed') return 'closed';
  return 'active';
}

function readPortalTicketQuery() {
  if (typeof window === 'undefined') return { present: false, id: null };
  const url = new URL(window.location.href);
  const value = url.searchParams.get('ticket');
  if (value === null) return { present: false, id: null };
  return { present: true, id: isUuid(value) ? value : null };
}

function setPortalTicketUrl(ticketId: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('ticket', ticketId);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}#support`);
}

function cleanPortalTicketQuery() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('ticket')) return;
  url.searchParams.delete('ticket');
  const search = url.searchParams.toString();
  window.history.replaceState(window.history.state, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function authorLabel(authorType: TicketMessage['authorType'], clientPerspective: boolean) {
  if (authorType === 'Client') return clientPerspective ? 'You' : 'Client';
  if (authorType === 'System') return 'Orion system';
  return 'Orion support';
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function isMobileTicketLayout() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 700px)').matches;
}

function focusAfterRender(getTarget: () => HTMLElement | null) {
  const focus = () => getTarget()?.focus();
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
  else setTimeout(focus, 0);
}
