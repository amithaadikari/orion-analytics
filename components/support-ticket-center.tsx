'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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

const categories = ['General', 'License', 'Payment', 'Setup', 'Technical'];
const priorities = ['Low', 'Normal', 'High', 'Urgent'];
const statuses = ['Open', 'Waiting on client', 'In progress', 'Resolved', 'Closed'];

export default function SupportTicketCenter({ className = '' }: { className?: string }) {
  const [data, setData] = useState<TicketResponse>({ actor: { type: 'client', canManage: false }, tickets: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [reply, setReply] = useState('');
  const [manageStatus, setManageStatus] = useState('Open');
  const [managePriority, setManagePriority] = useState('Normal');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/support-tickets', { cache: 'no-store', credentials: 'same-origin', signal });
      const payload = await response.json().catch(() => null) as TicketResponse | { error?: string } | null;
      if (!response.ok || !payload || !('tickets' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load support tickets.');
      setData(payload);
      setSelectedId((current) => current && payload.tickets.some((ticket) => ticket.id === current) ? current : payload.tickets[0]?.id || null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to load support tickets.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selected = useMemo(() => data.tickets.find((ticket) => ticket.id === selectedId) || null, [data.tickets, selectedId]);
  useEffect(() => setReply(''), [selectedId]);
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
      const response = await fetch('/api/support-tickets', {
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
      setNotice('Your ticket was sent to Orion support.');
      await load();
      if (payload?.ticketId) setSelectedId(payload.ticketId);
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
      const response = await fetch('/api/support-tickets', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: selected.id, ...update }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to update the support ticket.');
      setReply('');
      setNotice(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the support ticket.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={`${styles.center} ${className}`.trim()} id="support" aria-labelledby="support-center-title" aria-busy={loading}>
      <header className={styles.header}>
        <div><p>Official assistance</p><h2 id="support-center-title">Support tickets</h2><span>Keep setup, license, and payment questions inside your secure Orion workspace.</span></div>
        <div className={styles.headerActions}>
          <strong>{data.tickets.filter((ticket) => !['Resolved', 'Closed'].includes(ticket.status)).length}<small>Active</small></strong>
          {!loading && data.actor.type === 'client' && <button type="button" onClick={() => setShowNew((value) => !value)}>{showNew ? 'Cancel' : 'New ticket'}</button>}
          <button type="button" disabled={loading || Boolean(busy)} onClick={() => void load()} aria-label="Refresh support tickets">↻</button>
        </div>
      </header>

      <div className={styles.liveRegion} aria-live="polite">{notice}</div>
      {error && <div className={styles.error} role="alert"><span aria-hidden="true">!</span><p>{error}</p></div>}

      {showNew && !loading && data.actor.type === 'client' && (
        <form className={styles.newTicket} onSubmit={createTicket} aria-busy={busy === 'create'}>
          <div><label>Subject<input name="subject" required minLength={4} maxLength={180} placeholder="What can Orion help with?" /></label><label>Category<select name="category" defaultValue="General">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Priority<select name="priority" defaultValue="Normal">{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label></div>
          <label>Message<textarea name="message" required maxLength={4000} rows={5} placeholder="Include the exact problem, platform, and steps already tried." /></label>
          <button type="submit" disabled={Boolean(busy)}>{busy === 'create' ? 'Sending…' : 'Send secure ticket'}<span aria-hidden="true">→</span></button>
        </form>
      )}

      {loading ? (
        <div className={styles.loading} role="status"><span /><span /><p>Loading your support workspace…</p></div>
      ) : data.tickets.length ? (
        <div className={styles.workspace}>
          <nav className={styles.ticketList} aria-label="Support tickets">
            {data.tickets.map((ticket) => (
              <button className={ticket.id === selectedId ? styles.selected : ''} type="button" key={ticket.id} onClick={() => setSelectedId(ticket.id)} aria-current={ticket.id === selectedId ? 'true' : undefined}>
                <span><i data-status={statusTone(ticket.status)} />{ticket.category}</span>
                <strong>{ticket.subject}</strong>
                {ticket.client && <small>{ticket.client.fullName}</small>}
                <time dateTime={ticket.updatedAt}>{shortDate(ticket.updatedAt)}</time>
                <b data-status={statusTone(ticket.status)}>{ticket.status}</b>
              </button>
            ))}
          </nav>

          {selected && (
            <article className={styles.thread} aria-labelledby={`ticket-${selected.id}`}>
              <header className={styles.threadHeader}>
                <div><p>{selected.category} · {selected.priority} priority</p><h3 id={`ticket-${selected.id}`}>{selected.subject}</h3>{selected.client && <span>{selected.client.fullName}{selected.client.email ? ` · ${selected.client.email}` : ''}</span>}</div>
                <b data-status={statusTone(selected.status)}>{selected.status}</b>
              </header>

              {data.actor.canManage && (
                <div className={styles.manage}>
                  <label>Status<select value={manageStatus} onChange={(event) => setManageStatus(event.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                  <label>Priority<select value={managePriority} onChange={(event) => setManagePriority(event.target.value)}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
                  <button type="button" disabled={Boolean(busy) || (manageStatus === selected.status && managePriority === selected.priority)} onClick={() => void patchTicket({ status: manageStatus, priority: managePriority }, 'Ticket settings updated.')}>{busy === 'manage' ? 'Saving…' : 'Save settings'}</button>
                </div>
              )}

              <ol className={styles.messages}>
                {selected.messages.map((message) => (
                  <li className={message.authorType === 'Client' ? styles.clientMessage : styles.supportMessage} key={message.id}>
                    <div><strong>{message.authorType === 'Client' ? 'Client' : 'Orion support'}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time></div>
                    <p>{message.body}</p>
                  </li>
                ))}
              </ol>

              {selected.status !== 'Closed' && (data.actor.type === 'client' || data.actor.canManage) ? (
                <form className={styles.reply} onSubmit={(event) => { event.preventDefault(); if (reply.trim()) void patchTicket({ message: reply.trim() }, 'Reply sent securely.'); }}>
                  <label htmlFor={`reply-${selected.id}`}>Reply to this ticket</label>
                  <textarea id={`reply-${selected.id}`} value={reply} onChange={(event) => setReply(event.target.value)} required maxLength={4000} rows={4} placeholder="Write a clear reply…" />
                  <div>{data.actor.type === 'client' && <button className={styles.closeButton} type="button" disabled={Boolean(busy)} onClick={() => void patchTicket({ status: 'Closed' }, 'Ticket closed.')}>Close ticket</button>}<button type="submit" disabled={Boolean(busy) || !reply.trim()}>{busy === 'reply' ? 'Sending…' : 'Send reply'}<span aria-hidden="true">→</span></button></div>
                </form>
              ) : <p className={styles.closed}>{selected.status === 'Closed' ? `This ticket is closed.${data.actor.canManage ? ' Change its status to reopen the conversation.' : data.actor.type === 'client' ? ' Create a new ticket if you need more help.' : ''}` : 'This support workspace is read-only for your role.'}</p>}
            </article>
          )}
        </div>
      ) : (
        <div className={styles.empty} role="status"><span aria-hidden="true">◎</span><strong>No support tickets yet</strong><p>Create a ticket when you need official help with setup, licensing, or a recorded payment.</p></div>
      )}
    </section>
  );
}

function statusTone(status: string) {
  if (status === 'Resolved' || status === 'Closed') return 'closed';
  if (status === 'Waiting on client') return 'waiting';
  return 'active';
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
