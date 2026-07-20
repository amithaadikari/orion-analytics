'use client';

import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { BadgeCheck, RefreshCw, Server, ShieldAlert } from 'lucide-react';
import type { TradingAccountSnapshot } from '@/lib/trading-accounts';
import styles from './admin-trading-account-panel.module.css';

export default function AdminTradingAccountPanel({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const [snapshot, setSnapshot] = useState<TradingAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'membership' | 'account' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/trading-accounts/${encodeURIComponent(clientId)}`, { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json().catch(() => null) as TradingAccountSnapshot | { error?: string; committed?: boolean } | null;
      if (response.ok && payload && 'committed' in payload && payload.committed) {
        setNotice('Membership was committed securely. Refreshing the verified record…');
        void load();
        return;
      }
      if (!response.ok || !payload || !('membership' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load trading accounts.');
      setSnapshot(payload);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load trading accounts.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  async function saveMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('membership');
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const tier = String(form.get('tier') || 'Standard');
    try {
      const response = await fetch(`/api/admin/trading-accounts/${encodeURIComponent(clientId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tier,
          status: String(form.get('status') || 'Active'),
          startedAt: tier === 'Pro' ? dateInputToIso(form.get('startedAt')) : null,
          expiresAt: tier === 'Pro' ? dateInputToIso(form.get('expiresAt')) : null,
        }),
      });
      const payload = await response.json().catch(() => null) as TradingAccountSnapshot | { error?: string } | null;
      if (!response.ok || !payload || !('membership' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to update membership.');
      setSnapshot(payload);
      setNotice('Membership updated and the client was notified.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update membership.');
    } finally {
      setSaving(null);
    }
  }

  async function replaceAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('account');
    setError('');
    setNotice('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch(`/api/admin/trading-accounts/${encodeURIComponent(clientId)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          accountNumber: String(form.get('accountNumber') || '').trim(),
          broker: String(form.get('broker') || '').trim(),
          brokerServer: String(form.get('brokerServer') || '').trim(),
          platform: String(form.get('platform') || 'MT5'),
          currency: String(form.get('currency') || '').trim(),
          overrideReason: String(form.get('overrideReason') || '').trim(),
        }),
      });
      const payload = await response.json().catch(() => null) as (TradingAccountSnapshot & { mutation?: { changed?: boolean } }) | { error?: string; committed?: boolean; mutation?: { changed?: boolean } } | null;
      if (response.ok && payload && 'committed' in payload && payload.committed) {
        setNotice(payload.mutation?.changed === false ? 'The same account was already registered; no override was needed.' : 'The account change was committed securely. Refreshing the verified record…');
        void load();
        return;
      }
      if (!response.ok || !payload || !('membership' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to replace the account.');
      setSnapshot(payload);
      formElement.reset();
      setNotice(payload.mutation?.changed === false ? 'The same account was already registered; active licenses were synchronized.' : 'Real account changed, licenses rebound, and the client was notified.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to replace the account.');
    } finally {
      setSaving(null);
    }
  }

  return <section className={styles.panel} aria-labelledby={`admin-trading-account-${clientId}`}>
    <header><div><p className="eyebrow">Trading identity</p><h3 id={`admin-trading-account-${clientId}`}>Membership & real account</h3><span>Atomic license binding, cooldown enforcement, and audited overrides.</span></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh trading account"><RefreshCw size={15} className={loading ? styles.spin : ''} /></button></header>
    {error ? <p className={styles.error} role="alert"><ShieldAlert size={15} />{error}</p> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {loading && !snapshot ? <p className={styles.loading}>Loading secure account records…</p> : null}
    {snapshot ? <>
      <div className={styles.summary}>
        <article><BadgeCheck size={16} /><span><small>Membership</small><strong>{snapshot.membership.effectiveTier}</strong><b>{snapshot.membership.storedTier} · {snapshot.membership.status}</b></span></article>
        <article><Server size={16} /><span><small>Current real account</small><strong>{snapshot.currentAccount?.maskedAccountNumber || 'Not registered'}</strong><b>{snapshot.currentAccount ? `${snapshot.currentAccount.platform} · ${snapshot.currentAccount.brokerServer}` : `${snapshot.legacyReview.pendingCount} legacy record(s) pending`}</b></span></article>
        <article><span className={styles.bindingMark}>◇</span><span><small>Bound licenses</small><strong>{snapshot.licensesBound} / {snapshot.eligibleLicenses}</strong><b>{snapshot.canChange ? 'Client change available' : snapshot.nextChangeAt ? `Next ${formatDate(snapshot.nextChangeAt)}` : 'Client change locked'}</b></span></article>
      </div>

      {canWrite ? <div className={styles.forms}>
        <form key={`membership-${snapshot.serverTime}`} onSubmit={saveMembership}>
          <div><strong>Membership controls</strong><span>Pro removes the seven-day membership cooldown while active.</span></div>
          <label><span>Tier</span><select name="tier" defaultValue={snapshot.membership.storedTier}><option>Standard</option><option>Pro</option></select></label>
          <label><span>Status</span><select name="status" defaultValue={snapshot.membership.status}><option>Active</option><option>Expired</option><option>Cancelled</option><option>Suspended</option></select></label>
          <label><span>Pro start</span><input name="startedAt" type="datetime-local" defaultValue={isoToDateInput(snapshot.membership.startedAt)} /></label>
          <label><span>Pro expiry</span><input name="expiresAt" type="datetime-local" defaultValue={isoToDateInput(snapshot.membership.expiresAt)} /></label>
          <button disabled={saving !== null}>{saving === 'membership' ? 'Saving…' : 'Save membership'}</button>
        </form>
        <form key={`account-${snapshot.serverTime}`} onSubmit={replaceAccount}>
          <div><strong>{snapshot.currentAccount ? 'Administrator override' : 'Register real account'}</strong><span>Reason is permanently recorded. The old account stops validating after success.</span></div>
          <label><span>Account number</span><input name="accountNumber" inputMode="numeric" pattern="[0-9]{4,24}" minLength={4} maxLength={24} required defaultValue={snapshot.legacyReview.suggestedAccountNumber || ''} /></label>
          <label><span>Broker</span><input name="broker" minLength={2} maxLength={120} required /></label>
          <label><span>Exact server</span><input name="brokerServer" minLength={2} maxLength={160} required /></label>
          <div className={styles.row}><label><span>Platform</span><select name="platform" defaultValue={snapshot.currentAccount?.platform || snapshot.eligiblePlatforms[0] || 'MT5'}><option disabled={!snapshot.eligiblePlatforms.includes('MT5')}>MT5</option><option disabled={!snapshot.eligiblePlatforms.includes('MT4')}>MT4</option></select></label><label><span>Currency</span><input name="currency" defaultValue="USD" pattern="[A-Za-z]{3}" maxLength={3} /></label></div>
          <label><span>Override / registration reason</span><textarea name="overrideReason" minLength={10} maxLength={500} rows={3} required placeholder="Explain why Orion is changing this registered identity." /></label>
          <button disabled={saving !== null}>{saving === 'account' ? 'Changing…' : snapshot.currentAccount ? 'Override and rebind' : 'Register and bind'}</button>
        </form>
      </div> : <p className={styles.readOnly}>Analyst access is read-only. An administrator must change membership or the registered account.</p>}

      <div className={styles.history}><strong>Account audit history</strong>{snapshot.history.length ? <ol>{snapshot.history.map((item) => <li key={item.id}><i /><span><b>{item.changeKind} · {item.newAccount.maskedAccountNumber}</b><small>{item.newAccount.platform} · {item.newAccount.brokerServer} · {item.changedBy} · {formatDate(item.createdAt)}</small>{item.overrideReason ? <em>{item.overrideReason}</em> : null}</span></li>)}</ol> : <p>No successful account changes recorded.</p>}</div>
    </> : null}
  </section>;
}

function dateInputToIso(value: FormDataEntryValue | null) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToDateInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
