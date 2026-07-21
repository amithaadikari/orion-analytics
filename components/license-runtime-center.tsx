'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  Clock3,
  KeyRound,
  Laptop,
  MonitorCheck,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import type { LicenseRuntimeSnapshot } from '@/lib/license-runtime';
import { installationHint } from '@/lib/license-runtime';
import styles from './license-runtime-center.module.css';

type RuntimeLicense = LicenseRuntimeSnapshot['licenses'][number];

type ConfirmationState =
  | {
    kind: 'demo';
    licenseId: string;
    intent: 'Register' | 'Replace';
    accountNumber: string;
    brokerServer: string;
  }
  | {
    kind: 'installation';
    licenseId: string;
    intent: 'Activate' | 'Replace';
    installationId: string;
    deviceLabel: string;
  }
  | {
    kind: 'device-request';
    licenseId: string;
    pairingRequestId: string;
    decision: 'Approve' | 'Reject';
  };

export default function LicenseRuntimeCenter() {
  const [snapshot, setSnapshot] = useState<LicenseRuntimeSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState<'demo' | 'installation' | 'device-request' | null>(null);
  const [checking, setChecking] = useState(false);
  const [demoEditing, setDemoEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const licenseSelectRef = useRef<HTMLSelectElement>(null);
  const demoActionRef = useRef<HTMLButtonElement>(null);
  const demoAccountInputRef = useRef<HTMLInputElement>(null);
  const demoEditorOpenedRef = useRef(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const dataGenerationRef = useRef(0);

  savingRef.current = saving !== null;

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (savingRef.current) return null;
    const sequence = ++loadSequenceRef.current;
    const generation = dataGenerationRef.current;
    try {
      const response = await fetch('/api/license-runtime', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json().catch(() => null) as LicenseRuntimeSnapshot | { error?: string } | null;
      if (!response.ok || !payload || !('licenses' in payload)) {
        throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load Demo and device security.');
      }
      if (sequence !== loadSequenceRef.current || generation !== dataGenerationRef.current) return null;
      setSnapshot(payload);
      setSelectedId((current) => payload.licenses.some((license) => license.id === current)
        ? current
        : payload.licenses.find((license) => license.pendingInstallationRequest)?.id
          || payload.licenses.find((license) => license.eligible)?.id
          || payload.licenses[0]?.id
          || '');
      if (!options.silent) setError('');
      return payload;
    } catch (reason) {
      if (!options.silent && sequence === loadSequenceRef.current && generation === dataGenerationRef.current) {
        setError(reason instanceof Error ? reason.message : 'Unable to load Demo and device security.');
      }
      return null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!snapshot || saving !== null) return;
    const hasPendingApproval = snapshot.licenses.some((license) => Boolean(license.pendingInstallationRequest));
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, hasPendingApproval ? 15_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [load, saving, snapshot]);

  const selected = useMemo(
    () => snapshot?.licenses.find((license) => license.id === selectedId) || null,
    [selectedId, snapshot],
  );
  const otherPending = useMemo(
    () => snapshot?.licenses.find((license) => license.id !== selectedId && license.pendingInstallationRequest) || null,
    [selectedId, snapshot],
  );

  useEffect(() => {
    if (saving !== null) return;
    const deadlines = (snapshot?.licenses || []).flatMap((license) => [
      license.nextDemoChangeAt,
      license.nextInstallationChangeAt,
      license.pendingInstallationRequest?.expiresAt,
    ])
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value) && value > Date.now());
    if (!deadlines.length) return;
    const delay = Math.min(...deadlines) - Date.now();
    const timer = window.setTimeout(
      () => void load({ silent: true }),
      Math.max(250, Math.min(delay + 500, 2_147_000_000)),
    );
    return () => window.clearTimeout(timer);
  }, [load, saving, snapshot]);

  useEffect(() => {
    if (demoEditing) {
      demoEditorOpenedRef.current = true;
      demoAccountInputRef.current?.focus();
    } else if (demoEditorOpenedRef.current) {
      demoEditorOpenedRef.current = false;
      demoActionRef.current?.focus();
    }
  }, [demoEditing, selectedId]);

  useEffect(() => {
    if (!confirmation) return;
    const previouslyFocused = lastFocusedRef.current;
    const fallbackFocus = licenseSelectRef.current;
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!savingRef.current) setConfirmation(null);
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
      else fallbackFocus?.focus();
    };
  }, [confirmation]);

  useEffect(() => {
    if (confirmation && saving !== null) dialogRef.current?.focus();
  }, [confirmation, saving]);

  useEffect(() => {
    if (confirmation?.kind !== 'device-request' || !snapshot || saving === 'device-request') return;
    const license = snapshot.licenses.find((item) => item.id === confirmation.licenseId);
    if (license?.pendingInstallationRequest?.id === confirmation.pairingRequestId) return;
    setConfirmation(null);
    setError('This device request is no longer active. Ask the EA to create a new request.');
  }, [confirmation, saving, snapshot]);

  function openConfirmation(next: ConfirmationState) {
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    setNotice('');
    setConfirmation(next);
  }

  function closeConfirmation() {
    if (saving !== null) return;
    setConfirmation(null);
  }

  function reviewDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    openConfirmation({
      kind: 'demo',
      licenseId: selected.id,
      intent: selected.demoAccount ? 'Replace' : 'Register',
      accountNumber: String(values.get('accountNumber') || '').trim(),
      brokerServer: String(values.get('brokerServer') || '').trim(),
    });
  }

  function reviewInstallation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    openConfirmation({
      kind: 'installation',
      licenseId: selected.id,
      intent: selected.installation ? 'Replace' : 'Activate',
      installationId: String(values.get('installationId') || '').trim(),
      deviceLabel: String(values.get('deviceLabel') || '').trim(),
    });
  }

  function reviewDeviceRequest(decision: 'Approve' | 'Reject') {
    if (!selected?.pendingInstallationRequest) return;
    openConfirmation({
      kind: 'device-request',
      licenseId: selected.id,
      pairingRequestId: selected.pendingInstallationRequest.id,
      decision,
    });
  }

  async function confirmChange() {
    if (!confirmation || !snapshot) return;
    const current = confirmation;
    const license = snapshot.licenses.find((item) => item.id === current.licenseId);
    if (!license) {
      setConfirmation(null);
      setError('This license is no longer available. Refresh the page and try again.');
      return;
    }

    if (current.kind === 'demo') {
      const expectedIntent = license.demoAccount ? 'Replace' : 'Register';
      if (current.intent !== expectedIntent) {
        setConfirmation(null);
        setError('The Demo account status changed. Review the current details and try again.');
        return;
      }
      dataGenerationRef.current += 1;
      loadSequenceRef.current += 1;
      savingRef.current = true;
      setSaving('demo');
      setError('');
      try {
        const next = await mutate({
          action: 'setDemoAccount',
          requestId: crypto.randomUUID(),
          licenseId: license.id,
          accountNumber: current.accountNumber,
          brokerServer: current.brokerServer,
          intent: current.intent,
        });
        setConfirmation(null);
        setSnapshot(next);
        setDemoEditing(false);
        setNotice(current.intent === 'Replace'
          ? 'Demo account changed. The previous Demo login will fail on the next validation.'
          : 'Demo account registered for this license.');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to change the Demo account.');
      } finally {
        setSaving(null);
      }
      return;
    }

    if (current.kind === 'installation') {
      const expectedIntent = license.installation ? 'Replace' : 'Activate';
      if (current.intent !== expectedIntent) {
        setConfirmation(null);
        setError('The active device status changed. Review the current details and try again.');
        return;
      }
      dataGenerationRef.current += 1;
      loadSequenceRef.current += 1;
      savingRef.current = true;
      setSaving('installation');
      setError('');
      try {
        const next = await mutate({
          action: 'setInstallation',
          requestId: crypto.randomUUID(),
          licenseId: license.id,
          installationId: current.installationId,
          deviceLabel: current.deviceLabel,
          intent: current.intent,
        });
        setConfirmation(null);
        setSnapshot(next);
        setNotice(current.intent === 'Replace'
          ? 'Active device changed. The previous PC, laptop, or VPS is now deactivated.'
          : 'Device paired. The EA can now validate from this installation.');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to pair the device.');
      } finally {
        setSaving(null);
      }
      return;
    }

    const pending = license.pendingInstallationRequest;
    if (!pending || pending.id !== current.pairingRequestId) {
      setConfirmation(null);
      setError('This device request is no longer active. Ask the EA to create a new request.');
      return;
    }
    dataGenerationRef.current += 1;
    loadSequenceRef.current += 1;
    savingRef.current = true;
    setSaving('device-request');
    setError('');
    try {
      const next = await mutate({
        action: 'resolveInstallationRequest',
        pairingRequestId: pending.id,
        decision: current.decision,
      });
      setConfirmation(null);
      setSnapshot(next);
      setNotice(current.decision === 'Approve'
        ? license.installation
          ? 'New device approved. The previous device is now deactivated.'
          : 'Device approved. The EA is completing its secure license check.'
        : 'Device request rejected. The active device was not changed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to resolve the device request.');
    } finally {
      setSaving(null);
    }
  }

  async function checkForDeviceRequest() {
    setChecking(true);
    setError('');
    setNotice('');
    const next = await load();
    if (next) {
      const waiting = next.licenses.filter((license) => license.pendingInstallationRequest).length;
      setNotice(waiting
        ? `${waiting} device approval ${waiting === 1 ? 'request is' : 'requests are'} waiting.`
        : 'No new device request yet. Keep the EA attached, then check again.');
    }
    setChecking(false);
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
      if (!refreshed.ok || !refreshedPayload || !('licenses' in refreshedPayload)) {
        throw new Error('The change was saved. Refresh the page to load the secure pairing record.');
      }
      return refreshedPayload;
    }
    if (!response.ok || !payload || !('licenses' in payload)) {
      throw new Error(payload && 'error' in payload ? payload.error : 'Unable to update license security.');
    }
    return payload;
  }

  function selectLicense(licenseId: string) {
    setSelectedId(licenseId);
    demoEditorOpenedRef.current = false;
    setDemoEditing(false);
    setConfirmation(null);
    setError('');
    setNotice('');
  }

  const confirmationView = confirmation && snapshot
    ? buildConfirmationView(confirmation, snapshot.licenses.find((license) => license.id === confirmation.licenseId) || null)
    : null;

  return <section className={styles.center} id="license-pairing" aria-labelledby="license-runtime-title">
    <header className={styles.heading}>
      <div>
        <p className="eyebrow">Demo & device security</p>
        <h2 id="license-runtime-title">License Identity & Devices</h2>
        <span>Manage the Demo account and one active device protected by each Orion license.</span>
      </div>
      <strong className={styles.marker} aria-hidden="true">03</strong>
    </header>

    {!snapshot && !error ? <p className={styles.loading}><RefreshCw size={18} className={styles.spin} />Loading license security…</p> : null}
    <div className={styles.feedbackRegion} aria-live="polite" aria-atomic="true">
      {error && !confirmation ? <p className={styles.feedback} data-tone="error" role="alert"><ShieldAlert size={18} />{error}</p> : null}
      {notice ? <p className={styles.feedback} data-tone="success" role="status"><BadgeCheck size={18} />{notice}</p> : null}
    </div>

    {snapshot ? snapshot.licenses.length ? <>
      <div className={styles.selector}>
        <div className={styles.selectorField}>
          <label htmlFor="runtime-license">License to manage</label>
          <select ref={licenseSelectRef} id="runtime-license" value={selectedId} onChange={(event) => selectLicense(event.target.value)}>
            {snapshot.licenses.map((license) => <option value={license.id} key={license.id}>
              {license.plan} · {license.platform} · {license.maskedLicenseKey}{license.pendingInstallationRequest ? ' · approval waiting' : license.eligible ? '' : ' · inactive'}
            </option>)}
          </select>
        </div>
        {selected ? <div className={styles.licenseContext}>
          <span className={styles.planBadge}><KeyRound size={15} />{selected.plan} features</span>
          <span className={styles.statusBadge} data-tone={selected.eligible ? 'active' : 'inactive'}>
            {selected.eligible ? 'License active' : 'License inactive'}
          </span>
          <small>{snapshot.membership.effectiveTier} membership · {membershipRule(snapshot.membership.effectiveTier)}</small>
        </div> : null}
      </div>

      {otherPending && !selected?.pendingInstallationRequest ? <aside className={styles.otherPending} role="status">
        <ShieldAlert size={18} />
        <span><strong>Device approval waiting on another license</strong><small>Review the six-digit code before the request expires.</small></span>
        <button type="button" onClick={() => selectLicense(otherPending.id)}>Review request</button>
      </aside> : null}

      {selected ? <>
        {selected.pendingInstallationRequest ? <PendingRequestCard
          license={selected}
          saving={saving}
          onDecision={reviewDeviceRequest}
        /> : null}

        <div className={styles.identityGrid}>
          <article className={styles.identityCard} aria-labelledby={`demo-card-${selected.id}`}>
            <header className={styles.cardHeader}>
              <span className={styles.cardIcon}><Server size={21} /></span>
              <span><small>Trading identity</small><h3 id={`demo-card-${selected.id}`}>Demo Account</h3></span>
              <span className={styles.cardStatus} data-tone={selected.demoAccount ? selected.canChangeDemo ? 'active' : 'locked' : 'empty'}>
                {selected.demoAccount ? selected.canChangeDemo ? 'Registered' : 'Change locked' : 'Not registered'}
              </span>
            </header>

            {selected.demoAccount ? <dl className={styles.detailsList}>
              <div><dt>Demo login</dt><dd>{selected.demoAccount.maskedAccountNumber}</dd></div>
              <div><dt>Exact {selected.platform} Server</dt><dd>{selected.demoAccount.brokerServer}</dd></div>
              <div><dt>Registered</dt><dd>{formatDate(selected.demoAccount.registeredAt)}</dd></div>
            </dl> : <div className={styles.emptyState}>
              <strong>No Demo account registered</strong>
              <p>Register one Demo login to test the EA. Your license plan still controls which features are enabled.</p>
            </div>}

            {!demoEditing ? <div className={styles.cardActions}>
              <button
                ref={demoActionRef}
                type="button"
                className={styles.primaryButton}
                onClick={() => setDemoEditing(true)}
                disabled={!selected.canChangeDemo || saving !== null}
              >{selected.demoAccount ? 'Change Demo account' : 'Register Demo account'}</button>
              {!selected.canChangeDemo ? <small className={styles.locked} id={`demo-lock-${selected.id}`}>{demoEligibilityText(selected)}</small> : null}
            </div> : <form className={styles.editForm} key={`demo-${selected.id}-${selected.demoAccount?.id || 'new'}`} onSubmit={reviewDemo}>
              <div className={styles.formIntro}>
                <strong>{selected.demoAccount ? 'Enter the new Demo account' : 'Enter your Demo account'}</strong>
                <button type="button" className={styles.closeEdit} onClick={() => setDemoEditing(false)} aria-label="Close Demo account form"><X size={18} /></button>
              </div>
              <label>
                <span>Demo account number</span>
                <input ref={demoAccountInputRef} name="accountNumber" inputMode="numeric" pattern="[0-9]{4,24}" minLength={4} maxLength={24} autoComplete="off" required />
              </label>
              <label>
                <span>Exact {selected.platform} Server</span>
                <input
                  name="brokerServer"
                  minLength={2}
                  maxLength={160}
                  required
                  defaultValue={selected.demoAccount?.brokerServer || ''}
                  placeholder="Example: Broker-Demo"
                  aria-describedby={`server-help-${selected.id}`}
                />
              </label>
              <p className={styles.fieldHelp} id={`server-help-${selected.id}`}>
                Copy this from {selected.platform} → File → Login to Trade Account → Server. Use the complete server value, not the broker or company name.
              </p>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setDemoEditing(false)}>Cancel</button>
                <button type="submit" className={styles.primaryButton}>Review {selected.demoAccount ? 'change' : 'registration'}</button>
              </div>
            </form>}
          </article>

          <article className={styles.identityCard} aria-labelledby={`device-card-${selected.id}`}>
            <header className={styles.cardHeader}>
              <span className={styles.cardIcon}><MonitorCheck size={21} /></span>
              <span><small>Installation security</small><h3 id={`device-card-${selected.id}`}>Active Device</h3></span>
              <span className={styles.cardStatus} data-tone={selected.installation ? 'active' : 'empty'}>
                {selected.installation ? 'Protected' : 'Not paired'}
              </span>
            </header>

            {selected.installation ? <dl className={styles.detailsList}>
              <div><dt>Device</dt><dd>{selected.installation.label}</dd></div>
              <div><dt>Installation</dt><dd>{selected.installation.hint}</dd></div>
              <div><dt>Activated</dt><dd>{formatDate(selected.installation.activatedAt)}</dd></div>
              <div><dt>Last verified</dt><dd>{selected.installation.lastSeenAt ? formatDate(selected.installation.lastSeenAt) : 'Waiting for first check'}</dd></div>
            </dl> : <div className={styles.emptyState}>
              <strong>No active device</strong>
              <p>Attach the EA, enter your license key, then return here to approve the six-digit request.</p>
            </div>}

            <div className={styles.seatNote}><ShieldCheck size={17} /><span><strong>One active device per license</strong><small>Approving a replacement securely deactivates the previous device.</small></span></div>
            <div className={styles.cardActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void checkForDeviceRequest()} disabled={checking || saving !== null}>
                <RefreshCw size={17} className={checking ? styles.spin : undefined} />
                {checking ? 'Checking…' : selected.pendingInstallationRequest ? 'Refresh request' : 'Check for device request'}
              </button>
              {!selected.canReplaceInstallation ? <small className={styles.locked}>{installationEligibilityText(selected)}</small> : null}
            </div>
          </article>
        </div>

        <details className={styles.advancedRecovery}>
          <summary>
            <span className={styles.recoveryTitle}><Laptop size={19} /><span><b>Advanced Recovery</b><small>Use an Installation ID only when automatic approval cannot connect.</small></span></span>
            <ChevronDown size={19} className={styles.chevron} aria-hidden="true" />
          </summary>
          <form className={styles.recoveryForm} key={`install-${selected.id}-${selected.installation?.id || 'new'}`} onSubmit={reviewInstallation}>
            <div className={styles.recoveryIntro}>
              <strong>{selected.installation ? 'Move this license to another device' : 'Pair a device manually'}</strong>
              <p>Copy the complete <b>ORION INSTALLATION ID</b> from the EA Experts log. A replacement immediately deactivates the current device.</p>
            </div>
            <label>
              <span>Installation ID from EA</span>
              <input name="installationId" autoComplete="off" spellCheck={false} required pattern="ORN-INST-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){5}" placeholder="ORN-INST-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" />
            </label>
            <label>
              <span>Device label</span>
              <input name="deviceLabel" minLength={2} maxLength={60} required placeholder="Example: Home laptop MT5" />
            </label>
            <button className={styles.primaryButton} disabled={saving !== null || !selected.canReplaceInstallation}>
              Review {selected.installation ? 'device replacement' : 'device activation'}
            </button>
            {!selected.canReplaceInstallation ? <small className={styles.locked}>{installationEligibilityText(selected)}</small> : null}
          </form>
        </details>
      </> : null}
    </> : <p className={styles.empty}>No license has been assigned yet. Demo and device security becomes available after Orion activates a license.</p> : null}

    {confirmation && confirmationView ? <div className={styles.dialogBackdrop}>
      <div
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="license-confirmation-title"
        aria-describedby="license-confirmation-description"
        aria-busy={saving !== null}
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <span className={styles.dialogIcon} data-tone={confirmationView.tone}><ShieldAlert size={22} /></span>
          <span><small>Security confirmation</small><h3 id="license-confirmation-title">{confirmationView.title}</h3></span>
          <button type="button" className={styles.dialogClose} onClick={closeConfirmation} disabled={saving !== null} aria-label="Close confirmation"><X size={19} /></button>
        </header>
        <p id="license-confirmation-description" className={styles.dialogDescription}>{confirmationView.description}</p>
        {error ? <p className={styles.dialogError} role="alert"><ShieldAlert size={18} />{error}</p> : null}
        <div className={styles.comparison}>
          <div><small>Current</small><strong>{confirmationView.currentTitle}</strong><span>{confirmationView.currentDetail}</span></div>
          <span aria-hidden="true">→</span>
          <div><small>{confirmationView.nextLabel}</small><strong>{confirmationView.nextTitle}</strong><span>{confirmationView.nextDetail}</span></div>
        </div>
        <p className={styles.consequence} data-tone={confirmationView.tone}><ShieldCheck size={18} />{confirmationView.consequence}</p>
        <footer className={styles.dialogActions}>
          <button ref={cancelButtonRef} type="button" className={styles.secondaryButton} onClick={closeConfirmation} disabled={saving !== null}>Cancel</button>
          <button type="button" className={styles.primaryButton} onClick={() => void confirmChange()} disabled={saving !== null}>
            {saving !== null ? 'Saving securely…' : confirmationView.confirmLabel}
          </button>
        </footer>
      </div>
    </div> : null}
  </section>;
}

function PendingRequestCard({
  license,
  saving,
  onDecision,
}: {
  license: RuntimeLicense;
  saving: 'demo' | 'installation' | 'device-request' | null;
  onDecision: (decision: 'Approve' | 'Reject') => void;
}) {
  const pending = license.pendingInstallationRequest;
  if (!pending) return null;
  return <section className={styles.pendingRequest} aria-labelledby="pending-installation-title">
    <header>
      <span className={styles.pendingIcon}><ShieldAlert size={22} /></span>
      <div>
        <small>Action required · New device waiting</small>
        <h3 id="pending-installation-title">Match this code with your EA</h3>
        <p>Approve only if the same six digits appear on the MetaTrader chart or in the Experts log.</p>
      </div>
      <code aria-label={`Approval code ${pending.matchCode.split('').join(' ')}`}>{formatMatchCode(pending.matchCode)}</code>
    </header>
    <div className={styles.pendingDetails}>
      <span><small>New device</small><strong>{pending.label}</strong><b>{pending.hint}</b></span>
      <span><small>Trading identity</small><strong>{pending.accountType} · {pending.maskedAccountNumber}</strong><b>{pending.platform} · {pending.brokerServer}</b></span>
      <span><small>Request expires</small><strong><Clock3 size={15} /><time dateTime={pending.expiresAt}>{formatDate(pending.expiresAt)}</time></strong><b>{license.installation ? `Approval replaces ${license.installation.hint}.` : 'Approval activates the first device.'}</b></span>
    </div>
    <div className={styles.pendingActions}>
      <button type="button" className={styles.primaryButton} onClick={() => onDecision('Approve')} disabled={saving !== null || !license.canReplaceInstallation}>
        <BadgeCheck size={17} />{license.installation ? 'Review device replacement' : 'Review device approval'}
      </button>
      <button type="button" className={styles.secondaryButton} onClick={() => onDecision('Reject')} disabled={saving !== null}>
        <XCircle size={17} />Reject request
      </button>
    </div>
    {!license.canReplaceInstallation ? <small className={styles.pendingLocked}>{installationEligibilityText(license)}</small> : null}
  </section>;
}

function buildConfirmationView(confirmation: ConfirmationState, license: RuntimeLicense | null) {
  if (!license) return null;
  if (confirmation.kind === 'demo') {
    return {
      tone: confirmation.intent === 'Replace' ? 'warning' : 'standard',
      title: confirmation.intent === 'Replace' ? 'Change this Demo account?' : 'Register this Demo account?',
      description: 'Check the account number and exact MetaTrader server before saving this license identity.',
      currentTitle: license.demoAccount?.maskedAccountNumber || 'No Demo account',
      currentDetail: license.demoAccount ? license.demoAccount.brokerServer : 'No Demo identity is currently registered.',
      nextLabel: 'New Demo identity',
      nextTitle: confirmation.accountNumber,
      nextDetail: confirmation.brokerServer,
      consequence: confirmation.intent === 'Replace'
        ? 'The previous Demo login will stop validating with this license.'
        : `Only this Demo login on the exact ${license.platform} server will validate with this license.`,
      confirmLabel: confirmation.intent === 'Replace' ? 'Confirm Demo change' : 'Confirm Demo registration',
    };
  }
  if (confirmation.kind === 'installation') {
    return {
      tone: confirmation.intent === 'Replace' ? 'warning' : 'standard',
      title: confirmation.intent === 'Replace' ? 'Replace the active device?' : 'Activate this device?',
      description: 'Confirm the EA Installation ID belongs to the device you want to protect with this license.',
      currentTitle: license.installation?.label || 'No active device',
      currentDetail: license.installation?.hint || 'No installation currently uses this device seat.',
      nextLabel: 'New device',
      nextTitle: confirmation.deviceLabel,
      nextDetail: installationHint(confirmation.installationId),
      consequence: confirmation.intent === 'Replace'
        ? 'The current PC, laptop, or VPS will be deactivated immediately.'
        : 'This becomes the one active device allowed for this license.',
      confirmLabel: confirmation.intent === 'Replace' ? 'Confirm device replacement' : 'Confirm device activation',
    };
  }

  const pending = license.pendingInstallationRequest?.id === confirmation.pairingRequestId
    ? license.pendingInstallationRequest
    : null;
  if (!pending) return null;
  if (confirmation.decision === 'Reject') {
    return {
      tone: 'danger',
      title: 'Reject this device request?',
      description: `You are rejecting the request with approval code ${pending.matchCode}.`,
      currentTitle: license.installation?.label || 'No active device',
      currentDetail: license.installation?.hint || 'No installation is active.',
      nextLabel: 'Rejected request',
      nextTitle: pending.label,
      nextDetail: `${pending.hint} · code ${formatMatchCode(pending.matchCode)}`,
      consequence: 'The current device remains unchanged. The requesting EA will not be activated.',
      confirmLabel: 'Confirm rejection',
    };
  }
  return {
    tone: license.installation ? 'warning' : 'standard',
    title: license.installation ? 'Approve and replace the active device?' : 'Approve this device?',
    description: `Confirm that approval code ${pending.matchCode} matches the code shown by your EA.`,
    currentTitle: license.installation?.label || 'No active device',
    currentDetail: license.installation?.hint || 'The device seat is available.',
    nextLabel: 'Approved device',
    nextTitle: pending.label,
    nextDetail: `${pending.hint} · ${pending.platform} · ${pending.brokerServer}`,
    consequence: license.installation
      ? 'Approval immediately deactivates the current device and transfers the license seat.'
      : 'This becomes the one active device allowed for this license.',
    confirmLabel: license.installation ? 'Approve and replace device' : 'Approve device',
  };
}

function membershipRule(tier: LicenseRuntimeSnapshot['membership']['effectiveTier']) {
  return tier === 'Pro' ? 'up to two Demo changes per rolling 24 hours' : 'one Demo change every 7 days';
}

function demoEligibilityText(license: RuntimeLicense) {
  if (license.demoCooldownReason === 'standard') return `Standard Demo replacement unlocks ${formatDate(license.nextDemoChangeAt)}.`;
  if (license.demoCooldownReason === 'pro-security') return `Pro security protection resets ${formatDate(license.nextDemoChangeAt)}.`;
  if (license.demoCooldownReason === 'inactive') return 'Your Orion client account must be active.';
  return 'This license must be active before registering a Demo account.';
}

function installationEligibilityText(license: RuntimeLicense) {
  if (license.installationCooldownReason === 'security-limit') return `Device replacement unlocks ${formatDate(license.nextInstallationChangeAt)}.`;
  if (license.installationCooldownReason === 'inactive') return 'Your Orion client account must be active.';
  return 'This license must be active before pairing a device.';
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMatchCode(value: string) {
  return value.length === 6 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
}
