'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, KeyRound, Laptop, MonitorCheck, RefreshCw, Server, ShieldAlert } from 'lucide-react';
import type { LicenseRuntimeSnapshot } from '@/lib/license-runtime';
import styles from './license-runtime-center.module.css';

export default function LicenseRuntimeCenter() {
  const [snapshot, setSnapshot] = useState<LicenseRuntimeSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState<'demo' | 'installation' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/license-runtime', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json().catch(() => null) as LicenseRuntimeSnapshot | { error?: string } | null;
      if (!response.ok || !payload || !('licenses' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load Demo and installation pairing.');
      setSnapshot(payload);
      setSelectedId((current) => payload.licenses.some((license) => license.id === current) ? current : payload.licenses.find((license) => license.eligible)?.id || payload.licenses[0]?.id || '');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load Demo and installation pairing.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => snapshot?.licenses.find((license) => license.id === selectedId) || null, [selectedId, snapshot]);
  useEffect(() => {
    const deadlines = (snapshot?.licenses || []).flatMap((license) => [license.nextDemoChangeAt, license.nextInstallationChangeAt])
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value) && value > Date.now());
    if (!deadlines.length) return;
    const delay = Math.min(...deadlines) - Date.now();
    const timer = window.setTimeout(() => void load(), Math.max(250, Math.min(delay + 500, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [load, snapshot]);

  async function submitDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving('demo');
    setError('');
    setNotice('');
    try {
      const next = await mutate({
        action: 'setDemoAccount',
        requestId: crypto.randomUUID(),
        licenseId: selected.id,
        accountNumber: String(values.get('accountNumber') || '').trim(),
        brokerServer: String(values.get('brokerServer') || '').trim(),
        confirmation: String(values.get('confirmation') || '').trim().toUpperCase(),
      });
      setSnapshot(next);
      form.reset();
      setNotice(selected.demoAccount ? 'Demo account replaced. The previous Demo login will fail on the next validation.' : 'Demo account registered for this license.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change the Demo account.');
    } finally {
      setSaving(null);
    }
  }

  async function submitInstallation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving('installation');
    setError('');
    setNotice('');
    try {
      const next = await mutate({
        action: 'setInstallation',
        requestId: crypto.randomUUID(),
        licenseId: selected.id,
        installationId: String(values.get('installationId') || '').trim(),
        deviceLabel: String(values.get('deviceLabel') || '').trim(),
        confirmation: String(values.get('confirmation') || '').trim().toUpperCase(),
      });
      setSnapshot(next);
      form.reset();
      setNotice(selected.installation ? 'Installation replaced. The old PC, laptop, or VPS is now deactivated.' : 'Installation paired. The EA can now validate from this installation.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to pair the installation.');
    } finally {
      setSaving(null);
    }
  }

  async function mutate(body: Record<string, string>) {
    const response = await fetch('/api/license-runtime', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as (LicenseRuntimeSnapshot & { mutation?: unknown }) | { error?: string; committed?: boolean } | null;
    if (response.ok && payload && 'committed' in payload && payload.committed) {
      const refreshed = await fetch('/api/license-runtime', { cache: 'no-store', credentials: 'same-origin' });
      const refreshedPayload = await refreshed.json().catch(() => null) as LicenseRuntimeSnapshot | { error?: string } | null;
      if (!refreshed.ok || !refreshedPayload || !('licenses' in refreshedPayload)) throw new Error('The change was saved. Refresh the page to load the secure pairing record.');
      return refreshedPayload;
    }
    if (!response.ok || !payload || !('licenses' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to update license pairing.');
    return payload;
  }

  const demoConfirmation = selected?.demoAccount ? 'CHANGE DEMO' : 'REGISTER DEMO';
  const installationConfirmation = selected?.installation ? 'REPLACE DEVICE' : 'ACTIVATE DEVICE';

  return <section className={styles.center} id="license-pairing" aria-labelledby="license-runtime-title">
    <header className={styles.heading}>
      <div><p className="eyebrow">Demo & device security</p><h2 id="license-runtime-title">License Pairing Center</h2><span>Each license works on one registered Demo identity and one active MT5 installation. Real accounts continue to use the verified Real identity above.</span></div>
      <strong className={styles.marker} aria-hidden="true">03</strong>
    </header>

    {!snapshot && !error ? <p className={styles.loading}><RefreshCw size={16} className={styles.spin} />Loading secure license pairing…</p> : null}
    {error ? <p className={styles.feedback} data-tone="error" role="alert"><ShieldAlert size={16} />{error}</p> : null}
    {notice ? <p className={styles.feedback} data-tone="success" role="status"><BadgeCheck size={16} />{notice}</p> : null}

    {snapshot ? snapshot.licenses.length ? <>
      <div className={styles.selector}>
        <label htmlFor="runtime-license">License to manage</label>
        <select id="runtime-license" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setError(''); setNotice(''); }}>
          {snapshot.licenses.map((license) => <option value={license.id} key={license.id}>{license.plan} · {license.platform} · {license.maskedLicenseKey}{license.eligible ? '' : ' · inactive'}</option>)}
        </select>
        <span>{snapshot.membership.effectiveTier} membership · {snapshot.membership.effectiveTier === 'Pro' ? 'two Demo changes per rolling 24 hours' : 'one Demo change every 7 days'}</span>
      </div>

      {selected ? <>
        <div className={styles.summary}>
          <article><KeyRound size={17} /><span><small>Feature plan</small><strong>{selected.plan}</strong><b>The server enables only {selected.plan} features on Real and Demo.</b></span></article>
          <article><Server size={17} /><span><small>Registered Demo</small><strong>{selected.demoAccount?.maskedAccountNumber || 'Not registered'}</strong><b>{selected.demoAccount ? `${selected.platform} · ${selected.demoAccount.brokerServer}` : 'Unregistered Demo accounts are rejected.'}</b></span></article>
          <article><MonitorCheck size={17} /><span><small>Active installation</small><strong>{selected.installation?.hint || 'Not paired'}</strong><b>{selected.installation ? `${selected.installation.label} · last seen ${formatDate(selected.installation.lastSeenAt)}` : 'The EA Installation ID must be paired.'}</b></span></article>
        </div>

        <div className={styles.forms}>
          <form key={`demo-${selected.id}-${selected.demoAccount?.id || 'new'}`} onSubmit={submitDemo}>
            <div><span className={styles.icon}><Server size={18} /></span><span><small>Per-license Demo identity</small><strong>{selected.demoAccount ? 'Change Demo account' : 'Register Demo account'}</strong></span></div>
            <p>Use the exact Demo login and broker server shown inside MetaTrader. A different Demo account will return <code>DEMO_ACCOUNT_MISMATCH</code>.</p>
            <label><span>Demo account number</span><input name="accountNumber" inputMode="numeric" pattern="[0-9]{4,24}" minLength={4} maxLength={24} required /></label>
            <label><span>Exact broker server</span><input name="brokerServer" minLength={2} maxLength={160} required placeholder="Example: Broker-Demo" /></label>
            <label><span>Type <b>{demoConfirmation}</b> to confirm</span><input name="confirmation" autoComplete="off" required /></label>
            <button disabled={saving !== null || !selected.canChangeDemo}>{saving === 'demo' ? 'Securing Demo…' : demoConfirmation === 'CHANGE DEMO' ? 'Change Demo binding' : 'Register Demo binding'}</button>
            {!selected.canChangeDemo ? <small className={styles.locked}>{demoEligibilityText(selected)}</small> : null}
          </form>

          <form key={`install-${selected.id}-${selected.installation?.id || 'new'}`} onSubmit={submitInstallation}>
            <div><span className={styles.icon}><Laptop size={18} /></span><span><small>One active installation seat</small><strong>{selected.installation ? 'Move to another device' : 'Pair this installation'}</strong></span></div>
            <p>Attach the secure V5.1 build on the new terminal, copy the <b>ORION INSTALLATION ID</b> from the Experts log, then pair it here. Replacing it deactivates the old installation.</p>
            <label><span>Installation ID from EA</span><input name="installationId" autoComplete="off" spellCheck={false} required pattern="ORN-INST-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){5}" placeholder="ORN-INST-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" /></label>
            <label><span>Device label</span><input name="deviceLabel" minLength={2} maxLength={60} required placeholder="Example: Home laptop MT5" /></label>
            <label><span>Type <b>{installationConfirmation}</b> to confirm</span><input name="confirmation" autoComplete="off" required /></label>
            <button disabled={saving !== null || !selected.canReplaceInstallation}>{saving === 'installation' ? 'Pairing installation…' : installationConfirmation === 'REPLACE DEVICE' ? 'Replace active installation' : 'Activate installation'}</button>
            {!selected.canReplaceInstallation ? <small className={styles.locked}>{installationEligibilityText(selected)}</small> : null}
          </form>
        </div>
      </> : null}
    </> : <p className={styles.empty}>No license has been assigned yet. Demo and installation pairing becomes available after Orion activates a license.</p> : null}
  </section>;
}

function demoEligibilityText(license: NonNullable<LicenseRuntimeSnapshot['licenses'][number]>) {
  if (license.demoCooldownReason === 'standard') return `Standard Demo replacement unlocks ${formatDate(license.nextDemoChangeAt)}.`;
  if (license.demoCooldownReason === 'pro-security') return `Pro security protection resets ${formatDate(license.nextDemoChangeAt)}.`;
  if (license.demoCooldownReason === 'inactive') return 'Your Orion client account must be active.';
  return 'This license must be active before registering a Demo account.';
}

function installationEligibilityText(license: NonNullable<LicenseRuntimeSnapshot['licenses'][number]>) {
  if (license.installationCooldownReason === 'security-limit') return `Installation replacement unlocks ${formatDate(license.nextInstallationChangeAt)}.`;
  if (license.installationCooldownReason === 'inactive') return 'Your Orion client account must be active.';
  return 'This license must be active before pairing an installation.';
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
