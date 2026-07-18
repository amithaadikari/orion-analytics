'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type AdminActionCenterProps = {
  onNavigate: (section: string, filter: string) => void;
  onQueueCountChange: (count: number | null) => void;
};

type QueueCounts = {
  registrations: number;
  payments: number;
  licenses: number;
  suspended: number;
  total: number;
};

type QueueItemBase = {
  id: string;
  label?: string;
  title?: string;
  detail?: string;
  context?: string;
  date?: string | null;
  created_at?: string | null;
};

type RegistrationQueueItem = QueueItemBase & {
  full_name?: string;
  plan?: string;
  status?: string;
};

type PaymentQueueItem = QueueItemBase & {
  client_name?: string;
  amount?: number | string;
  currency?: string;
  method?: string;
  payment_date?: string | null;
};

type LicenseQueueItem = QueueItemBase & {
  client_name?: string;
  license_key?: string;
  platform?: string;
  expires_at?: string | null;
  days_remaining?: number | null;
};

type SuspendedQueueItem = QueueItemBase & {
  full_name?: string;
  plan?: string;
  country?: string;
};

type ActionCenterResponse = {
  counts: QueueCounts;
  queues: {
    registrations: RegistrationQueueItem[];
    payments: PaymentQueueItem[];
    licenses: LicenseQueueItem[];
    suspended: SuspendedQueueItem[];
  };
};

type QueueCategory = 'registrations' | 'payments' | 'licenses' | 'suspended';

type FeedItem = {
  id: string;
  category: QueueCategory;
  categoryLabel: string;
  title: string;
  detail: string;
  date?: { dateTime: string; label: string };
  section: string;
  filter: string;
};

const categoryDefinitions = [
  {
    key: 'registrations' as const,
    label: 'Registration review',
    description: 'Free or pending accounts',
    icon: '◎',
    section: 'registrations',
    filter: 'Needs review',
    action: 'Review registrations',
  },
  {
    key: 'payments' as const,
    label: 'Pending payments',
    description: 'Payment records awaiting review',
    icon: '◈',
    section: 'payments',
    filter: 'Pending',
    action: 'Review payments',
  },
  {
    key: 'licenses' as const,
    label: 'Licenses expiring soon',
    description: 'Active licenses due within 30 days',
    icon: '◷',
    section: 'licenses',
    filter: 'Expiring soon',
    action: 'Review licenses',
  },
  {
    key: 'suspended' as const,
    label: 'Suspended clients',
    description: 'Accounts currently marked suspended',
    icon: '◇',
    section: 'clients',
    filter: 'Suspended',
    action: 'Review clients',
  },
] as const;

export default function AdminActionCenter({ onNavigate, onQueueCountChange }: AdminActionCenterProps) {
  const [data, setData] = useState<ActionCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const navigateRef = useRef(onNavigate);
  const countChangeRef = useRef(onQueueCountChange);
  const lastReportedCount = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    navigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    countChangeRef.current = onQueueCountChange;
  }, [onQueueCountChange]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setUnavailable(false);

    try {
      const response = await fetch('/api/action-center', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.status === 403) {
        setData(null);
        setUnavailable(true);
        return;
      }
      if (!response.ok) throw new Error(apiError(payload) || 'Unable to load the action center.');
      if (!isActionCenterResponse(payload)) throw new Error('The action-center response was incomplete.');

      setData(payload);
    } catch (reason) {
      if (isAbortError(reason)) return;
      setData(null);
      setError(reason instanceof Error ? reason.message : 'Unable to load the action center.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const queueCount = data?.counts.total ?? null;
  useEffect(() => {
    if (lastReportedCount.current === queueCount) return;
    lastReportedCount.current = queueCount;
    countChangeRef.current(queueCount);
  }, [queueCount]);

  const navigate = useCallback((section: string, filter: string) => {
    navigateRef.current(section, filter);
  }, []);

  const feed = useMemo(() => data ? buildPriorityFeed(data.queues) : [], [data]);

  if (loading) return <ActionCenterLoading />;

  if (unavailable) {
    return (
      <section className="admin-action-center admin-action-center--unavailable" aria-labelledby="admin-action-center-title">
        <ActionCenterHeader count={null} />
        <div className="admin-action-center-state admin-action-center-state--unavailable" role="status">
          <span aria-hidden="true">◇</span>
          <div><strong>Operational queues unavailable</strong><p>This account does not have access to action-center records.</p></div>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="admin-action-center admin-action-center--error" aria-labelledby="admin-action-center-title">
        <ActionCenterHeader count={null} />
        <div className="admin-action-center-state admin-action-center-state--error" role="alert">
          <span aria-hidden="true">!</span>
          <div><strong>Action center could not be loaded</strong><p>{error || 'The operational queue is temporarily unavailable.'}</p></div>
          <button className="admin-action-center-retry" type="button" onClick={() => void load()}>Try again</button>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-action-center" aria-labelledby="admin-action-center-title">
      <ActionCenterHeader count={data.counts.total} />

      <div className="admin-action-center-categories" aria-label="Operational review queues">
        {categoryDefinitions.map((category) => {
          const count = data.counts[category.key];
          return (
            <article className={`admin-action-category admin-action-category--${category.key}`} key={category.key}>
              <header>
                <span className="admin-action-category-icon" aria-hidden="true">{category.icon}</span>
                <data value={count} aria-label={`${count} ${category.label.toLowerCase()}`}>{count}</data>
              </header>
              <h3>{category.label}</h3>
              <p>{category.description}</p>
              <button
                type="button"
                onClick={() => navigate(category.section, category.filter)}
                aria-label={`${category.action}: ${count} ${count === 1 ? 'record' : 'records'}`}
              >
                {category.action}<span aria-hidden="true">→</span>
              </button>
            </article>
          );
        })}
      </div>

      <section className="admin-action-feed" aria-labelledby="admin-action-feed-title">
        <header className="admin-action-feed-heading">
          <div><p className="eyebrow">Combined queue</p><h3 id="admin-action-feed-title">Priority review feed</h3></div>
          {data.counts.total > 0 && <span>{feed.length} of {data.counts.total} shown</span>}
        </header>

        {feed.length > 0 ? (
          <ol className="admin-action-feed-list">
            {feed.map((item) => (
              <li className={`admin-action-feed-item admin-action-feed-item--${item.category}`} key={item.id}>
                <span className="admin-action-feed-marker" aria-hidden="true" />
                <div className="admin-action-feed-copy">
                  <small>{item.categoryLabel}</small>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  {item.date && <time dateTime={item.date.dateTime}>{item.date.label}</time>}
                </div>
                <button type="button" onClick={() => navigate(item.section, item.filter)} aria-label={`Review ${item.categoryLabel.toLowerCase()}: ${item.title}`}>
                  Review<span aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="admin-action-center-clear" role="status">
            <span aria-hidden="true">✓</span>
            <div><strong>All review queues are clear</strong><p>No registration reviews, pending payments, expiring active licenses, or suspended clients are currently listed.</p></div>
          </div>
        )}
      </section>
    </section>
  );
}

function ActionCenterHeader({ count }: { count: number | null }) {
  return (
    <header className="admin-action-center-heading">
      <div>
        <p className="eyebrow">Orion operations</p>
        <h2 id="admin-action-center-title">Action center</h2>
        <p>Focused checks derived from current operational records.</p>
      </div>
      {count !== null && (
        <output className={`admin-action-center-count ${count === 0 ? 'is-clear' : 'has-items'}`} aria-live="polite" aria-label={`${count} open operational checks`}>
          <strong>{count}</strong><span>{count === 1 ? 'open check' : 'open checks'}</span>
        </output>
      )}
    </header>
  );
}

function ActionCenterLoading() {
  return (
    <section className="admin-action-center admin-action-center--loading" aria-labelledby="admin-action-center-loading-title" aria-busy="true">
      <header className="admin-action-center-heading">
        <div><p className="eyebrow">Orion operations</p><h2 id="admin-action-center-loading-title">Action center</h2></div>
      </header>
      <p className="admin-action-center-loading-label" role="status">Loading operational queues…</p>
      <div className="admin-action-center-skeletons" aria-hidden="true">
        {categoryDefinitions.map((category) => <span className="admin-action-center-skeleton" key={category.key}><i /><i /><i /></span>)}
      </div>
    </section>
  );
}

function buildPriorityFeed(queues: ActionCenterResponse['queues']) {
  const groups: FeedItem[][] = [
    queues.licenses.map((item) => licenseFeedItem(item)),
    queues.payments.map((item) => paymentFeedItem(item)),
    queues.registrations.map((item) => registrationFeedItem(item)),
    queues.suspended.map((item) => suspendedFeedItem(item)),
  ];
  const selected: FeedItem[] = [];

  for (let round = 0; selected.length < 8; round += 1) {
    let added = false;
    for (const group of groups) {
      const item = group[round];
      if (!item) continue;
      selected.push(item);
      added = true;
      if (selected.length === 8) break;
    }
    if (!added) break;
  }

  return selected;
}

function registrationFeedItem(item: RegistrationQueueItem): FeedItem {
  const title = firstText(item.full_name, item.title, item.label) || 'Registration record';
  const fallbackDetail = [item.plan, item.status].filter(isPresent).join(' · ');
  const facts = [item.detail || fallbackDetail, item.context].filter(isPresent);
  return {
    id: `registration:${item.id}`,
    category: 'registrations',
    categoryLabel: 'Registration review',
    title,
    detail: uniqueFacts(facts).join(' · ') || 'Free or pending account',
    date: formattedDate(item.date || item.created_at),
    section: 'registrations',
    filter: 'Needs review',
  };
}

function paymentFeedItem(item: PaymentQueueItem): FeedItem {
  const amount = formattedAmount(item.amount, item.currency);
  const fallbackDetail = [amount, item.method].filter(isPresent).join(' · ');
  const facts = [item.detail || fallbackDetail, item.context].filter(isPresent);
  return {
    id: `payment:${item.id}`,
    category: 'payments',
    categoryLabel: 'Pending payment',
    title: firstText(item.client_name, item.title, item.label) || 'Payment record',
    detail: uniqueFacts(facts).join(' · ') || 'Pending payment record',
    date: formattedDate(item.date || item.payment_date || item.created_at),
    section: 'payments',
    filter: 'Pending',
  };
}

function licenseFeedItem(item: LicenseQueueItem): FeedItem {
  const expiry = formattedDate(item.expires_at);
  const timing = typeof item.days_remaining === 'number'
    ? item.days_remaining === 0 ? 'Expires today' : `Expires in ${item.days_remaining} days`
    : expiry ? `Expires ${expiry.label}` : undefined;
  const fallbackDetail = [item.client_name, item.platform].filter(isPresent).join(' · ');
  const facts = [item.detail || fallbackDetail, item.context, timing].filter(isPresent);
  return {
    id: `license:${item.id}`,
    category: 'licenses',
    categoryLabel: 'Expiring license',
    title: firstText(item.license_key, item.title, item.label) || 'Active license',
    detail: uniqueFacts(facts).join(' · ') || 'Active license expiring within 30 days',
    date: formattedDate(item.date) || expiry,
    section: 'licenses',
    filter: 'Expiring soon',
  };
}

function suspendedFeedItem(item: SuspendedQueueItem): FeedItem {
  const fallbackDetail = [item.plan, item.country, 'Status: Suspended'].filter(isPresent).join(' · ');
  const facts = [item.detail || fallbackDetail, item.context].filter(isPresent);
  return {
    id: `suspended:${item.id}`,
    category: 'suspended',
    categoryLabel: 'Suspended client',
    title: firstText(item.full_name, item.title, item.label) || 'Client record',
    detail: uniqueFacts(facts).join(' · ') || 'Status: Suspended',
    date: formattedDate(item.date || item.created_at),
    section: 'clients',
    filter: 'Suspended',
  };
}

function isActionCenterResponse(value: unknown): value is ActionCenterResponse {
  if (!isObject(value)) return false;
  const counts = value.counts;
  const queues = value.queues;
  if (!isObject(counts) || !isObject(queues)) return false;
  const countKeys: (keyof QueueCounts)[] = ['registrations', 'payments', 'licenses', 'suspended', 'total'];
  const queueKeys: QueueCategory[] = ['registrations', 'payments', 'licenses', 'suspended'];
  return countKeys.every((key) => isNonNegativeNumber(counts[key]))
    && queueKeys.every((key) => Array.isArray(queues[key]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError';
}

function apiError(payload: unknown) {
  return isObject(payload) && typeof payload.error === 'string' ? payload.error : '';
}

function firstText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function isPresent(value: string | undefined): value is string {
  return Boolean(value);
}

function uniqueFacts(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formattedAmount(amount: number | string | undefined, currency: string | undefined) {
  if (amount === undefined && !currency) return undefined;
  const numericAmount = Number(amount);
  const value = Number.isFinite(numericAmount)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numericAmount)
    : String(amount || '').trim();
  return [currency?.trim().toUpperCase(), value].filter(Boolean).join(' ');
}

function formattedDate(value: string | null | undefined) {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
  const date = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    dateTime: dateOnly,
    label: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date),
  };
}
