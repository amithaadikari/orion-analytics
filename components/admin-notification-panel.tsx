'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  CreditCard,
  Headphones,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react';
import {
  preferredQueueCount,
  type AdminAlertPreferences,
  type AlertCounts,
} from '@/components/admin-action-center';
import styles from './admin-notification-panel.module.css';

type AdminNotificationPanelProps = {
  counts: AlertCounts | null;
  preferences: AdminAlertPreferences;
  onCountsChange: (counts: AlertCounts | null) => void;
  onNavigate: (section: string, filter?: string) => void;
};

type CategoryKey = keyof AlertCounts;
type CategoryDefinition = {
  key: CategoryKey;
  label: string;
  description: string;
  section: string;
  filter: string;
  Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
};

const categories: CategoryDefinition[] = [
  {
    key: 'registrations',
    label: 'Registration reviews',
    description: 'New client accounts awaiting review',
    section: 'registrations',
    filter: 'Needs review',
    Icon: UserRoundCheck,
  },
  {
    key: 'payments',
    label: 'Payment verification',
    description: 'Pending payments requiring a decision',
    section: 'payments',
    filter: 'Pending',
    Icon: CreditCard,
  },
  {
    key: 'licenses',
    label: 'Licenses expiring soon',
    description: 'Active licenses due within 30 days',
    section: 'licenses',
    filter: 'Expiring soon',
    Icon: KeyRound,
  },
  {
    key: 'support',
    label: 'Support conversations',
    description: 'Open or active client tickets',
    section: 'support',
    filter: 'Open',
    Icon: Headphones,
  },
  {
    key: 'suspended',
    label: 'Suspended clients',
    description: 'Accounts currently restricted',
    section: 'clients',
    filter: 'Suspended',
    Icon: ShieldAlert,
  },
];

export default function AdminNotificationPanel({ counts, preferences, onCountsChange, onNavigate }: AdminNotificationPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(counts === null);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const attentionCount = useMemo(
    () => counts ? preferredQueueCount(counts, preferences) : null,
    [counts, preferences],
  );

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/action-center?view=header', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 403 ? 'This account cannot access administrator queues.' : 'Live operational queues could not be loaded.');
      const nextCounts = parseHeaderCounts(payload);
      if (!nextCounts) throw new Error('The operational queue response was incomplete.');
      if (requestId !== requestRef.current) return;
      onCountsChange(nextCounts);
    } catch (reason) {
      if (requestId !== requestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Live operational queues could not be loaded.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [onCountsChange]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      const restoreFocus = Boolean(panelRef.current?.contains(document.activeElement));
      setOpen(false);
      if (restoreFocus) restoreTriggerFocus(triggerRef.current);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function navigate(section: string, filter?: string) {
    setOpen(false);
    onNavigate(section, filter);
    restoreTriggerFocus(triggerRef.current);
  }

  const triggerLabel = attentionCount === null
    ? 'Administrator action inbox. Queue status is loading or unavailable.'
    : attentionCount === 0
      ? 'Administrator action inbox. No enabled operational alerts need attention.'
      : `Administrator action inbox. ${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} attention.`;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        data-state={error && counts === null ? 'error' : attentionCount === 0 ? 'clear' : attentionCount ? 'attention' : 'loading'}
        ref={triggerRef}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls="admin-notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={17} aria-hidden="true" />
        {attentionCount !== null && attentionCount > 0 && (
          <span className={styles.badge} aria-hidden="true">{attentionCount > 99 ? '99+' : attentionCount}</span>
        )}
        <i className={styles.stateDot} aria-hidden="true" />
      </button>

      {open && (
        <div
          className={styles.popover}
          id="admin-notification-panel"
          role="region"
          aria-labelledby="admin-notification-title"
          ref={panelRef}
        >
          <header className={styles.header}>
            <div>
              <small>Admin operations</small>
              <strong id="admin-notification-title">Action inbox</strong>
            </div>
            <button
              type="button"
              className={styles.refresh}
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh operational queues"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </header>

          {counts && (
            <div className={styles.summary} data-state={attentionCount === 0 ? 'clear' : 'attention'}>
              <span aria-hidden="true">{attentionCount === 0 ? <CheckCircle2 size={18} /> : <Bell size={18} />}</span>
              <div>
                <strong>{attentionCount === 0 ? 'Enabled queues are clear' : `${attentionCount?.toLocaleString()} ${attentionCount === 1 ? 'item needs' : 'items need'} attention`}</strong>
                <small>Live checks based on your alert preferences</small>
              </div>
            </div>
          )}

          <div className={styles.content}>
            {loading && counts === null ? (
              <div className={styles.loading} role="status" aria-label="Loading administrator action inbox">
                <span /><span /><span /><p>Checking operational queues…</p>
              </div>
            ) : error && counts === null ? (
              <div className={styles.empty} role="alert">
                <span aria-hidden="true">!</span>
                <strong>Action inbox unavailable</strong>
                <p>{error}</p>
                <button type="button" onClick={() => void load()}>Try again</button>
              </div>
            ) : counts ? (
              <ol className={styles.list} aria-label="Administrator operational queues">
                {categories.map(({ key, label, description, section, filter, Icon }) => {
                  const enabled = preferenceEnabled(key, preferences);
                  const count = counts[key];
                  return (
                    <li key={key} className={styles.item} data-kind={key} data-muted={!enabled || undefined}>
                      <button type="button" onClick={() => navigate(section, filter)} aria-label={`${label}: ${count} ${count === 1 ? 'record' : 'records'}. Open review page.`}>
                        <span className={styles.kind} aria-hidden="true"><Icon size={16} /></span>
                        <span className={styles.copy}>
                          <strong>{label}</strong>
                          <small>{description}</small>
                          {!enabled && <em>Hidden from header count</em>}
                        </span>
                        <data value={count}>{count.toLocaleString()}</data>
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>

          {error && counts && <p className={styles.stale} role="alert">Refresh failed. Showing the last available queue totals.</p>}

          <button type="button" className={styles.footer} onClick={() => navigate('overview')}>
            <span><strong>Open full Action Center</strong><small>Review records and confirmed actions</small></span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export function parseHeaderCounts(value: unknown): AlertCounts | null {
  if (!isObject(value) || !isObject(value.counts)) return null;
  const source = value.counts;
  const keys: CategoryKey[] = ['registrations', 'payments', 'licenses', 'support', 'suspended'];
  if (!keys.every((key) => Number.isInteger(source[key]) && Number(source[key]) >= 0)) return null;
  const counts = {
    registrations: Number(source.registrations),
    payments: Number(source.payments),
    licenses: Number(source.licenses),
    support: Number(source.support),
    suspended: Number(source.suspended),
  };
  const total = counts.registrations + counts.payments + counts.licenses + counts.support + counts.suspended;
  if (!Number.isInteger(source.total) || Number(source.total) !== total) return null;
  return counts;
}

function preferenceEnabled(key: CategoryKey, preferences: AdminAlertPreferences) {
  if (key === 'registrations') return preferences.registrationAlerts;
  if (key === 'payments') return preferences.paymentAlerts;
  if (key === 'licenses') return preferences.licenseAlerts;
  if (key === 'support') return preferences.supportAlerts;
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function restoreTriggerFocus(trigger: HTMLButtonElement | null) {
  if (!trigger) return;
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => trigger.focus());
  else trigger.focus();
}
