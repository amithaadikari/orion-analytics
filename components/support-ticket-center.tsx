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
type TicketResponse = { actor: { type: 'client' | 'admin'; canManage: boolean }; tickets: Ticket[] };
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
  newTicketRequest?: number;
  onSummaryChange?: (summary: TicketSummary) => void;
};

export default function SupportTicketCenter({ className = '', embedded = false, portalEmbedded = false, newTicketRequest = 0, onSummaryChange }: SupportTicketCenterProps) {
  const [data, setData] = useState<TicketResponse>({ actor: { type: 'client', canManage: false }, tickets: [] });
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
  const endpoint = portalEmbedded ? '/api/support-tickets?scope=self' : '/api/support-tickets';

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin', signal });
      const payload = await response.json().catch(() => null) as TicketResponse | { error?: string } | null;
      if (!response.ok || !payload || !('tickets' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load support tickets.');
      setData(payload);
      setHasLoaded(true);
      setSelectedId((current) => current && payload.tickets.some((ticket) => ticket.id === current)
        ? current
        : [...payload.tickets].sort((left, right) => waitPriority(left.status, payload.actor.type === 'client') - waitPriority(right.status, payload.actor.type === 'client') || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]?.id || null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to load support tickets.');
    } finally {
      if (!signal?.aborted && !quiet) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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

  useEffect(() => {
    if (!visibleTickets.length) {
      setSelectedId(null);
      setMobileThreadOpen(false);
      return;
    }
    if (!selectedId || !visibleTickets.some((ticket) => ticket.id === selectedId)) {
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
      await load(undefined, true);
      if (payload?.ticketId) {
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

  function selectFilter(nextFilter: TicketFilter) {
    setFilter(nextFilter);
    setMobileThreadOpen(false);
  }

  function openTicket(ticketId: string) {
    setSelectedId(ticketId);
    setMobileThreadOpen(true);
    lastOpenedTicket.current = ticketId;
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
          <strong>{activeCount}<small>Recent active</small></strong>
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
        <div className={styles.filters} role="group" aria-label="Filter recent support tickets">
          {ticketFilters.map((option) => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => selectFilter(option.id)}>{option.label}<span>{ticketFilterCount(data.tickets, option.id)}</span></button>)}
        </div>
      )}

      {loading ? (
        <div className={styles.loading} role="status"><span /><span /><p>Loading your support workspace…</p></div>
      ) : error && data.tickets.length === 0 ? null : data.tickets.length === 0 ? (
        <EmptyTickets onCreate={data.actor.type === 'client' ? () => setShowNew(true) : undefined} />
      ) : visibleTickets.length === 0 ? (
        <div className={styles.filterEmpty} role="status"><Inbox size={21} aria-hidden="true" /><div><strong>No {ticketFilters.find((option) => option.id === filter)?.label.toLowerCase()} tickets in recent history</strong><p>Choose another filter to view the rest of the ticket history loaded here.</p></div></div>
      ) : (
        <div className={styles.workspace} data-mobile-thread={mobileThreadOpen ? 'true' : 'false'}>
          <nav className={styles.ticketList} aria-label="Support tickets">
            <header><span><TicketCheck size={16} aria-hidden="true" />Recent ticket history</span><small>{visibleTickets.length} shown</small></header>
            {visibleTickets.map((ticket) => {
              const lastMessage = ticket.messages[ticket.messages.length - 1];
              return (
                <button ref={(node) => { if (node) ticketButtons.current.set(ticket.id, node); else ticketButtons.current.delete(ticket.id); }} type="button" key={ticket.id} onClick={() => openTicket(ticket.id)} aria-pressed={ticket.id === selectedId}>
                  <span><i data-status={statusTone(ticket.status)} />{ticket.category}<em>#{ticket.id.slice(0, 8).toUpperCase()}</em></span>
                  <strong>{ticket.subject}</strong>
                  {ticket.client && <small>{ticket.client.fullName}</small>}
                  <small>{lastMessage ? `Last reply: ${authorLabel(lastMessage.authorType, portalEmbedded || data.actor.type === 'client')}` : 'No messages recorded'}</small>
                  <div><time dateTime={ticket.updatedAt}>{shortDate(ticket.updatedAt)}</time><b data-status={statusTone(ticket.status)}>{friendlyStatus(ticket.status, portalEmbedded)}</b><ChevronRight size={14} aria-hidden="true" /></div>
                </button>
              );
            })}
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
