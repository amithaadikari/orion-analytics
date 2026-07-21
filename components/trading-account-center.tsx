'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  ChevronDown,
  Clock3,
  Coins,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { TradingAccountSnapshot } from '@/lib/trading-accounts';
import styles from './trading-account-center.module.css';

type AccountIntent = 'Register' | 'Replace';

type FormState = {
  accountNumber: string;
  broker: string;
  brokerServer: string;
  platform: 'MT4' | 'MT5';
  currency: string;
};

type ReviewState = FormState & { intent: AccountIntent };

const emptyForm: FormState = {
  accountNumber: '',
  broker: '',
  brokerServer: '',
  platform: 'MT5',
  currency: 'USD',
};

export default function TradingAccountCenter() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<TradingAccountSnapshot | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);

  savingRef.current = saving;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/trading-accounts', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json().catch(() => null) as TradingAccountSnapshot | { error?: string } | null;
      if (!response.ok || !payload || !('membership' in payload)) {
        throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load trading accounts.');
      }
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
    if (!snapshot?.nextChangeAt || snapshot.canChange || saving) return;
    const delay = new Date(snapshot.nextChangeAt).getTime() - Date.now();
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => void load(), Math.max(250, Math.min(delay + 500, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [load, saving, snapshot?.canChange, snapshot?.nextChangeAt]);

  useEffect(() => {
    if (!review) return;
    const previouslyFocused = lastFocusedRef.current;
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!savingRef.current) setReview(null);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [review]);

  useEffect(() => {
    if (review && saving) dialogRef.current?.focus();
  }, [review, saving]);

  const countdown = useMemo(() => remainingTime(snapshot?.nextChangeAt || null, clock), [clock, snapshot?.nextChangeAt]);

  function openReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    setNotice('');
    setReview({
      ...form,
      intent: snapshot.currentAccount ? 'Replace' : 'Register',
    });
  }

  function closeReview() {
    if (saving) return;
    setReview(null);
  }

  async function confirmChange() {
    if (!snapshot || !review) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/trading-accounts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          accountNumber: review.accountNumber,
          broker: review.broker,
          brokerServer: review.brokerServer,
          platform: review.platform,
          currency: review.currency,
          intent: review.intent,
        }),
      });
      const payload = await response.json().catch(() => null) as (TradingAccountSnapshot & { mutation?: { changed?: boolean; reboundLicenses?: number } }) | { error?: string; code?: string; nextChangeAt?: string; committed?: boolean; refreshRequired?: boolean } | null;
      if (response.ok && payload && 'committed' in payload && payload.committed) {
        setReview(null);
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
      setReview(null);
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
        <div>
          <p className="eyebrow">Protected trading identity</p>
          <h2 id="trading-account-title">Real Account Vault</h2>
          <span>One verified real account secures every eligible Orion license across its exact MetaTrader platform and broker server.</span>
        </div>
        <strong className={styles.marker} aria-hidden="true">02</strong>
      </header>

      {loading && !snapshot ? <div className={styles.loading}><RefreshCw size={18} className={styles.spin} aria-hidden="true" />Opening your secure account vault…</div> : null}
      {error && !snapshot ? <div className={styles.feedback} data-tone="error" role="alert"><ShieldAlert size={18} aria-hidden="true" />{error}<button type="button" onClick={() => void load()}>Try again</button></div> : null}

      {snapshot ? <>
        <div className={styles.summaryGrid}>
          <article className={styles.membership} data-tier={snapshot.membership.effectiveTier.toLowerCase()}>
            <span><Sparkles size={19} aria-hidden="true" /></span>
            <div><small>Membership protection</small><strong>{snapshot.membership.effectiveTier}</strong><p>{membershipDescription(snapshot)}</p></div>
          </article>
          <article className={styles.binding}>
            <span><KeyRound size={19} aria-hidden="true" /></span>
            <div><small>License connection</small><strong>{snapshot.licensesBound} / {snapshot.eligibleLicenses} secured</strong><p>{snapshot.currentAccount ? 'Every bound license checks this identity before trading.' : 'Register the account used for live trading to activate validation.'}</p></div>
          </article>
          <article className={styles.eligibility} data-ready={snapshot.canChange}>
            <span><Clock3 size={19} aria-hidden="true" /></span>
            <div><small>{snapshot.currentAccount ? 'Replacement window' : 'Registration status'}</small><strong>{snapshot.canChange ? 'Ready now' : countdown || 'Protected'}</strong><p>{eligibilityDescription(snapshot)}</p></div>
          </article>
        </div>

        <div className={styles.workspace}>
          <div className={styles.accountColumn}>
            <article className={styles.currentCard} data-active={Boolean(snapshot.currentAccount)}>
              <div className={styles.cardHeading}>
                <span><LockKeyhole size={20} aria-hidden="true" /></span>
                <div><small>Server-verified identity</small><strong>{snapshot.currentAccount ? 'Live account protected' : 'Vault awaiting registration'}</strong></div>
                <b className={styles.verifiedBadge} data-active={Boolean(snapshot.currentAccount)}>
                  {snapshot.currentAccount ? <><BadgeCheck size={14} aria-hidden="true" />Verified & active</> : 'Setup required'}
                </b>
              </div>

              <div className={styles.identityHero}>
                <small>Registered account</small>
                <strong>{snapshot.currentAccount?.maskedAccountNumber || 'Not registered'}</strong>
                <span>{snapshot.currentAccount
                  ? `${snapshot.currentAccount.broker} · ${snapshot.currentAccount.platform}`
                  : 'Add the exact identity shown in your MetaTrader terminal.'}</span>
              </div>

              {snapshot.currentAccount ? <dl className={styles.accountFacts}>
                <div><dt><Building2 size={14} aria-hidden="true" />Broker</dt><dd>{snapshot.currentAccount.broker}</dd></div>
                <div><dt><Server size={14} aria-hidden="true" />Exact server</dt><dd>{snapshot.currentAccount.brokerServer}</dd></div>
                <div><dt><ShieldCheck size={14} aria-hidden="true" />Platform</dt><dd>{snapshot.currentAccount.platform}</dd></div>
                <div><dt><Coins size={14} aria-hidden="true" />Currency</dt><dd>{snapshot.currentAccount.currency || 'Not set'}</dd></div>
                <div className={styles.wideFact}><dt><Clock3 size={14} aria-hidden="true" />Verified</dt><dd>{formatDate(snapshot.currentAccount.verifiedAt || snapshot.currentAccount.registeredAt)}</dd></div>
              </dl> : <div className={styles.emptyState}>
                <ShieldAlert size={20} aria-hidden="true" />
                <span><strong>Your real account is not verified yet</strong><small>Complete the secure form to bind the account, platform, and exact broker server together.</small></span>
              </div>}

              <div className={styles.bindingStrip}>
                <span><KeyRound size={18} aria-hidden="true" /></span>
                <div><small>License enforcement</small><strong>{snapshot.licensesBound} active license{snapshot.licensesBound === 1 ? '' : 's'} bound to this vault</strong></div>
                <i data-active={Boolean(snapshot.currentAccount)}>{snapshot.currentAccount ? 'Protected' : 'Waiting'}</i>
              </div>
            </article>

            {snapshot.legacyReview.pendingCount > 0 ? <div className={styles.legacyNotice} role="status"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Legacy account record needs verification</strong><span>{snapshot.legacyReview.pendingCount} license record{snapshot.legacyReview.pendingCount === 1 ? '' : 's'} preserved safely. Confirm the broker and exact server to activate the binding.</span></div></div> : null}

            <details className={styles.history}>
              <summary>
                <span><Clock3 size={17} aria-hidden="true" /><span><small>Audited security log</small><strong>Account change history</strong></span></span>
                <span>{snapshot.history.length} record{snapshot.history.length === 1 ? '' : 's'}<ChevronDown size={16} aria-hidden="true" /></span>
              </summary>
              <div className={styles.historyBody}>
                {snapshot.history.length ? <ol>{snapshot.history.map((item) => <li key={item.id}><i aria-hidden="true" /><div><strong>{item.changeKind} · {item.newAccount.maskedAccountNumber}</strong><span>{item.newAccount.platform} · {item.newAccount.broker} · {item.newAccount.brokerServer}</span><small>{formatDateTime(item.createdAt)} · {item.changedBy === 'Admin' ? 'Orion administrator' : 'Client portal'}</small></div></li>)}</ol> : <p className={styles.empty}>No verified account changes have been recorded yet.</p>}
              </div>
            </details>
          </div>

          <form className={styles.form} onSubmit={openReview} aria-busy={saving}>
            <header className={styles.formHeader}>
              <span className={styles.formIcon}>{snapshot.currentAccount ? <RefreshCw size={21} aria-hidden="true" /> : <ShieldCheck size={21} aria-hidden="true" />}</span>
              <div>
                <p className="eyebrow">{snapshot.currentAccount ? 'Secure replacement' : 'First registration'}</p>
                <h3>{snapshot.currentAccount ? 'Change your protected account' : 'Register your real account'}</h3>
                <span>Enter the identity exactly as it appears inside MetaTrader.</span>
              </div>
            </header>

            <label>
              <span>Real account number</span>
              <input inputMode="numeric" autoComplete="off" pattern="[0-9]{4,24}" minLength={4} maxLength={24} required value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value.replace(/\D/g, '') })} placeholder="Example: 12345678" />
            </label>
            <label>
              <span>Broker</span>
              <input autoComplete="organization" minLength={2} maxLength={120} required value={form.broker} onChange={(event) => setForm({ ...form, broker: event.target.value })} placeholder="Example: IC Markets" />
            </label>
            <div className={styles.fieldGroup}>
              <label htmlFor="real-account-server">Exact broker server</label>
              <input id="real-account-server" autoComplete="off" minLength={2} maxLength={160} required value={form.brokerServer} onChange={(event) => setForm({ ...form, brokerServer: event.target.value })} placeholder="Example: ICMarketsSC-Live33" aria-describedby="real-account-server-help" />
              <small className={styles.fieldHint} id="real-account-server-help">Copy this exactly from MetaTrader. Server suffixes such as “-Live33” matter.</small>
            </div>
            <div className={styles.formRow}>
              <label><span>Platform</span><select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as 'MT4' | 'MT5' })}><option disabled={!snapshot.eligiblePlatforms.includes('MT5')}>MT5</option><option disabled={!snapshot.eligiblePlatforms.includes('MT4')}>MT4</option></select></label>
              <label><span>Currency</span><input maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></label>
            </div>

            <div className={styles.guidance}><ShieldCheck size={18} aria-hidden="true" /><span><strong>You will review everything before saving</strong>No confirmation phrase is required. Orion will show the current and new identity side by side.</span></div>
            {error && !review ? <p className={styles.formError} role="alert">{error}</p> : null}
            {notice ? <p className={styles.formNotice} role="status">{notice}</p> : null}
            <button className={styles.primaryAction} type="submit" disabled={saving || !snapshot.canChange || !snapshot.eligiblePlatforms.includes(form.platform)}>
              <span>{snapshot.currentAccount ? 'Review account change' : 'Review account registration'}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            {!snapshot.canChange ? <small className={styles.disabledReason}>{eligibilityDescription(snapshot)}</small> : null}
          </form>
        </div>
      </> : null}

      {review && snapshot ? <div className={styles.dialogBackdrop}>
        <div
          className={styles.dialog}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-review-title"
          aria-describedby="account-review-description"
          aria-busy={saving}
          tabIndex={-1}
        >
          <header className={styles.dialogHeader}>
            <span className={styles.dialogIcon} data-tone={review.intent === 'Replace' ? 'warning' : 'standard'}><ShieldAlert size={22} aria-hidden="true" /></span>
            <span><small>Final security review</small><h3 id="account-review-title">{review.intent === 'Replace' ? 'Replace this real account?' : 'Register this real account?'}</h3></span>
            <button type="button" className={styles.dialogClose} onClick={closeReview} disabled={saving} aria-label="Close account review"><X size={19} aria-hidden="true" /></button>
          </header>
          <p id="account-review-description" className={styles.dialogDescription}>
            Check every digit and the exact broker server. Orion will validate this server-owned request before changing any license binding.
          </p>
          {error ? <p className={styles.dialogError} role="alert"><ShieldAlert size={18} aria-hidden="true" />{error}</p> : null}

          <div className={styles.comparison}>
            <div>
              <small>Current identity</small>
              <strong>{snapshot.currentAccount?.maskedAccountNumber || 'No account registered'}</strong>
              <span>{snapshot.currentAccount ? `${snapshot.currentAccount.broker} · ${snapshot.currentAccount.brokerServer}` : 'No live account is currently bound.'}</span>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
            <div>
              <small>New identity</small>
              <strong>{review.accountNumber}</strong>
              <span>{review.broker} · {review.brokerServer}</span>
            </div>
          </div>

          <dl className={styles.reviewFacts}>
            <div><dt>Platform</dt><dd>{review.platform}</dd></div>
            <div><dt>Currency</dt><dd>{review.currency || 'Not set'}</dd></div>
            <div><dt>Licenses</dt><dd>{snapshot.eligibleLicenses} eligible</dd></div>
          </dl>

          <p className={styles.consequence} data-tone={review.intent === 'Replace' ? 'warning' : 'standard'}>
            <ShieldCheck size={18} aria-hidden="true" />
            {review.intent === 'Replace'
              ? 'After confirmation, the previous account stops validating on the next EA license check and eligible licenses move to this identity.'
              : 'After confirmation, eligible licenses will validate only on this account, platform, and exact broker server.'}
          </p>

          <footer className={styles.dialogActions}>
            <button ref={cancelButtonRef} type="button" className={styles.secondaryAction} onClick={closeReview} disabled={saving}>Go back</button>
            <button type="button" className={styles.confirmAction} onClick={() => void confirmChange()} disabled={saving}>
              {saving ? 'Securing account…' : review.intent === 'Replace' ? 'Confirm account change' : 'Confirm registration'}
            </button>
          </footer>
        </div>
      </div> : null}
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
