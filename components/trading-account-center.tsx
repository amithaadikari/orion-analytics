'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Clock3, KeyRound, RefreshCw, Server, ShieldAlert } from 'lucide-react';
import type { TradingAccountSnapshot } from '@/lib/trading-accounts';
import styles from './trading-account-center.module.css';

type FormState = {
  accountNumber: string;
  broker: string;
  brokerServer: string;
  platform: 'MT4' | 'MT5';
  currency: string;
  confirmation: string;
};

const emptyForm: FormState = { accountNumber: '', broker: '', brokerServer: '', platform: 'MT5', currency: 'USD', confirmation: '' };

export default function TradingAccountCenter() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<TradingAccountSnapshot | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/trading-accounts', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json().catch(() => null) as TradingAccountSnapshot | { error?: string } | null;
      if (!response.ok || !payload || !('membership' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load trading accounts.');
      setSnapshot(payload);
      setForm((current) => current.accountNumber || payload.currentAccount
        ? current
        : {
            ...current,
            accountNumber: payload.legacyReview.suggestedAccountNumber || '',
            platform: payload.eligiblePlatforms[0] || current.platform,
          });
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load trading accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!snapshot?.nextChangeAt || snapshot.canChange) return;
    const delay = new Date(snapshot.nextChangeAt).getTime() - Date.now();
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => void load(), Math.max(250, Math.min(delay + 500, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [load, snapshot?.canChange, snapshot?.nextChangeAt]);

  const confirmationPhrase = snapshot?.currentAccount ? 'CHANGE ACCOUNT' : 'REGISTER ACCOUNT';
  const countdown = useMemo(() => remainingTime(snapshot?.nextChangeAt || null, clock), [clock, snapshot?.nextChangeAt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/trading-accounts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, requestId: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => null) as (TradingAccountSnapshot & { mutation?: { changed?: boolean; reboundLicenses?: number } }) | { error?: string; code?: string; nextChangeAt?: string; committed?: boolean; refreshRequired?: boolean } | null;
      if (response.ok && payload && 'committed' in payload && payload.committed) {
        setNotice('The account change was committed securely. Refreshing the verified account record…');
        router.refresh();
        void load();
        return;
      }
      if (!response.ok || !payload || !('membership' in payload)) {
        if (payload && 'nextChangeAt' in payload && payload.nextChangeAt) {
          setSnapshot((current) => current ? {
            ...current,
            canChange: false,
            nextChangeAt: payload.nextChangeAt || null,
            cooldownReason: 'code' in payload && payload.code === 'PRO_CHANGE_RATE_LIMIT' ? 'pro-security' : 'standard',
          } : current);
        }
        throw new Error(payload && 'error' in payload ? payload.error : 'Unable to change the real account.');
      }
      setSnapshot(payload);
      setForm({ ...emptyForm, platform: payload.currentAccount?.platform || 'MT5' });
      setNotice(payload.mutation?.changed === false
        ? 'This account was already registered. Its active licenses were checked and synchronized.'
        : `Real account updated. ${payload.mutation?.reboundLicenses ?? payload.licensesBound} active license${(payload.mutation?.reboundLicenses ?? payload.licensesBound) === 1 ? '' : 's'} bound successfully.`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change the real account. Your existing binding was preserved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.center} id="trading-accounts" aria-labelledby="trading-account-title">
      <header className={styles.heading}>
        <div><p className="eyebrow">License identity</p><h2 id="trading-account-title">Registered real account</h2><span>Orion licenses validate only on the real account, broker server, and platform registered here.</span></div>
        <strong className={styles.marker} aria-hidden="true">02</strong>
      </header>

      {loading && !snapshot ? <div className={styles.loading}><RefreshCw size={17} className={styles.spin} aria-hidden="true" />Loading secure account binding…</div> : null}
      {error && !snapshot ? <div className={styles.feedback} data-tone="error" role="alert"><ShieldAlert size={17} aria-hidden="true" />{error}<button type="button" onClick={() => void load()}>Try again</button></div> : null}

      {snapshot ? <>
        <div className={styles.summaryGrid}>
          <article className={styles.membership} data-tier={snapshot.membership.effectiveTier.toLowerCase()}>
            <span><BadgeCheck size={18} aria-hidden="true" /></span>
            <div><small>Orion membership</small><strong>{snapshot.membership.effectiveTier}</strong><p>{membershipDescription(snapshot)}</p></div>
          </article>
          <article className={styles.binding}>
            <span><KeyRound size={18} aria-hidden="true" /></span>
            <div><small>License binding</small><strong>{snapshot.licensesBound} of {snapshot.eligibleLicenses} active</strong><p>{snapshot.currentAccount ? 'Bound licenses reject the previous real account immediately on the next validation.' : 'Register a real account before your license can validate.'}</p></div>
          </article>
          <article className={styles.eligibility} data-ready={snapshot.canChange}>
            <span><Clock3 size={18} aria-hidden="true" /></span>
            <div><small>{snapshot.currentAccount ? 'Next replacement' : 'Registration status'}</small><strong>{snapshot.canChange ? 'Available now' : countdown || 'Unavailable'}</strong><p>{eligibilityDescription(snapshot)}</p></div>
          </article>
        </div>

        <div className={styles.workspace}>
          <div className={styles.accountColumn}>
            <article className={styles.currentCard} data-active={Boolean(snapshot.currentAccount)}>
              <div className={styles.cardHeading}><span><Server size={17} aria-hidden="true" /></span><div><small>Current verified identity</small><strong>{snapshot.currentAccount ? 'Active real account' : 'No real account registered'}</strong></div><i aria-hidden="true" /></div>
              {snapshot.currentAccount ? <div className={styles.accountFacts}>
                <span><small>Account</small><strong>{snapshot.currentAccount.maskedAccountNumber}</strong></span>
                <span><small>Broker</small><strong>{snapshot.currentAccount.broker}</strong></span>
                <span><small>Server</small><strong>{snapshot.currentAccount.brokerServer}</strong></span>
                <span><small>Platform</small><strong>{snapshot.currentAccount.platform}</strong></span>
                <span><small>Currency</small><strong>{snapshot.currentAccount.currency || 'Not set'}</strong></span>
                <span><small>Verified</small><strong>{formatDate(snapshot.currentAccount.verifiedAt || snapshot.currentAccount.registeredAt)}</strong></span>
              </div> : <p className={styles.empty}>Your existing license account number is not treated as verified until you confirm its broker and exact server here.</p>}
            </article>

            {snapshot.legacyReview.pendingCount > 0 ? <div className={styles.legacyNotice} role="status"><ShieldAlert size={16} aria-hidden="true" /><div><strong>Legacy account record needs verification</strong><span>{snapshot.legacyReview.pendingCount} license record{snapshot.legacyReview.pendingCount === 1 ? '' : 's'} preserved safely. Confirm the broker and exact server to activate the binding.</span></div></div> : null}

            <div className={styles.history}>
              <div><p className="eyebrow">Audit history</p><h3>Successful account changes</h3></div>
              {snapshot.history.length ? <ol>{snapshot.history.map((item) => <li key={item.id}><i aria-hidden="true" /><div><strong>{item.changeKind} · {item.newAccount.maskedAccountNumber}</strong><span>{item.newAccount.platform} · {item.newAccount.broker} · {item.newAccount.brokerServer}</span><small>{formatDateTime(item.createdAt)} · {item.changedBy === 'Admin' ? 'Orion administrator' : 'Client portal'}</small></div></li>)}</ol> : <p className={styles.empty}>No verified account changes have been recorded yet.</p>}
            </div>
          </div>

          <form className={styles.form} onSubmit={submit} aria-busy={saving}>
            <div><p className="eyebrow">{snapshot.currentAccount ? 'Secure replacement' : 'First registration'}</p><h3>{snapshot.currentAccount ? 'Change real account' : 'Register real account'}</h3><span>Use the exact details shown inside your broker terminal.</span></div>
            <label><span>Real account number</span><input inputMode="numeric" autoComplete="off" pattern="[0-9]{4,24}" minLength={4} maxLength={24} required value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value.replace(/\D/g, '') })} /></label>
            <label><span>Broker</span><input autoComplete="organization" minLength={2} maxLength={120} required value={form.broker} onChange={(event) => setForm({ ...form, broker: event.target.value })} placeholder="Example: IC Markets" /></label>
            <label><span>Exact broker server</span><input autoComplete="off" minLength={2} maxLength={160} required value={form.brokerServer} onChange={(event) => setForm({ ...form, brokerServer: event.target.value })} placeholder="Example: ICMarketsSC-Live33" /></label>
            <div className={styles.formRow}>
              <label><span>Platform</span><select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as 'MT4' | 'MT5' })}><option disabled={!snapshot.eligiblePlatforms.includes('MT5')}>MT5</option><option disabled={!snapshot.eligiblePlatforms.includes('MT4')}>MT4</option></select></label>
              <label><span>Currency</span><input maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></label>
            </div>
            <div className={styles.warning}><ShieldAlert size={16} aria-hidden="true" /><span><strong>Permanent binding update</strong>After success, the previous account will stop validating this license. Verify every digit and the exact server name.</span></div>
            <label><span>Type <b>{confirmationPhrase}</b> to confirm</span><input autoComplete="off" required value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value.toUpperCase() })} /></label>
            {error ? <p className={styles.formError} role="alert">{error}</p> : null}
            {notice ? <p className={styles.formNotice} role="status">{notice}</p> : null}
            <button type="submit" disabled={saving || !snapshot.canChange || !snapshot.eligiblePlatforms.includes(form.platform) || form.confirmation !== confirmationPhrase}>{saving ? 'Securing account…' : snapshot.currentAccount ? 'Change and rebind licenses' : 'Register and bind licenses'}</button>
            {!snapshot.canChange ? <small className={styles.disabledReason}>{eligibilityDescription(snapshot)}</small> : null}
          </form>
        </div>
      </> : null}
    </section>
  );
}

function membershipDescription(snapshot: TradingAccountSnapshot) {
  if (snapshot.membership.effectiveTier === 'Pro') return 'No 7-day wait. Security protection allows two self-service replacements in a rolling 24 hours.';
  if (snapshot.membership.storedTier === 'Pro') return `Pro is currently ${snapshot.membership.status.toLowerCase()}, so Standard rules apply.`;
  return 'A successful self-service replacement starts a 7-day cooldown.';
}

function eligibilityDescription(snapshot: TradingAccountSnapshot) {
  if (snapshot.cooldownReason === 'inactive') return 'Your Orion client account must be active.';
  if (snapshot.cooldownReason === 'no-license') return 'An active matching-platform license is required.';
  if (snapshot.cooldownReason === 'standard') return `Standard membership unlocks on ${formatDateTime(snapshot.nextChangeAt)}.`;
  if (snapshot.cooldownReason === 'pro-security') return `Pro security protection resets on ${formatDateTime(snapshot.nextChangeAt)}.`;
  return snapshot.currentAccount ? 'Your membership currently permits a replacement.' : 'Your account is ready for first registration.';
}

function remainingTime(value: string | null, now: number) {
  if (!value) return null;
  const difference = new Date(value).getTime() - now;
  if (!Number.isFinite(difference) || difference <= 0) return 'Available now';
  const days = Math.floor(difference / 86_400_000);
  const hours = Math.ceil((difference % 86_400_000) / 3_600_000);
  return days ? `${days}d ${hours}h` : `${hours}h`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
