'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BadgeCheck, BellRing, Boxes, CircleAlert, Clock3, History, MonitorCheck, RefreshCw, Search, ShieldAlert, WifiOff } from 'lucide-react';
import type { AdminTradingAlertingSnapshot, AdminTradingMonitorSnapshot, AdminTradingReliabilitySnapshot, TradingConnectionState } from '@/lib/admin-trading-monitor';
import styles from './admin-trading-monitor.module.css';

const emptyReliability: AdminTradingReliabilitySnapshot = {
  available: false,
  unavailableReason: 'migration_pending',
  canAcknowledge: false,
  versions: {
    currentVersion: '5.2.0',
    totalConnections: 0,
    reportingConnections: 0,
    currentConnections: 0,
    unknownConnections: 0,
    adoptionPercent: null,
    breakdown: [],
  },
  incidents: [],
  openIncidentCount: 0,
  openIncidentOverflow: false,
  runs: [],
};

const emptySnapshot: AdminTradingMonitorSnapshot = {
  generatedAt: '',
  counts: { total: 0, online: 0, delayed: 0, offline: 0, never: 0, offlineWithOpenPositions: 0, rejected24h: 0 },
  items: [],
  reliability: emptyReliability,
};

const emptyAlerting: AdminTradingAlertingSnapshot = {
  available: false,
  unavailableReason: 'migration_pending',
  enabledConnections: 0,
  activeBreaches: 0,
  triggered24h: 0,
  recentEvents: [],
  runs: [],
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
  const [acknowledging, setAcknowledging] = useState('');
  const [reliabilityError, setReliabilityError] = useState('');

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
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const acknowledgeIncident = useCallback(async (incidentId: string) => {
    setAcknowledging(incidentId);
    setReliabilityError('');
    try {
      const response = await fetch('/api/admin/trading-monitor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, action: 'acknowledge' }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Unable to acknowledge incident.');
      await load();
    } catch (reason) {
      setReliabilityError(reason instanceof Error ? reason.message : 'Unable to acknowledge incident.');
    } finally {
      setAcknowledging('');
    }
  }, [load]);

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

      <ReliabilityOverview
        reliability={snapshot.reliability || emptyReliability}
        error={reliabilityError}
        acknowledging={acknowledging}
        acknowledge={acknowledgeIncident}
      />

      <ClientAlertOverview alerting={snapshot.alerting || emptyAlerting} />

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

function ClientAlertOverview({ alerting }: { alerting: AdminTradingAlertingSnapshot }) {
  const latestRun = alerting.runs[0];
  const pending = alerting.unavailableReason === 'migration_pending';
  return <section className={`${styles.reliabilityPanel} ${styles.alertDelivery}`} aria-labelledby="client-alert-delivery-title">
    <header className={styles.reliabilityHead}>
      <div><p>Client safety delivery</p><h3 id="client-alert-delivery-title">Trading alert operations</h3></div>
      <BellRing size={19} aria-hidden="true" />
    </header>
    {!alerting.available ? <div className={styles.schemaNotice}><BellRing size={20} aria-hidden="true" /><div>
      <strong>{pending ? 'Client alert activation pending' : 'Client alert evidence temporarily unavailable'}</strong>
      <span>{pending ? 'Apply the Trading Alerts & Risk Center migration, then run its evaluator to begin delivery.' : 'EA fleet monitoring remains available. Refresh shortly to restore alert delivery evidence.'}</span>
    </div></div> : <>
      <div className={styles.alertDeliveryMetrics} aria-label="Client trading alert summary">
        <div><small>Enabled connections</small><strong>{alerting.enabledConnections}</strong><span>At least one alert rule</span></div>
        <div data-tone={alerting.activeBreaches ? 'warning' : 'clear'}><small>Active breaches</small><strong>{alerting.activeBreaches}</strong><span>{alerting.activeBreaches ? 'Threshold review required' : 'No open risk state'}</span></div>
        <div><small>Alerts in 24h</small><strong>{alerting.triggered24h}</strong><span>Portal notification events</span></div>
        <div data-status={latestRun?.status || 'Pending'}><small>Latest evaluator</small><strong>{latestRun?.status || 'No run'}</strong><span>{latestRun ? `${latestRun.scopesEvaluated} connections · ${latestRun.notificationsCreated} delivered` : 'Waiting for first evaluation'}</span></div>
      </div>
      <ul className={styles.alertEventList}>
        {alerting.recentEvents.map((event) => <li key={event.id} data-severity={event.severity}>
          <span className={styles.alertEventIcon}><BellRing size={15} aria-hidden="true" /></span>
          <div><strong>{event.title}</strong><span>{event.clientName}{event.maskedAccountNumber ? ` · ${event.maskedAccountNumber}` : ''}</span></div>
          <time dateTime={event.triggeredAt}>{dateLabel(event.triggeredAt)}</time>
        </li>)}
        {!alerting.recentEvents.length && <li className={styles.reliabilityEmpty}><BadgeCheck size={18} aria-hidden="true" /><span>No client trading alerts recorded.</span></li>}
      </ul>
    </>}
  </section>;
}

function ReliabilityOverview({ reliability, error, acknowledging, acknowledge }: {
  reliability: AdminTradingReliabilitySnapshot;
  error: string;
  acknowledging: string;
  acknowledge: (incidentId: string) => Promise<void>;
}) {
  const adoption = reliability.versions.adoptionPercent;
  const unavailableCopy = reliabilityUnavailableCopy(reliability.unavailableReason);
  return <section className={styles.reliabilityOverview} aria-label="Trading reliability and V5.2 adoption">
    <article className={styles.reliabilityPanel}>
      <header className={styles.reliabilityHead}>
        <div><p>Release intelligence</p><h3>V5.x adoption</h3></div>
        <BadgeCheck size={19} aria-hidden="true" />
      </header>
      <div className={styles.adoptionValue}>
        <strong>{adoption === null ? '—' : `${adoption}%`}</strong>
        <span>{reliability.versions.currentConnections} of {reliability.versions.totalConnections} eligible connections report V{reliability.versions.currentVersion}</span>
        <div
          className={styles.adoptionBar}
          role="progressbar"
          aria-label={`V${reliability.versions.currentVersion} adoption`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={adoption ?? 0}
        ><i style={{ width: `${Math.max(0, Math.min(100, adoption ?? 0))}%` }} /></div>
      </div>
      <ul className={styles.versionList}>
        {reliability.versions.breakdown.map((version) => <li key={version.version} data-current={version.current || undefined}><span>V{version.version}{version.current ? ' · current' : ''}</span><strong>{version.connections} · {version.percentage}%</strong></li>)}
        {reliability.versions.unknownConnections > 0 && <li><span>Version not reported</span><strong>{reliability.versions.unknownConnections}</strong></li>}
        {!reliability.versions.totalConnections && <li><span>No eligible connection yet</span><strong>—</strong></li>}
      </ul>
    </article>

    <div className={styles.reliabilityHistory}>
      <article className={styles.reliabilityPanel}>
        <header className={styles.reliabilityHead}>
          <div><p>Durable response queue</p><h3>Reliability incidents</h3></div>
          <ShieldAlert size={19} aria-hidden="true" />
        </header>
        {!reliability.available ? <div className={styles.schemaNotice}><Boxes size={20} aria-hidden="true" /><div><strong>{unavailableCopy.incidentTitle}</strong><span>{unavailableCopy.incidentDetail}</span></div></div> : <>
          {error && <p className={styles.reliabilityError} role="alert">{error}</p>}
          {reliability.openIncidentOverflow && <p className={styles.incidentOverflow} role="status">Incident list is limited. {reliability.openIncidentCount} open incidents require review.</p>}
          <ul className={styles.incidentList}>
            {reliability.incidents.map((incident) => <li key={incident.id} data-severity={incident.severity}>
              <div className={styles.incidentTop}>
                <div><span className={styles.severity}>{incident.severity}</span><strong>{incident.summary}</strong></div>
                <IncidentState
                  status={incident.status}
                  acknowledgedAt={incident.acknowledgedAt}
                  canAcknowledge={reliability.canAcknowledge}
                  acknowledging={acknowledging === incident.id}
                  acknowledge={() => acknowledge(incident.id)}
                />
              </div>
              <div className={styles.incidentMeta}>
                <span>{incident.clientName || 'System-wide signal'}</span>
                {incident.maskedAccountNumber && <code>{incident.maskedAccountNumber}</code>}
                {incident.maskedLicenseKey && <code>{incident.maskedLicenseKey}</code>}
                <time dateTime={incident.lastDetectedAt}>{dateLabel(incident.lastDetectedAt)}</time>
              </div>
            </li>)}
            {!reliability.incidents.length && <li className={styles.reliabilityEmpty}><BadgeCheck size={18} aria-hidden="true" /><span>No reliability incidents recorded.</span></li>}
          </ul>
        </>}
      </article>

      <article className={styles.reliabilityPanel}>
        <header className={styles.reliabilityHead}>
          <div><p>Scheduler evidence</p><h3>Recent job runs</h3></div>
          <History size={19} aria-hidden="true" />
        </header>
        {!reliability.available ? <div className={styles.schemaNotice}><Clock3 size={20} aria-hidden="true" /><div><strong>{unavailableCopy.runTitle}</strong><span>{unavailableCopy.runDetail}</span></div></div> : <ul className={styles.runList}>
          {reliability.runs.map((run) => {
            const skipped = run.skipped;
            const displayedStatus = skipped ? 'Skipped' : run.status;
            return <li key={run.id}>
            <div className={styles.runTop}><strong>{run.jobName === 'telemetry-retention' ? 'Telemetry retention' : 'Reliability evaluator'}</strong><span className={styles.runStatus} data-status={displayedStatus}>{displayedStatus}</span></div>
            <div className={styles.runMeta}>
              <time dateTime={run.startedAt}>{dateLabel(run.startedAt)}</time>
              {skipped
                ? <span>Duplicate evaluator work was safely skipped.</span>
                : run.jobName === 'reliability-evaluator' && <span>{run.streamsEvaluated} streams · {run.incidentsDetected} signals</span>}
              {run.errorCode && <code>{run.errorCode}</code>}
            </div>
          </li>})}
          {!reliability.runs.length && <li className={styles.reliabilityEmpty}><Clock3 size={18} aria-hidden="true" /><span>No scheduled run recorded yet.</span></li>}
        </ul>}
      </article>
    </div>
  </section>;
}

function IncidentState({ status, acknowledgedAt, canAcknowledge, acknowledging, acknowledge }: {
  status: 'Open' | 'Resolved';
  acknowledgedAt: string | null;
  canAcknowledge: boolean;
  acknowledging: boolean;
  acknowledge: () => Promise<void>;
}) {
  if (status === 'Resolved') return <span className={styles.resolved} aria-label="Incident status: Resolved">Resolved</span>;
  if (acknowledgedAt) return <span className={styles.acknowledged} aria-label="Incident status: Acknowledged">Acknowledged</span>;
  if (!canAcknowledge) return <span className={styles.openIncident} aria-label="Incident status: Open">Open</span>;
  return <button className={styles.incidentAction} type="button" disabled={acknowledging} onClick={() => void acknowledge()}>{acknowledging ? 'Saving…' : 'Acknowledge'}</button>;
}

function reliabilityUnavailableCopy(reason: AdminTradingReliabilitySnapshot['unavailableReason']) {
  if (reason === 'temporarily_unavailable') {
    return {
      incidentTitle: 'Reliability data temporarily unavailable',
      incidentDetail: 'The fleet monitor is still online. Refresh shortly to restore the incident queue.',
      runTitle: 'Scheduler evidence temporarily unavailable',
      runDetail: 'Recent evaluator history could not be loaded. Refresh shortly to try again.',
    };
  }
  return {
    incidentTitle: 'Reliability activation pending',
    incidentDetail: 'Apply the Phase 6A migration and run the evaluator to begin incident tracking.',
    runTitle: 'No evaluator evidence yet',
    runDetail: 'The fleet monitor remains available while Phase 6A waits for activation.',
  };
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

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}
