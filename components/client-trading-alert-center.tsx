'use client';

import Link from 'next/link';
import {
  Activity,
  BellRing,
  Check,
  CircleAlert,
  Clock3,
  Gauge,
  LockKeyhole,
  Save,
  ShieldCheck,
  TrendingDown,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isTradingAlertSnapshot,
  type TradingAlertPreferences,
  type TradingAlertSnapshot,
} from '@/lib/trading-alerts';
import type { TradingAnalyticsPlan } from '@/lib/trading-analytics';
import styles from './client-trading-alert-center.module.css';

type ClientTradingAlertCenterProps = {
  connectionId: string;
  plan: TradingAnalyticsPlan;
  currency: string;
  connectionLabel: string;
};

export default function ClientTradingAlertCenter({
  connectionId,
  plan,
  currency,
  connectionLabel,
}: ClientTradingAlertCenterProps) {
  const [snapshot, setSnapshot] = useState<TradingAlertSnapshot | null>(null);
  const [draft, setDraft] = useState<TradingAlertPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeConnectionRef = useRef(connectionId);
  activeConnectionRef.current = connectionId;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setSaving(false);
    setSnapshot(null);
    setDraft(null);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/trading-alerts?connectionId=${encodeURIComponent(connectionId)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTradingAlertSnapshot(payload)) {
        throw new Error(apiError(payload) || 'Your trading alert settings are temporarily unavailable.');
      }
      setSnapshot(payload);
      setDraft(payload.preferences);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setSnapshot(null);
      setDraft(null);
      setError(reason instanceof Error ? reason.message : 'Your trading alert settings are temporarily unavailable.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const validation = useMemo(() => validatePreferences(draft), [draft]);
  const dirty = Boolean(snapshot && draft && !samePreferences(snapshot.preferences, draft));
  const effectiveCurrency = snapshot?.connection.currency || currency;
  const effectivePlan = snapshot?.access.plan || plan;
  const advanced = snapshot?.access.advancedEvents === true;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !draft || !dirty || validation) return;
    const targetConnectionId = connectionId;
    setSaving(true);
    setError('');
    setNotice('');
    const preferences = advanced ? draft : {
      connectionHealth: draft.connectionHealth,
      finalClose: draft.finalClose,
    };
    try {
      const response = await fetch('/api/trading-alerts', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId, preferences }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTradingAlertSnapshot(payload)) {
        throw new Error(apiError(payload) || 'Unable to save your trading alert settings.');
      }
      if (activeConnectionRef.current !== targetConnectionId) return;
      setSnapshot(payload);
      setDraft(payload.preferences);
      setNotice('Alert settings saved.');
    } catch (reason) {
      if (activeConnectionRef.current !== targetConnectionId) return;
      setError(reason instanceof Error ? reason.message : 'Unable to save your trading alert settings.');
    } finally {
      if (activeConnectionRef.current === targetConnectionId) setSaving(false);
    }
  }

  function update<K extends keyof TradingAlertPreferences>(key: K, value: TradingAlertPreferences[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setNotice('');
  }

  return (
    <section className={styles.center} id="risk-alerts" aria-labelledby="trading-alerts-title" aria-busy={loading}>
      <header className={styles.heading}>
        <div className={styles.titleGroup}>
          <span className={styles.titleIcon} aria-hidden="true"><BellRing size={21} /></span>
          <div><p className="eyebrow">Proactive account monitoring</p><h2 id="trading-alerts-title">Risk &amp; Alerts</h2><span>Choose the in-portal notifications you want for this trading connection.</span></div>
        </div>
        <span className={styles.planBadge} data-plan={effectivePlan.toLowerCase()}>{effectivePlan} access</span>
      </header>

      <div className={styles.connectionStrip}>
        <span><ShieldCheck size={16} aria-hidden="true" /></span>
        <div><small>Monitoring applies to</small><strong>{snapshot ? `${snapshot.connection.platform} ${snapshot.connection.accountType} ${snapshot.connection.maskedAccountNumber}` : connectionLabel}</strong></div>
        <p>Alerts depend on licensed EA synchronization and never open, close, or modify trades.</p>
      </div>

      {loading ? <LoadingState /> : null}
      {!loading && !snapshot ? <ErrorState message={error} retry={() => void load()} /> : null}

      {snapshot && draft ? (
        <form className={styles.form} onSubmit={save}>
          <MonitoringSummary snapshot={snapshot} />

          <div className={styles.settingsGrid}>
            <fieldset className={styles.fieldset}>
              <legend><Activity size={17} aria-hidden="true" /> Event alerts</legend>
              <p>These alerts use verified server-received connection and trade records.</p>
              <Toggle
                checked={draft.connectionHealth}
                onChange={(checked) => update('connectionHealth', checked)}
                title="Connection health"
                detail="Notify when this selected connection becomes delayed or offline."
              />
              <Toggle
                checked={draft.finalClose}
                onChange={(checked) => update('finalClose', checked)}
                title="Final trade close"
                detail="Notify after Orion confirms that a position has been fully closed."
              />
              {advanced ? <>
                <Toggle
                  checked={draft.tradeOpened}
                  onChange={(checked) => update('tradeOpened', checked)}
                  title="Trade opened"
                  detail="Notify when Orion records the first opening execution for a new position."
                />
                <Toggle
                  checked={draft.partialClose}
                  onChange={(checked) => update('partialClose', checked)}
                  title="Partial close"
                  detail="Notify when only part of an open position is closed."
                />
              </> : null}
            </fieldset>

            {advanced ? (
              <fieldset className={styles.fieldset}>
                <legend><Gauge size={17} aria-hidden="true" /> Risk guardrails</legend>
                <p>Financial rules are evaluated only from fresh telemetry and use {effectiveCurrency}.</p>
                <ThresholdRule
                  checked={draft.dailyLossEnabled}
                  onChecked={(checked) => update('dailyLossEnabled', checked)}
                  title="Daily realized-loss limit"
                  detail="Triggers once per UTC day when completed Orion trades reach this loss."
                  value={draft.dailyLossLimit}
                  onValue={(value) => update('dailyLossLimit', value)}
                  suffix={effectiveCurrency}
                  min={0.01}
                  step={0.01}
                />
                <ThresholdRule
                  checked={draft.drawdownEnabled}
                  onChecked={(checked) => update('drawdownEnabled', checked)}
                  title="Floating drawdown"
                  detail="Compares current equity with balance while telemetry is fresh."
                  value={draft.drawdownPercent}
                  onValue={(value) => update('drawdownPercent', value)}
                  suffix="%"
                  min={1}
                  max={90}
                  step={0.1}
                />
                <ThresholdRule
                  checked={draft.equityFloorEnabled}
                  onChecked={(checked) => update('equityFloorEnabled', checked)}
                  title="Equity floor"
                  detail="Triggers when reported account equity reaches or falls below this value."
                  value={draft.equityFloor}
                  onValue={(value) => update('equityFloor', value)}
                  suffix={effectiveCurrency}
                  min={0.01}
                  step={0.01}
                />
              </fieldset>
            ) : <PremiumLock />}
          </div>

          <footer className={styles.footer}>
            <div className={styles.feedback} aria-live="polite">
              {validation ? <span data-tone="error" role="alert"><CircleAlert size={15} aria-hidden="true" />{validation}</span> : null}
              {error ? <span data-tone="error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</span> : null}
              {notice ? <span data-tone="success" role="status"><Check size={15} aria-hidden="true" />{notice}</span> : null}
              {!validation && !error && !notice ? <span><BellRing size={15} aria-hidden="true" />Triggered alerts appear in the Trading filter and notification bell.</span> : null}
            </div>
            <button className={styles.saveButton} type="submit" disabled={!dirty || Boolean(validation) || saving}>
              <Save size={16} aria-hidden="true" />{saving ? 'Saving…' : dirty ? 'Save alert settings' : 'Settings saved'}
            </button>
          </footer>
        </form>
      ) : null}
    </section>
  );
}

function MonitoringSummary({ snapshot }: { snapshot: TradingAlertSnapshot }) {
  return <div className={styles.monitoring} aria-label="Alert monitoring status">
    <article><span data-tone="green"><ShieldCheck size={16} aria-hidden="true" /></span><div><small>Enabled rules</small><strong>{snapshot.monitoring.activeRules}</strong><p>For this connection</p></div></article>
    <article><span data-tone={snapshot.monitoring.activeBreaches ? 'orange' : 'cyan'}><CircleAlert size={16} aria-hidden="true" /></span><div><small>Active breaches</small><strong>{snapshot.monitoring.activeBreaches}</strong><p>{snapshot.monitoring.activeBreaches ? 'Review MetaTrader' : 'No active threshold'}</p></div></article>
    <article><span data-tone="cyan"><Clock3 size={16} aria-hidden="true" /></span><div><small>Last evaluation</small><strong>{relativeTime(snapshot.monitoring.lastEvaluatedAt)}</strong><p>Server-side monitor</p></div></article>
    <article><span data-tone="gold"><BellRing size={16} aria-hidden="true" /></span><div><small>Last alert</small><strong>{relativeTime(snapshot.monitoring.lastAlertAt)}</strong><p>Portal delivery</p></div></article>
  </div>;
}

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail: string }) {
  return <label className={styles.toggleRow}>
    <span className={styles.toggleCopy}><strong>{title}</strong><small>{detail}</small></span>
    <span className={styles.switch}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></span>
  </label>;
}

function ThresholdRule({ checked, onChecked, title, detail, value, onValue, suffix, min, max, step }: {
  checked: boolean;
  onChecked: (checked: boolean) => void;
  title: string;
  detail: string;
  value: number | null;
  onValue: (value: number | null) => void;
  suffix: string;
  min: number;
  max?: number;
  step: number;
}) {
  return <div className={styles.thresholdRule} data-enabled={checked || undefined}>
    <label className={styles.toggleRow}>
      <span className={styles.toggleCopy}><strong>{title}</strong><small>{detail}</small></span>
      <span className={styles.switch}><input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} /><i aria-hidden="true" /></span>
    </label>
    <label className={styles.thresholdInput}>
      <span>{title} threshold</span>
      <span><input type="number" inputMode="decimal" value={value ?? ''} min={min} max={max} step={step} disabled={!checked} aria-required={checked} onChange={(event) => onValue(numberOrNull(event.target.value))} /><i>{suffix}</i></span>
    </label>
  </div>;
}

function PremiumLock() {
  return <aside className={styles.premiumLock} aria-labelledby="premium-alerts-title">
    <span className={styles.lockIcon} aria-hidden="true"><LockKeyhole size={24} /></span>
    <p className="eyebrow">Premium guardrails</p>
    <h3 id="premium-alerts-title">Unlock advanced trading alerts</h3>
    <p>Premium and Lifetime include trade-open, partial-close, daily-loss, floating-drawdown, and equity-floor alerts.</p>
    <ul>
      <li><TrendingDown size={15} aria-hidden="true" />Custom risk thresholds</li>
      <li><Activity size={15} aria-hidden="true" />Full execution notifications</li>
      <li><BellRing size={15} aria-hidden="true" />Portal alert delivery</li>
    </ul>
    <Link href="/checkout?plan=premium">Review Premium alerts <span aria-hidden="true">→</span></Link>
  </aside>;
}

function LoadingState() {
  return <div className={styles.loading} role="status"><span>Loading alert settings…</span><div>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div></div>;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className={styles.errorState} role="alert"><CircleAlert size={22} aria-hidden="true" /><div><strong>Risk &amp; Alerts could not load</strong><p>{message} Your trading dashboard remains available.</p></div><button type="button" onClick={retry}>Try again</button></div>;
}

function validatePreferences(preferences: TradingAlertPreferences | null) {
  if (!preferences) return '';
  if (preferences.dailyLossEnabled && (!preferences.dailyLossLimit || preferences.dailyLossLimit <= 0)) return 'Enter a daily realized-loss limit greater than zero.';
  if (preferences.drawdownEnabled && (!preferences.drawdownPercent || preferences.drawdownPercent < 1 || preferences.drawdownPercent > 90)) return 'Enter a floating drawdown threshold from 1% to 90%.';
  if (preferences.equityFloorEnabled && (!preferences.equityFloor || preferences.equityFloor <= 0)) return 'Enter an equity floor greater than zero.';
  return '';
}

function samePreferences(left: TradingAlertPreferences, right: TradingAlertPreferences) {
  return (Object.keys(left) as Array<keyof TradingAlertPreferences>).every((key) => left[key] === right[key]);
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function relativeTime(value: string | null) {
  if (!value) return 'Not yet';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function apiError(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const error = (value as Record<string, unknown>).error;
  return typeof error === 'string' ? error : '';
}
