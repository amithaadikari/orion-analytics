'use client';

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  Clock3,
  Database,
  History,
  MailCheck,
  Palette,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';
import ClientAvatar from '@/components/client-avatar';
import { clientAvatarPresets, type ClientAvatarKey } from '@/lib/client-profile';
import type { AdminAccountPreferences, AdminProfile, AdminDashboardTheme } from '@/lib/admin-account';
import {
  ActivityPanel,
  MfaPanel,
  PanelHeading,
  PasswordPanel,
  SessionPanel,
  StatusCard,
  formatDate,
  type Enrollment,
  type SecurityActivity,
} from '@/components/client-account-settings';
import securityStyles from './client-account-settings.module.css';
import styles from './admin-settings-panel.module.css';

export type AdminAccountSnapshot = {
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  role: string;
  accountCreatedAt: string;
  lastSignInAt: string | null;
  currentDevice: string;
  initialFactorId: string | null;
  profile: AdminProfile;
  preferences: AdminAccountPreferences;
};

type AdminSettingsPanelProps = {
  account: AdminAccountSnapshot;
  theme: AdminDashboardTheme;
  onThemeChange: (theme: AdminDashboardTheme) => Promise<boolean> | boolean | void;
  onProfileChange: (profile: AdminProfile) => void;
  onPreferencesChange: (preferences: AdminAccountPreferences) => void;
  onNavigate: (section: string) => void;
};

type AdminSecurityResponse = {
  profile: AdminProfile;
  preferences: AdminAccountPreferences;
  activities: SecurityActivity[];
};

export default function AdminSettingsPanel({
  account,
  theme,
  onThemeChange,
  onProfileChange,
  onPreferencesChange,
  onNavigate,
}: AdminSettingsPanelProps) {
  const [profile, setProfile] = useState(account.profile);
  const [preferences, setPreferences] = useState(account.preferences);
  const [activities, setActivities] = useState<SecurityActivity[]>([]);
  const [loadingSecurity, setLoadingSecurity] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState('');
  const [factorId, setFactorId] = useState(account.initialFactorId);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const enrollmentRef = useRef<Enrollment | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin-account-security', { cache: 'no-store', credentials: 'same-origin' });
        const payload = await response.json().catch(() => null) as AdminSecurityResponse | { error?: string } | null;
        if (!response.ok || !payload || !('activities' in payload)) throw new Error(payload && 'error' in payload ? payload.error : 'Unable to load administrator security.');
        if (!active) return;
        setProfile(payload.profile);
        setPreferences(payload.preferences);
        setActivities(payload.activities);
        setBackendAvailable(true);
        setLoadError('');
        onProfileChange(payload.profile);
        onPreferencesChange(payload.preferences);
      } catch (reason) {
        if (!active) return;
        setBackendAvailable(false);
        setLoadError(reason instanceof Error ? reason.message : 'Administrator security is temporarily unavailable.');
      } finally {
        if (active) setLoadingSecurity(false);
      }
    })();
    return () => { active = false; };
  }, [onPreferencesChange, onProfileChange]);

  useEffect(() => { enrollmentRef.current = enrollment; }, [enrollment]);
  useEffect(() => () => {
    const abandoned = enrollmentRef.current;
    if (abandoned) void import('@/lib/supabase/browser').then(({ createSupabaseBrowserClient }) => createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: abandoned.factorId }));
  }, []);

  function prependActivity(activity: SecurityActivity | undefined) {
    if (!activity) return;
    setActivities((current) => [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, 12));
  }

  async function recordEvent(event: 'session_started' | 'password_changed' | 'mfa_enabled' | 'mfa_disabled' | 'other_sessions_signed_out') {
    try {
      const response = await fetch('/api/admin-account-security', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event }),
      });
      const payload = await response.json().catch(() => null) as { activity?: SecurityActivity } | null;
      if (response.ok) prependActivity(payload?.activity);
    } catch { /* A successful Supabase security action must not be rolled back only because local auditing is unavailable. */ }
  }

  const roleLabel = account.role === 'admin' ? 'Administrator' : 'Analytics viewer';
  const mfaEnabled = Boolean(factorId);

  return (
    <div className={`${securityStyles.page} ${styles.center}`} data-theme={theme}>
      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <ClientAvatar avatarKey={profile.avatarKey} size="large" />
          <div><p><ShieldCheck size={14} aria-hidden="true" />Administrator workspace</p><h2>{profile.displayName}</h2><span>{account.email}</span><small>{roleLabel} · protected Orion control center</small></div>
        </div>
        <div className={styles.protectionSignal} aria-label={mfaEnabled ? 'Advanced administrator protection active' : 'Standard administrator protection active'}>
          <span><Shield size={27} aria-hidden="true" /><i /></span>
          <div><small>Protection level</small><strong>{mfaEnabled ? 'Authenticator protected' : 'Standard protection'}</strong><p>{mfaEnabled ? 'Two-step verification is active' : 'Add an authenticator for stronger access'}</p></div>
        </div>
      </header>

      <section className={securityStyles.statusGrid} aria-label="Administrator security status">
        <StatusCard icon={<MailCheck size={18} />} label="Email status" value={account.emailVerified ? 'Verified' : 'Verification pending'} detail={account.pendingEmail ? `Pending change to ${account.pendingEmail}` : account.email} tone={account.emailVerified ? 'green' : 'amber'} />
        <StatusCard icon={<Smartphone size={18} />} label="Authenticator" value={mfaEnabled ? 'Enabled' : 'Not enabled'} detail={mfaEnabled ? 'Required after password sign-in' : 'Password-only access is currently allowed'} tone={mfaEnabled ? 'cyan' : 'violet'} />
        <StatusCard icon={<Clock3 size={18} />} label="Last successful sign-in" value={formatDate(account.lastSignInAt, 'Not recorded yet')} detail={account.currentDevice} tone="gold" />
      </section>

      {loadError && <div className={securityStyles.migrationNotice} role="status"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Administrator records are waiting for activation</strong><span>{loadError} Existing Supabase password, authenticator, and session controls remain available.</span></div></div>}

      <div className={styles.identityGrid}>
        <ProfileEditor profile={profile} available={backendAvailable === true} onSaved={(next) => { setProfile(next); onProfileChange(next); }} />
        <ThemeEditor theme={theme} onTheme={async (next) => {
          const previous = preferences.theme;
          setPreferences((current) => ({ ...current, theme: next }));
          const saved = await onThemeChange(next);
          if (saved === false) setPreferences((current) => ({ ...current, theme: previous }));
        }} />
      </div>

      <div className={securityStyles.primaryGrid}>
        <PasswordPanel endpoint="/api/admin-account-security" onRecorded={prependActivity} />
        <MfaPanel factorId={factorId} setFactorId={setFactorId} enrollment={enrollment} enrollmentRef={enrollmentRef} setEnrollment={setEnrollment} canEnroll onRecord={recordEvent} context="admin" />
      </div>

      <div className={securityStyles.secondaryGrid}>
        <SessionPanel currentDevice={account.currentDevice} lastSignInAt={account.lastSignInAt} onRecord={recordEvent} />
        <AlertPreferences
          loading={loadingSecurity}
          available={backendAvailable === true}
          preferences={preferences}
          onSaved={(next) => { setPreferences(next); onPreferencesChange(next); }}
        />
      </div>

      <ActivityPanel loading={loadingSecurity} available={backendAvailable === true} activities={activities} />

      <details className={styles.advanced}>
        <summary><span><Settings2 size={18} aria-hidden="true" /></span><div><small>Advanced system details</small><strong>Connections, privacy and operational links</strong><p>Open the technical status only when you need it.</p></div></summary>
        <div className={styles.advancedGrid}>
          <section><Database size={18} aria-hidden="true" /><strong>Protected connections</strong><p>Database credentials stay server-side. Telegram destinations are allow-listed and analytics delivery is monitored.</p></section>
          <section><ShieldCheck size={18} aria-hidden="true" /><strong>Privacy controls</strong><p>Raw IP addresses and full browser strings are not retained in the administrator activity feed.</p></section>
          <section><History size={18} aria-hidden="true" /><strong>Operational audit</strong><p>Business changes remain available in the client activity timeline.</p><button type="button" onClick={() => onNavigate('activity')}>Open audit trail</button></section>
        </div>
      </details>

      <p className={styles.retention}>Administrator security activity is forward-only and retained for 180 days. Supabase authentication audit logs remain authoritative. Account created {formatDate(account.accountCreatedAt, 'date unavailable')}.</p>
    </div>
  );
}

function ProfileEditor({ profile, available, onSaved }: { profile: AdminProfile; available: boolean; onSaved: (profile: AdminProfile) => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarKey, setAvatarKey] = useState<ClientAvatarKey>(profile.avatarKey);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { setDisplayName(profile.displayName); setAvatarKey(profile.avatarKey); }, [profile]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!available) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch('/api/admin-account-security', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'profile', displayName, avatarKey }) });
      const payload = await response.json().catch(() => null) as { profile?: AdminProfile; error?: string } | null;
      if (!response.ok || !payload?.profile) throw new Error(payload?.error || 'Unable to save administrator profile.');
      onSaved(payload.profile); setMessage({ tone: 'success', text: 'Administrator profile updated.' });
    } catch (reason) { setMessage({ tone: 'error', text: reason instanceof Error ? reason.message : 'Unable to save administrator profile.' }); }
    setSaving(false);
  }

  return <section className={`${securityStyles.panel} ${styles.profilePanel}`} aria-labelledby="admin-profile-title">
    <PanelHeading id="admin-profile-title" icon={<UserRound size={18} />} eyebrow="Administrator profile" title="Identity shown in the control center" detail="Choose a clear display name and an Orion trading avatar. Access level and email cannot be changed here." />
    <form className={styles.profileForm} onSubmit={submit} aria-busy={saving}>
      <label htmlFor="admin-display-name"><span>Display name</span><input id="admin-display-name" value={displayName} minLength={2} maxLength={80} required disabled={!available || saving} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <fieldset disabled={!available || saving}><legend>Trading avatar</legend><div className={styles.avatarGrid}>{clientAvatarPresets.map((avatar) => <button key={avatar.key} type="button" aria-pressed={avatarKey === avatar.key} onClick={() => setAvatarKey(avatar.key)}><ClientAvatar avatarKey={avatar.key} size="small" /><span><strong>{avatar.label}</strong><small>{avatar.category}</small></span></button>)}</div></fieldset>
      {message && <p className={message.tone === 'success' ? styles.success : styles.error} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <button className={securityStyles.primaryButton} type="submit" disabled={!available || saving}>{saving ? 'Saving profile…' : available ? 'Save profile' : 'Profile saving unavailable'}</button>
    </form>
  </section>;
}

function ThemeEditor({ theme, onTheme }: { theme: AdminDashboardTheme; onTheme: (theme: AdminDashboardTheme) => Promise<void> | void }) {
  return <section className={`${securityStyles.panel} ${styles.themePanel}`} aria-labelledby="admin-theme-title">
    <PanelHeading id="admin-theme-title" icon={<Palette size={18} />} eyebrow="Appearance" title="Control center theme" detail="Your selection is remembered for this browser and synchronized with your administrator preferences." />
    <div className={styles.themeOptions} aria-label="Dashboard color theme">
      <button type="button" aria-pressed={theme === 'royal'} onClick={() => void onTheme('royal')}><i data-theme="royal" /><span><strong>Royal black</strong><small>Gold, cyan and emerald signals</small></span></button>
      <button type="button" aria-pressed={theme === 'black'} onClick={() => void onTheme('black')}><i data-theme="black" /><span><strong>Deep black</strong><small>Cyan focus with reduced gold</small></span></button>
    </div>
  </section>;
}

function AlertPreferences({ loading, available, preferences, onSaved }: { loading: boolean; available: boolean; preferences: AdminAccountPreferences; onSaved: (preferences: AdminAccountPreferences) => void }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function change(key: keyof Pick<AdminAccountPreferences, 'registrationAlerts' | 'paymentAlerts' | 'licenseAlerts' | 'supportAlerts'>, value: boolean) {
    if (!available || saving) return;
    const next = { ...preferences, [key]: value };
    setSaving(true); setMessage(''); onSaved(next);
    try {
      const response = await fetch('/api/admin-account-security', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preferences', registrationAlerts: next.registrationAlerts, paymentAlerts: next.paymentAlerts, licenseAlerts: next.licenseAlerts, supportAlerts: next.supportAlerts }) });
      const payload = await response.json().catch(() => null) as { preferences?: AdminAccountPreferences; error?: string } | null;
      if (!response.ok || !payload?.preferences) throw new Error(payload?.error || 'Unable to save alert preferences.');
      onSaved(payload.preferences); setMessage('Header attention preferences saved.');
    } catch (reason) { onSaved(preferences); setMessage(reason instanceof Error ? reason.message : 'Unable to save alert preferences.'); }
    setSaving(false);
  }

  const rows = [
    ['registrationAlerts', 'Registration reviews', 'New free or pending accounts', UserRound],
    ['paymentAlerts', 'Payment verification', 'Pending manual payment records', BellRing],
    ['licenseAlerts', 'License expiry', 'Active licenses nearing renewal', Clock3],
    ['supportAlerts', 'Support desk', 'Open or in-progress client tickets', ShieldCheck],
  ] as const;

  return <section className={securityStyles.panel} aria-labelledby="admin-alerts-title">
    <PanelHeading id="admin-alerts-title" icon={<BellRing size={18} />} eyebrow="Header alerts" title="Attention badge priorities" detail="Choose which queues contribute to the top header count. The Overview action center continues to show every operational queue." />
    <div className={securityStyles.preferenceList} aria-busy={loading || saving}>
      <div><span><ShieldCheck size={17} aria-hidden="true" /></span><div><strong>Security activity</strong><p>Password, authenticator and session changes</p></div><b>Always on</b></div>
      <div><span><ShieldAlert size={17} aria-hidden="true" /></span><div><strong>Suspended client reviews</strong><p>Accounts that require an administrator decision</p></div><b>Always on</b></div>
      {rows.map(([key, title, detail, Icon]) => <label key={key} className={!available ? securityStyles.disabledPreference : ''}><span><Icon size={17} aria-hidden="true" /></span><div><strong>{title}</strong><p>{detail}</p></div><input type="checkbox" checked={preferences[key]} disabled={!available || saving} onChange={(event) => void change(key, event.target.checked)} /><i aria-hidden="true" /></label>)}
    </div>
    <p className={securityStyles.preferenceNote}>{loading ? 'Loading saved administrator preferences…' : message || (available ? 'These preferences change only the header count, never the underlying records.' : 'Apply the administrator security migration to save header preferences.')}</p>
  </section>;
}
