'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CircleAlert, Clock3, MonitorCheck, RefreshCw, Search, WifiOff } from 'lucide-react';
import type { AdminTradingMonitorSnapshot, TradingConnectionState } from '@/lib/admin-trading-monitor';
import styles from './admin-trading-monitor.module.css';

const emptySnapshot: AdminTradingMonitorSnapshot = {
  generatedAt: '',
  counts: { total: 0, online: 0, delayed: 0, offline: 0, never: 0, offlineWithOpenPositions: 0, rejected24h: 0 },
  items: [],
};

type FilterState = 'all' | TradingConnectionState;

export default function AdminTradingMonitor() {
  const [snapshot, setSnapshot] = useState<AdminTradingMonitorSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<FilterState>('all');
  const [plan, setPlan] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [accountType, setAccountType] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/trading-monitor', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'EA fleet data is unavailable.');
      setSnapshot(payload as AdminTradingMonitorSnapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'EA fleet data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return snapshot.items.filter((item) => {
      if (state !== 'all' && item.state !== state) return false;
      if (plan !== 'all' && item.plan !== plan) return false;
      if (platform !== 'all' && item.platform !== platform) return false;
      if (accountType !== 'all' && item.accountType !== accountType) return false;
      if (!term) return true;
      return [item.clientName, item.maskedAccountNumber, item.maskedLicenseKey, item.brokerServer, item.installationHint]
        .some((value) => value.toLocaleLowerCase().includes(term));
    });
  }, [accountType, plan, platform, query, snapshot.items, state]);

  return (
    <section className={styles.monitor} aria-labelledby="ea-fleet-title" aria-busy={loading}>
      <header className={styles.hero}>
        <div>
          <p className="eyebrow">Trading systems</p>
          <h2 id="ea-fleet-title">EA fleet, under watch.</h2>
          <p>Server-received connection health for authorized Orion installations. Trading telemetry is client-reported and read-only.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh fleet'}
        </button>
      </header>

      {error && <div className={styles.error} role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}

      <div className={styles.metrics} aria-label="EA fleet connection summary">
        <FleetMetric icon={MonitorCheck} label="Online" value={snapshot.counts.online} tone="online" detail="Sync received within 3 minutes" />
        <FleetMetric icon={Clock3} label="Delayed" value={snapshot.counts.delayed} tone="delayed" detail="Last sync 3–10 minutes ago" />
        <FleetMetric icon={WifiOff} label="Offline" value={snapshot.counts.offline} tone="offline" detail={`${snapshot.counts.offlineWithOpenPositions} connection${snapshot.counts.offlineWithOpenPositions === 1 ? '' : 's'} with open positions`} />
        <FleetMetric icon={Activity} label="Never synced" value={snapshot.counts.never} tone="never" detail={`${snapshot.counts.rejected24h} rejected requests in 24h`} />
      </div>

      <div className={styles.filters} aria-label="Filter EA connections">
        <label className={styles.search}><span className="sr-only">Search clients or connections</span><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, account, broker…" /></label>
        <Filter label="State" value={state} onChange={(value) => setState(value as FilterState)} options={['online', 'delayed', 'offline', 'never']} />
        <Filter label="Plan" value={plan} onChange={setPlan} options={['Basic', 'Premium', 'Lifetime']} />
        <Filter label="Platform" value={platform} onChange={setPlatform} options={['MT4', 'MT5']} />
        <Filter label="Account" value={accountType} onChange={setAccountType} options={['Demo', 'Real']} />
      </div>

      <div className={styles.tableWrap}>
        <table>
          <caption className="sr-only">Authorized Orion EA connection health</caption>
          <thead><tr><th>Client</th><th>License & account</th><th>Environment</th><th>Connection</th><th>Open</th><th>Attention</th></tr></thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.connectionId}>
                <td><strong>{item.clientName}</strong><small>{item.plan}</small></td>
                <td><code>{item.maskedAccountNumber}</code><small>{item.maskedLicenseKey}</small></td>
                <td><strong>{item.platform} · {item.accountType}</strong><small>{item.brokerServer}</small></td>
                <td><span className={`${styles.state} ${styles[item.state]}`}><i aria-hidden="true" />{stateLabel(item.state)}</span><small>{lastSeenLabel(item.lastSeenAt)}</small></td>
                <td><strong>{item.openPositions}</strong><small>at last sync</small></td>
                <td><AttentionLabel attention={item.attention} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !filtered.length && <p className={styles.empty}>No EA connections match these filters.</p>}
        {loading && !snapshot.items.length && <p className={styles.empty} role="status">Loading authorized EA connections…</p>}
      </div>
      {snapshot.generatedAt && <p className={styles.asOf}>Fleet state calculated {new Date(snapshot.generatedAt).toLocaleString()} from server receipt times.</p>}
    </section>
  );
}

function FleetMetric({ icon: Icon, label, value, tone, detail }: { icon: typeof Activity; label: string; value: number; tone: string; detail: string }) {
  return <article className={styles.metric} data-tone={tone}><span><Icon size={18} aria-hidden="true" /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All</option>{options.map((option) => <option key={option} value={option}>{option === 'never' ? 'Never synced' : option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>;
}

function AttentionLabel({ attention }: { attention: AdminTradingMonitorSnapshot['items'][number]['attention'] }) {
  if (!attention) return <span className={styles.clear}>No action</span>;
  const labels = {
    'offline-open-positions': 'Offline with positions',
    delayed: 'Connection delayed',
    offline: 'Connection offline',
    'waiting-first-sync': 'Waiting first sync',
  } as const;
  return <span className={styles.attention}>{labels[attention]}</span>;
}

function stateLabel(state: TradingConnectionState) {
  return state === 'never' ? 'Never synced' : state[0].toUpperCase() + state.slice(1);
}

function lastSeenLabel(value: string | null) {
  if (!value) return 'No successful sync';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}
