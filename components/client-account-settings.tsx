'use client';

import Image from 'next/image';
import Link from 'next/link';
import React, { FormEvent, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  KeyRound,
  Laptop,
  LockKeyhole,
  MailCheck,
  Palette,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';
import PasswordField from '@/components/password-field';
import type { AccountSecurityEvent } from '@/lib/account-security-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import styles from './client-account-settings.module.css';

export type SecurityActivity = {
  id: string;
  type: string;
  title: string;
  detail: string;
  createdAt: string;
  device: string;
  current?: boolean;
};

type SecurityResponse = {
  preferences: { licenseReminders: boolean; securityAlerts: true };
  activities: SecurityActivity[];
};

export type Enrollment = { factorId: string; qrCode: string; secret: string };

type Props = {
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  accountCreatedAt: string;
  lastSignInAt: string | null;
  currentDevice: string;
  initialFactorId: string | null;
};

export default function ClientAccountSettings({
  email,
  emailVerified,
  pendingEmail,
  accountCreatedAt,
  lastSignInAt,
  currentDevice,
  initialFactorId,
}: Props) {
  const [securityData, setSecurityData] = useState<SecurityResponse | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [loadingSecurity, setLoadingSecurity] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [factorId, setFactorId] = useState(initialFactorId);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const enrollmentRef = useRef<Enrollment | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/account-security', { cache: 'no-store', credentials: 'same-origin' });
        const payload = await response.json().catch(() => null) as SecurityResponse | { error?: string } | null;
        if (!response.ok || !payload || !('activities' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load account security.');
        if (!active) return;
        setSecurityData(payload);
        setBackendAvailable(true);
        setLoadError('');
      } catch (reason) {
        if (!active) return;
        setBackendAvailable(false);
        setLoadError(reason instanceof Error ? reason.message : 'Account security is temporarily unavailable.');
      } finally {
        if (active) setLoadingSecurity(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    enrollmentRef.current = enrollment;
  }, [enrollment]);

  useEffect(() => () => {
    const abandoned = enrollmentRef.current;
    if (abandoned) void createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: abandoned.factorId });
  }, []);

  function prependActivity(activity: SecurityActivity | undefined) {
    if (!activity) return;
    setSecurityData((current) => current ? {
      ...current,
      activities: [activity, ...current.activities.filter((item) => item.id !== activity.id)].slice(0, 12),
    } : current);
  }

  async function recordEvent(event: AccountSecurityEvent) {
    try {
      const response = await fetch('/api/account-security', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      const payload = await response.json().catch(() => null) as { activity?: SecurityActivity } | null;
      if (response.ok) prependActivity(payload?.activity);
    } catch { /* The sensitive Supabase action must not be rolled back only because auditing is unavailable. */ }
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p><ShieldCheck size={14} aria-hidden="true" />Account protection</p>
          <h2>Security, made <span>clear.</span></h2>
          <div>Manage your password, authenticator, active access, and essential account alerts from one protected place.</div>
        </div>
        <div className={styles.heroSignal} aria-label={factorId ? 'Advanced account protection active' : 'Standard account protection active'}>
          <span><Shield size={27} aria-hidden="true" /><i /></span>
          <div><small>Protection level</small><strong>{factorId ? 'Authenticator protected' : 'Standard protection'}</strong><p>{factorId ? 'Two-step verification is required' : 'Add an authenticator for stronger access'}</p></div>
        </div>
      </header>

      <section className={styles.statusGrid} aria-label="Account security status">
        <StatusCard icon={<MailCheck size={18} />} label="Email status" value={emailVerified ? 'Verified' : 'Verification pending'} detail={pendingEmail ? `Pending change to ${pendingEmail}` : email} tone={emailVerified ? 'green' : 'amber'} />
        <StatusCard icon={<Smartphone size={18} />} label="Authenticator" value={factorId ? 'Enabled' : 'Not enabled'} detail={factorId ? 'Required at every new sign-in' : 'One password currently protects access'} tone={factorId ? 'cyan' : 'violet'} />
        <StatusCard icon={<Clock3 size={18} />} label="Last successful sign-in" value={formatDate(lastSignInAt, 'Not recorded yet')} detail={currentDevice} tone="gold" />
      </section>

      {loadError && <div className={styles.migrationNotice} role="status"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Security records are not active yet</strong><span>{loadError} Password and existing authenticator controls remain available; new authenticator enrollment waits for database protection.</span></div></div>}

      <div className={styles.primaryGrid}>
        <PasswordPanel onRecorded={prependActivity} />
        <MfaPanel
          factorId={factorId}
          setFactorId={setFactorId}
          enrollment={enrollment}
          enrollmentRef={enrollmentRef}
          setEnrollment={setEnrollment}
          canEnroll={backendAvailable === true}
          onRecord={recordEvent}
        />
      </div>

      <div className={styles.secondaryGrid}>
        <SessionPanel currentDevice={currentDevice} lastSignInAt={lastSignInAt} onRecord={recordEvent} />
        <PreferencesPanel
          loading={loadingSecurity}
          available={backendAvailable === true}
          preferences={securityData?.preferences || null}
          onPreferences={(preferences) => setSecurityData((current) => current ? { ...current, preferences } : current)}
        />
      </div>

      <ActivityPanel loading={loadingSecurity} available={backendAvailable === true} activities={securityData?.activities || []} />

      <section className={styles.accountLinks} aria-label="Related account settings">
        <div><small>Account preferences</small><strong>Keep the rest of your workspace current</strong><p>Profile details and the visual theme stay in their existing focused controls.</p></div>
        <Link href="/portal/profile"><UserRound size={15} aria-hidden="true" />Edit client profile</Link>
        <button type="button" onClick={() => {
          const toggle = document.querySelector<HTMLButtonElement>('.portal-theme-quick-toggle');
          toggle?.click();
          toggle?.focus();
        }}><Palette size={15} aria-hidden="true" />Switch workspace color</button>
      </section>

      <p className={styles.rolloutNote}>Security activity is recorded from this update onward. Older device history is not invented or backfilled. Supabase authentication logs remain the authoritative security record. Account created {formatDate(accountCreatedAt, 'date unavailable')}.</p>
    </div>
  );
}

export function StatusCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className={styles.statusCard} data-tone={tone}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div><i aria-hidden="true" /></article>;
}

export function PasswordPanel({ onRecorded, endpoint = '/api/account-security' }: { onRecorded: (activity: SecurityActivity | undefined) => void; endpoint?: '/api/account-security' | '/api/admin-account-security' }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsNonce, setNeedsNonce] = useState(false);
  const [nonceSent, setNonceSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function clearSecrets() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setNonce('');
    setNeedsNonce(false);
    setNonceSent(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (newPassword.length < 10) return setMessage({ type: 'error', text: 'Use at least 10 characters for your new password.' });
    if (newPassword !== confirmPassword) return setMessage({ type: 'error', text: 'Your new passwords do not match.' });
    if (!currentPassword && !nonce) return setMessage({ type: 'error', text: 'Enter your current password to confirm this change.' });
    if (needsNonce && nonce.replace(/\D/g, '').length !== 6) return setMessage({ type: 'error', text: 'Enter the six-digit email verification code.' });

    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      ...(currentPassword ? { current_password: currentPassword } : {}),
      ...(nonce ? { nonce: nonce.replace(/\D/g, '').slice(0, 6) } : {}),
    });
    if (error) {
      const code = 'code' in error ? String(error.code || '') : '';
      if (/reauthentication|reauth/i.test(code) || /reauthenticat/i.test(error.message)) {
        setNeedsNonce(true);
        setMessage({ type: 'error', text: 'Supabase requires a fresh email verification code for this sensitive change.' });
      } else if (/same_password/i.test(code)) {
        setMessage({ type: 'error', text: 'Choose a password different from your current password.' });
      } else if (/weak_password/i.test(code)) {
        setMessage({ type: 'error', text: 'That password does not meet the account security policy.' });
      } else {
        setMessage({ type: 'error', text: 'The password could not be changed. Check your current password or verification code.' });
      }
      setLoading(false);
      return;
    }
    clearSecrets();
    setMessage({ type: 'success', text: 'Password changed successfully. Your current session remains protected.' });
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'password_changed' }) });
      const payload = await response.json().catch(() => null) as { activity?: SecurityActivity } | null;
      if (response.ok) onRecorded(payload?.activity);
    } catch { /* Password success is authoritative even if the local activity feed is unavailable. */ }
    setLoading(false);
  }

  async function sendNonce() {
    setLoading(true);
    setMessage(null);
    const { error } = await createSupabaseBrowserClient().auth.reauthenticate();
    if (error) setMessage({ type: 'error', text: 'The verification email could not be sent. Please wait and try again.' });
    else {
      setNonceSent(true);
      setNeedsNonce(true);
      setMessage({ type: 'success', text: 'A six-digit verification code was sent to your account email.' });
    }
    setLoading(false);
  }

  return (
    <section className={styles.panel} aria-labelledby="password-settings-title">
      <PanelHeading id="password-settings-title" icon={<KeyRound size={18} />} eyebrow="Password" title="Change your password" detail="Your password is sent directly to Supabase and never passes through an Orion API." />
      <form className={styles.passwordForm} onSubmit={submit} aria-busy={loading}>
        <PasswordField id="security-current-password" label="Current password" autoComplete="current-password" minLength={8} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <PasswordField id="security-new-password" label="New password" autoComplete="new-password" minLength={10} value={newPassword} showStrength onChange={(event) => setNewPassword(event.target.value)} />
        <PasswordField id="security-confirm-password" label="Confirm new password" autoComplete="new-password" minLength={10} value={confirmPassword} matchValue={newPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        {needsNonce && <label className={styles.codeField} htmlFor="security-email-code"><span>Email verification code</span><input id="security-email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={nonce} onChange={(event) => setNonce(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /><small>{nonceSent ? 'Use the newest code in your email.' : 'Request a fresh code before continuing.'}</small></label>}
        {message && <p className={message.type === 'error' ? styles.error : styles.success} role={message.type === 'error' ? 'alert' : 'status'}>{message.type === 'success' ? <Check size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{message.text}</p>}
        <div className={styles.formActions}>
          <button className={styles.primaryButton} type="submit" disabled={loading}>{loading ? 'Securing…' : 'Update password'}</button>
          {needsNonce && <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void sendNonce()}>{nonceSent ? 'Send a new code' : 'Send verification code'}</button>}
        </div>
      </form>
    </section>
  );
}

export function MfaPanel({ factorId, setFactorId, enrollment, enrollmentRef, setEnrollment, canEnroll, onRecord, context = 'client' }: {
  factorId: string | null;
  setFactorId: (value: string | null) => void;
  enrollment: Enrollment | null;
  enrollmentRef: React.MutableRefObject<Enrollment | null>;
  setEnrollment: (value: Enrollment | null) => void;
  canEnroll: boolean;
  onRecord: (event: AccountSecurityEvent) => Promise<void>;
  context?: 'client' | 'admin';
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const enrollmentCodeRef = useRef<HTMLInputElement>(null);
  const removeConfirmRef = useRef<HTMLButtonElement>(null);
  const removeTriggerRef = useRef<HTMLButtonElement>(null);
  const setupTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (enrollment) enrollmentCodeRef.current?.focus();
  }, [enrollment]);

  useEffect(() => {
    if (confirmDisable) removeConfirmRef.current?.focus();
  }, [confirmDisable]);

  async function startEnrollment() {
    if (!canEnroll) return;
    setLoading(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    const factors = await supabase.auth.mfa.listFactors();
    if (!factors.error) {
      await Promise.all(factors.data.all
        .filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified')
        .map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })));
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Orion Authenticator', issuer: 'Orion Scalper' });
    if (error || !data || data.type !== 'totp') {
      setMessage({ type: 'error', text: /disabled|not enabled/i.test(error?.message || '') ? 'Authenticator enrollment must first be enabled in Supabase.' : 'Authenticator setup could not start. Please try again.' });
      setLoading(false);
      return;
    }
    const pending = {
      factorId: data.id,
      qrCode: data.totp.qr_code.startsWith('data:image/svg+xml')
        ? data.totp.qr_code
        : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`,
      secret: data.totp.secret,
    };
    enrollmentRef.current = pending;
    setEnrollment(pending);
    setCode('');
    setLoading(false);
  }

  async function verifyEnrollment(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    const cleanCode = code.replace(/\D/g, '').slice(0, 6);
    if (cleanCode.length !== 6) return setMessage({ type: 'error', text: 'Enter the complete six-digit code from your authenticator.' });
    setLoading(true);
    setMessage(null);
    const { error } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: cleanCode });
    if (error) {
      setMessage({ type: 'error', text: 'That code is incorrect or expired. Wait for a new code and try again.' });
      setLoading(false);
      return;
    }
    setFactorId(enrollment.factorId);
    enrollmentRef.current = null;
    setEnrollment(null);
    setCode('');
    await onRecord('mfa_enabled');
    setMessage({ type: 'success', text: 'Authenticator protection is active. New sign-ins now require a code.' });
    setLoading(false);
    window.setTimeout(() => removeTriggerRef.current?.focus(), 0);
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    setLoading(true);
    await createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: enrollment.factorId });
    enrollmentRef.current = null;
    setEnrollment(null);
    setCode('');
    setMessage(null);
    setLoading(false);
    window.setTimeout(() => setupTriggerRef.current?.focus(), 0);
  }

  async function disableMfa() {
    if (!factorId || !confirmDisable) return;
    setLoading(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setMessage({ type: 'error', text: 'Authenticator protection could not be removed. Verify this session again and retry.' });
      setLoading(false);
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    const remaining = factors.error ? [] : factors.data.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
    setFactorId(remaining[0]?.id || null);
    setConfirmDisable(false);
    if (remaining.length) {
      setMessage({ type: 'success', text: 'That authenticator was removed. Another verified authenticator still protects this account.' });
    } else {
      await onRecord('mfa_disabled');
      await supabase.auth.refreshSession();
      setMessage({ type: 'success', text: 'Authenticator protection was removed from this account.' });
    }
    setLoading(false);
    window.setTimeout(() => (remaining.length ? removeTriggerRef : setupTriggerRef).current?.focus(), 0);
  }

  return (
    <section className={styles.panel} aria-labelledby="mfa-settings-title">
      <PanelHeading id="mfa-settings-title" icon={<Smartphone size={18} />} eyebrow="Two-step verification" title="Authenticator app" detail="Use Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another TOTP app." />
      {factorId ? (
        <div className={styles.mfaEnabled}>
          <div className={styles.protectedState}><span><ShieldCheck size={22} aria-hidden="true" /></span><div><small>Current state</small><strong>Authenticator enabled</strong><p>A fresh six-digit code is required after password sign-in.</p></div></div>
          <div className={styles.recoveryNote}><ShieldAlert size={16} aria-hidden="true" /><p>{context === 'admin' ? 'If you lose the authenticator, use Orion’s approved administrator recovery process with another authorized owner. Supabase TOTP does not provide recovery codes here.' : 'If you lose the authenticator, contact Orion support for identity-verified recovery. Supabase TOTP does not provide recovery codes here.'}</p></div>
          {message && <p className={message.type === 'error' ? styles.error : styles.success} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
          {!confirmDisable ? <button ref={removeTriggerRef} className={styles.dangerLink} type="button" onClick={() => setConfirmDisable(true)}>Remove this authenticator</button> : <div className={styles.confirmDanger}><p>If this is your final verified authenticator, the account returns to password-only access.</p><button ref={removeConfirmRef} type="button" disabled={loading} onClick={() => void disableMfa()}>{loading ? 'Removing…' : 'Yes, remove it'}</button><button type="button" disabled={loading} onClick={() => { setConfirmDisable(false); window.setTimeout(() => removeTriggerRef.current?.focus(), 0); }}>Keep protection</button></div>}
        </div>
      ) : enrollment ? (
        <form className={styles.enrollment} onSubmit={verifyEnrollment}>
          <ol><li><span>1</span><p><strong>Scan this QR code</strong>Open your authenticator app and add a new account.</p></li></ol>
          <div className={styles.qrWrap}><Image src={enrollment.qrCode} alt="Orion authenticator enrollment QR code" width={190} height={190} unoptimized priority /></div>
          <div className={styles.manualSecret}><small>Can’t scan? Enter this setup key manually</small><code>{enrollment.secret}</code><button type="button" onClick={async () => { try { await navigator.clipboard?.writeText(enrollment.secret); setCopied(true); } catch { setCopied(false); } }}><Copy size={13} aria-hidden="true" />{copied ? 'Key copied' : 'Copy key'}</button><span className="orion-visually-hidden" aria-live="polite">{copied ? 'Authenticator setup key copied.' : ''}</span></div>
          <label className={styles.codeField} htmlFor="mfa-enrollment-code"><span>2. Enter the current six-digit code</span><input ref={enrollmentCodeRef} id="mfa-enrollment-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label>
          {message && <p className={message.type === 'error' ? styles.error : styles.success} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
          <div className={styles.formActions}><button className={styles.primaryButton} type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify authenticator'}</button><button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void cancelEnrollment()}>Cancel safely</button></div>
        </form>
      ) : (
        <div className={styles.mfaEmpty}>
          <div className={styles.mfaDiagram} aria-hidden="true"><span><LockKeyhole size={18} /></span><i /><span><Smartphone size={18} /></span><i /><span><ShieldCheck size={18} /></span></div>
          <ul><li><CheckCircle2 size={14} aria-hidden="true" />Blocks password-only {context === 'admin' ? 'administrator' : 'portal'} access</li><li><CheckCircle2 size={14} aria-hidden="true" />Codes refresh every 30 seconds</li><li><CheckCircle2 size={14} aria-hidden="true" />Secrets stay between you and Supabase</li></ul>
          {message && <p className={message.type === 'error' ? styles.error : styles.success} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
          <button ref={setupTriggerRef} className={styles.primaryButton} type="button" disabled={loading || !canEnroll} onClick={() => void startEnrollment()}>{loading ? 'Preparing…' : canEnroll ? 'Set up authenticator' : 'Setup temporarily unavailable'}</button>
        </div>
      )}
    </section>
  );
}

export function SessionPanel({ currentDevice, lastSignInAt, onRecord }: { currentDevice: string; lastSignInAt: string | null; onRecord: (event: AccountSecurityEvent) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  async function revokeOthers() {
    setLoading(true);
    setMessage(null);
    const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: 'others' });
    if (error) setMessage({ type: 'error', text: 'Other sessions could not be signed out. Your current session is unchanged.' });
    else {
      await onRecord('other_sessions_signed_out');
      setMessage({ type: 'success', text: 'Other device refresh access was revoked. This session remains signed in.' });
      setConfirm(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
    setLoading(false);
  }

  return (
    <section className={styles.panel} aria-labelledby="session-settings-title">
      <PanelHeading id="session-settings-title" icon={<Laptop size={18} />} eyebrow="Session control" title="Current access" detail="Review this browser and remove refresh access from other signed-in devices." />
      <div className={styles.currentSession}><span><Laptop size={20} aria-hidden="true" /><i /></span><div><small>This browser</small><strong>{currentDevice}</strong><p>Last successful sign-in {formatDate(lastSignInAt, 'not recorded')}</p></div><b>Current</b></div>
      <p className={styles.sessionLimit}>Supabase does not expose a reliable per-device session list here. Revoking other sessions affects their refresh tokens; an already-issued access token can remain valid until it expires.</p>
      {message && <p className={message.type === 'error' ? styles.error : styles.success} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {!confirm ? <button ref={triggerRef} className={styles.secondaryButton} type="button" onClick={() => setConfirm(true)}>Sign out other devices</button> : <div className={styles.confirmDanger}><p>Keep this browser signed in and revoke refresh access everywhere else?</p><button ref={confirmRef} type="button" disabled={loading} onClick={() => void revokeOthers()}>{loading ? 'Signing out…' : 'Confirm sign out'}</button><button type="button" disabled={loading} onClick={() => { setConfirm(false); window.setTimeout(() => triggerRef.current?.focus(), 0); }}>Cancel</button></div>}
    </section>
  );
}

function PreferencesPanel({ loading, available, preferences, onPreferences }: { loading: boolean; available: boolean; preferences: SecurityResponse['preferences'] | null; onPreferences: (preferences: SecurityResponse['preferences']) => void }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function setLicenseReminders(value: boolean) {
    if (!available || !preferences) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/account-security', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ licenseReminders: value }) });
      const payload = await response.json().catch(() => null) as { preferences?: SecurityResponse['preferences']; error?: string } | null;
      if (!response.ok || !payload?.preferences) throw new Error(payload?.error || 'Unable to save the preference.');
      onPreferences(payload.preferences);
      setMessage('Notification preference saved.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to save the preference.'); }
    setSaving(false);
  }

  return (
    <section className={styles.panel} aria-labelledby="notification-settings-title">
      <PanelHeading id="notification-settings-title" icon={<BellRing size={18} />} eyebrow="Notifications" title="Account alerts" detail="Choose optional reminders without weakening essential security messages." />
      <div className={styles.preferenceList} aria-busy={loading || saving}>
        <div><span><ShieldCheck size={17} aria-hidden="true" /></span><div><strong>Security alerts</strong><p>Password, authenticator, and session changes</p></div><b>Always on</b></div>
        <label className={!available ? styles.disabledPreference : ''}>
          <span><KeyRound size={17} aria-hidden="true" /></span><div><strong>License renewal email</strong><p>Optional reminders before a license expires</p></div>
          <input type="checkbox" checked={preferences?.licenseReminders ?? true} disabled={!available || saving} onChange={(event) => void setLicenseReminders(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
      </div>
      <p className={styles.preferenceNote}>{loading ? 'Loading your saved preferences…' : available ? message || 'Receipts and essential account/security updates remain on.' : 'Apply the account-security migration to enable this real delivery preference.'}</p>
    </section>
  );
}

export function ActivityPanel({ loading, available, activities }: { loading: boolean; available: boolean; activities: SecurityActivity[] }) {
  return (
    <section className={`${styles.panel} ${styles.activityPanel}`} aria-labelledby="security-activity-title">
      <PanelHeading id="security-activity-title" icon={<RefreshCw size={18} />} eyebrow="Forward-only record" title="Recent security activity" detail="New Orion security events appear here with normalized device details. Raw IP addresses and full browser strings are not stored." />
      {loading ? <div className={styles.activityLoading} role="status"><span /><span /><span /><p>Loading protected activity…</p></div> : !available ? <div className={styles.activityEmpty}><ShieldAlert size={21} aria-hidden="true" /><strong>Activity recording is waiting for activation</strong><p>No historical devices are fabricated while the database migration is pending.</p></div> : activities.length === 0 ? <div className={styles.activityEmpty}><ShieldCheck size={21} aria-hidden="true" /><strong>No security events recorded yet</strong><p>Your first sign-in or account protection change after this release will appear here.</p></div> : <ol className={styles.activityList}>{activities.map((activity) => <li key={activity.id}><span data-type={activity.type}><SecurityActivityIcon type={activity.type} /></span><div><strong>{activity.title}{activity.current && <b>Current</b>}</strong><p>{activity.detail}</p><small>{activity.device}</small></div><time dateTime={activity.createdAt}>{formatDate(activity.createdAt, 'Date unavailable')}</time></li>)}</ol>}
    </section>
  );
}

function SecurityActivityIcon({ type }: { type: string }) {
  if (type.includes('password')) return <KeyRound size={16} />;
  if (type.includes('mfa')) return <Smartphone size={16} />;
  if (type.includes('session')) return <Laptop size={16} />;
  return <ShieldCheck size={16} />;
}

export function PanelHeading({ id, icon, eyebrow, title, detail }: { id: string; icon: React.ReactNode; eyebrow: string; title: string; detail: string }) {
  return <header className={styles.panelHeading}><span aria-hidden="true">{icon}</span><div><small>{eyebrow}</small><h3 id={id}>{title}</h3><p>{detail}</p></div></header>;
}

export function formatDate(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`;
}
