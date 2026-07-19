'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import LogoutButton from '@/components/logout-button';
import { countryFlag } from '@/lib/country';
import BusinessDashboard from '@/components/business-dashboard';
import AdminActionCenter from '@/components/admin-action-center';
import AdvancedAnalytics, { type AdvancedFilterPatch } from '@/components/advanced-analytics';
import CommandPalette from '@/components/command-palette';
import ReleaseManager from '@/components/release-manager';
import OrionBrand from '@/components/orion-brand';
import SupportTicketCenter from '@/components/support-ticket-center';

type DashboardProps = { admin: { email?: string | null; role?: string | null } | null };
type Breakdown = { name: string; value: number };
type Campaign = { name: string; visitors: number; clicks: number; conversionRate: number };
type DashboardEvent = { event_id?: string; event_name?: string; label?: string; visitor_id?: string; created_at?: string; country?: string; utm_campaign?: string };
type Snapshot = { metrics: Record<string, number | string>; comparison: { visitors: number; telegramClicks: number }; meta: { browserEvents: number; serverEvents: number; successful: number; failed: number; lastSync: string | null; eventIds: string[] }; funnel: Record<string, number>; charts: { byDay: any[]; byCountry: Breakdown[]; byCity: Breakdown[]; byCampaign: Breakdown[]; byDevice: Breakdown[]; byBrowser: Breakdown[]; byReferrer: Breakdown[] }; heatmaps: { countryDevice: { country:string; device:string; value:number }[]; dailyConversion: { date:string; stage:string; value:number }[]; countries?: Breakdown[]; devices?: string[]; stages?: string[] }; campaigns: Campaign[]; events: DashboardEvent[]; visitors: any[]; range: { start: string; end: string } };
type ActionCenterNavigate = (section: string, filter?: string) => void;

const emptySnapshot: Snapshot = { metrics: { visitorsToday: 0, uniqueVisitors: 0, visitorsOnline: 0, telegramClicks: 0, conversionRate: 0, leadsToday: 0, returningVisitors: 0, eventsInView: 0, topCountry: '—', topCampaign: 'Organic' }, comparison: { visitors: 0, telegramClicks: 0 }, meta: { browserEvents: 0, serverEvents: 0, successful: 0, failed: 0, lastSync: null, eventIds: [] }, funnel: { visitors: 0, viewContent: 0, telegramClicks: 0 }, charts: { byDay: [], byCountry: [], byCity: [], byCampaign: [], byDevice: [], byBrowser: [], byReferrer: [] }, heatmaps: { countryDevice: [], dailyConversion: [], countries: [], devices: [], stages: [] }, campaigns: [], events: [], visitors: [], range: { start: '', end: '' } };

const royalPalette = {
  gold: '#f6c453',
  goldBright: '#ffe39a',
  cyan: '#42d9ff',
  green: '#39f28a',
  orange: '#ff9f43',
  muted: '#87969c',
  grid: 'rgba(246,196,83,.09)'
} as const;

const royalTooltipStyle: CSSProperties = {
  color: '#f5f8f8',
  background: 'rgba(1,5,5,.96)',
  border: '1px solid rgba(246,196,83,.28)',
  borderRadius: 9,
  boxShadow: '0 20px 56px rgba(0,0,0,.68)',
  backdropFilter: 'blur(18px)'
};

function numericValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function topBreakdown(rows: Breakdown[]) {
  return rows.reduce<Breakdown | null>((top, row) => !top || row.value > top.value ? row : top, null);
}

function eventName(event: DashboardEvent) {
  return event.label || event.event_name || 'Event signal';
}

function visitorToken(visitorId?: string) {
  return visitorId ? `${visitorId.slice(0, 12)}…` : 'Anonymous visitor';
}

function signalTime(value?: string) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard({ admin }: DashboardProps) {
  const [range, setRange] = useState('7d'); const [customStart, setCustomStart] = useState(''); const [customEnd, setCustomEnd] = useState(''); const [eventFilter, setEventFilter] = useState('all'); const [country, setCountry] = useState('all'); const [campaign, setCampaign] = useState('all'); const [device, setDevice] = useState('all'); const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const [tab, setTab] = useState('overview');
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [destinationFilter, setDestinationFilter] = useState<string>();
  const [destinationSearch, setDestinationSearch] = useState<string>();
  const [businessNavigationKey, setBusinessNavigationKey] = useState(0);
  const [businessCommand, setBusinessCommand] = useState<{ type:'add-client'|'create-license'|'record-payment'; key:number }>();
  const navigateFromActionCenter = useCallback<ActionCenterNavigate>((section, filter) => {
    setDestinationFilter(filter);
    setDestinationSearch(undefined);
    setBusinessCommand(undefined);
    setBusinessNavigationKey((key) => key + 1);
    setTab(section);
  }, []);
  const navigateNormally = useCallback((section: string) => {
    setDestinationFilter(undefined);
    setDestinationSearch(undefined);
    setBusinessCommand(undefined);
    setBusinessNavigationKey((key) => key + 1);
    setTab(section);
  }, []);
  const navigateFromCommand = useCallback((section:string,filter?:string,search?:string)=>{
    setDestinationFilter(filter);
    setDestinationSearch(search);
    setBusinessCommand(undefined);
    setBusinessNavigationKey((key)=>key+1);
    setTab(section);
  },[]);
  const executeCommand = useCallback((type:'add-client'|'create-license'|'record-payment')=>{
    const section=type==='add-client'?'clients':type==='create-license'?'licenses':'payments';
    setDestinationFilter(undefined);
    setDestinationSearch(undefined);
    setBusinessCommand({type,key:Date.now()});
    setBusinessNavigationKey((key)=>key+1);
    setTab(section);
  },[]);
  const updateQueueCount = useCallback((count: number | null) => setQueueCount(count), []);
  const applyAdvancedFilter = useCallback((patch: AdvancedFilterPatch) => {
    if ('country' in patch) setCountry(patch.country || 'all');
    if ('campaign' in patch) setCampaign(patch.campaign || 'all');
    if ('device' in patch) setDevice(patch.device || 'all');
    if ('event' in patch) setEventFilter(patch.event || 'all');
    if (patch.date) {
      setRange('custom');
      setCustomStart(patch.date);
      setCustomEnd(patch.date);
    }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ range });
      if (range === 'custom' && customStart) params.set('start', new Date(`${customStart}T00:00:00Z`).toISOString());
      if (range === 'custom' && customEnd) params.set('end', new Date(`${customEnd}T23:59:59.999Z`).toISOString());
      if (country !== 'all') params.set('country', country);
      if (campaign !== 'all') params.set('campaign', campaign);
      if (device !== 'all') params.set('device', device);
      if (eventFilter !== 'all') params.set('event', eventFilter);
      const response = await fetch(`/api/dashboard?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Analytics request failed');
      setSnapshot(await response.json());
    } catch {
      setLoadError('Analytics could not refresh. The last successfully loaded view remains on screen.');
    } finally {
      setLoading(false);
    }
  }, [range, customStart, customEnd, country, campaign, device, eventFilter]);
  useEffect(() => { load(); }, [load]);
  const metric = (key: string) => snapshot.metrics[key] ?? 0;
  const countries = useMemo(() => snapshot.charts.byCountry.map((row) => row.name), [snapshot]);
  const campaigns = useMemo(() => snapshot.charts.byCampaign.map((row) => row.name), [snapshot]);
  const changeLabel = (value: number) => `${value >= 0 ? '+' : ''}${value}% vs prior`;
  const businessTabs = ['sales', 'registrations', 'clients', 'licenses', 'payments', 'releases', 'activity'];
  const isBusiness = businessTabs.includes(tab);
  const isOperationalSurface = isBusiness || tab === 'support';
  const titles: Record<string, [string, string, string]> = {
    sales: ['Business overview', 'Sales command center.', 'Clients, licenses and manually recorded revenue at a glance.'],
    registrations: ['Client onboarding', 'Registration queue.', 'Review new free accounts and clients who still need activation.'],
    clients: ['Client management', 'Your Orion clients.', 'Profiles, plans, contacts and complete commercial history.'],
    licenses: ['License operations', 'License manager.', 'Generate and monitor MT4 and MT5 access.'],
    payments: ['Payment records', 'Manual payments.', 'Store transaction details without connecting a payment gateway.'],
    releases: ['Product delivery', 'Downloads & releases.', 'Publish Orion versions and download links to client portals.'],
    activity: ['Audit trail', 'Client activity.', 'Every operational change in one chronological timeline.'],
    support: ['Client care', 'Official support desk.', 'Review secure client tickets, reply, and manage resolution status.']
  };
  const heading = titles[tab] || [tab === 'overview' ? 'Command center' : tab, tab === 'overview' ? 'Marketing performance, live.' : `${tab[0].toUpperCase()}${tab.slice(1)} activity`, 'Orion acquisition, attribution and conversion intelligence.'];
  const nav = [
    { label: 'Analytics', items: ['overview','visitors','campaigns','events','meta'] },
    { label: 'Business', items: ['sales','registrations','clients','licenses','payments','releases','activity','support'] },
    { label: 'System', items: ['settings'] }
  ];
  const icons: Record<string,string> = { overview:'✦', visitors:'◉', campaigns:'↗', events:'⌁', meta:'M', sales:'◇', registrations:'＋', clients:'◎', licenses:'⌘', payments:'$', releases:'⬇', activity:'≋', support:'?', settings:'⚙' };
  return (
    <main className="dashboard-shell command-center-shell">
      <header className="dashboard-topbar command-topbar" aria-label="Orion Royal command bar">
        <div className="command-brand-lockup">
          <OrionBrand context="ADMIN" className="command-brand" />
          <span className="command-surface-name">Royal command</span>
        </div>
        <div className="topbar-right command-topbar-actions">
          <CommandPalette canWrite={admin?.role === 'admin'} onNavigate={navigateFromCommand} onAction={executeCommand} />
          {admin?.role === 'admin' && (
            <button
              type="button"
              className="glass-button command-queue-badge"
              onClick={() => navigateNormally('overview')}
              aria-label={queueCount === null ? 'Open the action queue. Queue status is loading or unavailable.' : `Open the action queue. ${queueCount} ${queueCount === 1 ? 'item' : 'items'} need attention.`}
            >
              <span aria-hidden="true">⌁</span>
              <strong>{queueCount ?? '—'}</strong>
              <span>Queue</span>
            </button>
          )}
          <span className="admin-label command-admin-identity">
            <span className="command-admin-email">{admin?.email || 'Orion administrator'}</span>
            <span className="command-admin-role"> · {admin?.role || 'viewer'}</span>
          </span>
          <LogoutButton />
        </div>
      </header>

      <div className="dashboard-body command-center-layout">
        <aside className="sidebar command-sidebar" role="navigation" aria-label="Orion command center sections">
          {nav.map((group) => {
              const groupId = `command-nav-${group.label.toLowerCase()}`;
              return (
                <section className="nav-group command-nav-group" aria-labelledby={groupId} key={group.label}>
                  <h2 className="sidebar-label command-nav-label" id={groupId}>{group.label}</h2>
                  {group.items.map((item) => {
                    const label = item[0].toUpperCase() + item.slice(1);
                    const active = tab === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        className={active ? 'sidebar-link command-nav-item active' : 'sidebar-link command-nav-item'}
                        aria-current={active ? 'page' : undefined}
                        aria-controls="dashboard-command-content"
                        onClick={() => navigateNormally(item)}
                      >
                        <span className="command-nav-icon" aria-hidden="true">{icons[item]}</span>
                        <strong className="command-nav-text">{label}</strong>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          <div className={`sidebar-footer command-sidebar-status ${loading ? 'is-loading' : loadError ? 'has-error' : 'is-ready'}`} role="status"><span className="status-dot" aria-hidden="true" />{loading ? 'Refreshing analytics' : loadError ? 'Analytics status unknown' : 'Analytics connected'}</div>
        </aside>

        <section
          className="dashboard-content command-content"
          id="dashboard-command-content"
          aria-labelledby="dashboard-command-title"
          aria-busy={!isOperationalSurface && loading}
        >
          <header className="content-heading command-page-heading">
            <div className="command-heading-copy">
              <p className="eyebrow command-section-kicker">{heading[0]}</p>
              <h1 id="dashboard-command-title">{heading[1]}</h1>
              <p className="muted command-section-summary">{heading[2]}</p>
            </div>
            {!isOperationalSurface && tab !== 'settings' && tab !== 'meta' && (
              <div className="date-filter command-date-filter" role="group" aria-label="Analytics trend window">
                <label htmlFor="command-trend-window">Trend window</label>
                <select id="command-trend-window" value={range} onChange={(event) => setRange(event.target.value)}>
                  <option value="today">Day</option>
                  <option value="7d">Week</option>
                  <option value="30d">Month</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="custom">Custom range</option>
                </select>
                {range === 'custom' && (
                  <div className="command-custom-range">
                    <input aria-label="Custom range start date" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                    <input aria-label="Custom range end date" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                  </div>
                )}
              </div>
            )}
          </header>

          {!isBusiness && loadError && <div className="command-data-alert" role="alert"><span aria-hidden="true">!</span><p>{loadError}</p><button type="button" className="glass-button" onClick={() => void load()}>Retry</button></div>}
          {tab === 'releases' ? <ReleaseManager canWrite={admin?.role === 'admin'} /> : tab === 'support' ? <SupportTicketCenter /> : isBusiness ? <BusinessDashboard section={tab} canWrite={admin?.role === 'admin'} initialFilter={destinationFilter} initialSearch={destinationSearch} navigationKey={businessNavigationKey} commandAction={businessCommand} /> : <>{loading && <div className="loading-bar command-loading-bar" role="status" aria-label="Refreshing dashboard intelligence" />}{tab === 'settings' ? <SettingsPanel /> : tab === 'meta' ? <MetaPanel meta={snapshot.meta} /> : <><div className="filter-row"><Filter label="Country" value={country} options={countries} onChange={setCountry} /><Filter label="Campaign" value={campaign} options={campaigns} onChange={setCampaign} /><Filter label="Device" value={device} options={snapshot.charts.byDevice.map((row) => row.name)} onChange={setDevice} /><Filter label="Event" value={eventFilter} options={['PageView', 'ViewContent', 'PlanSelected', 'RegistrationStarted', 'RegistrationCompleted', 'CheckoutStarted', 'TelegramClick', 'SupportClick', 'Lead', 'Purchase']} onChange={setEventFilter} /></div><div className="metric-grid v2"><Metric label="Visitors" value={metric('uniqueVisitors')} detail={changeLabel(snapshot.comparison.visitors)} /><Metric label="Visitors online" value={metric('visitorsOnline')} detail="Active in last 5 minutes" positive /><Metric label="Telegram clicks" value={metric('telegramClicks')} detail={changeLabel(snapshot.comparison.telegramClicks)} positive /><Metric label="Conversion rate" value={`${metric('conversionRate')}%`} detail="Unique visitor → click" positive /><Metric label="Leads today" value={metric('leadsToday')} detail="Recorded lead rows" /></div>{tab === 'overview' && <><Overview snapshot={snapshot} showActionCenter={admin?.role === 'admin'} onNavigate={navigateFromActionCenter} onQueueCountChange={updateQueueCount} /><AdvancedAnalytics snapshot={snapshot} activeFilters={{ country: country === 'all' ? null : country, campaign: campaign === 'all' ? null : campaign, device: device === 'all' ? null : device, event: eventFilter === 'all' ? null : eventFilter, date: range === 'custom' && customStart === customEnd ? customStart : null }} onFilterChange={applyAdvancedFilter} /></>}{tab === 'visitors' && <VisitorTable rows={snapshot.visitors} />}{tab === 'campaigns' && <CampaignTable rows={snapshot.campaigns} />}{tab === 'events' && <EventTable rows={snapshot.events} />}</>}</>}
        </section>
      </div>
    </main>
  );
}

function analyticsIcon(label:string){if(label.includes('online'))return '●';if(label.includes('Telegram'))return '↗';if(label.includes('Conversion'))return '◈';if(label.includes('Lead'))return '✦';return '◎'}
function Metric({ label, value, detail, positive }: { label: string; value: number | string; detail: string; positive?: boolean }) { return <article className="metric-card"><span className="metric-icon" aria-hidden="true">{analyticsIcon(label)}</span><p>{label}</p><strong className={positive ? 'positive' : ''}>{value}</strong><small>{detail}</small></article>; }
function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="filter"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All</option>{options.map((option) => <option key={option} value={option}>{label==='Country'?`${countryFlag(option)} ${option}`:option}</option>)}</select></label>; }
function CommandTelemetry({ snapshot }: { snapshot: Snapshot }) {
  const online = numericValue(snapshot.metrics.visitorsOnline);
  const uniqueVisitors = numericValue(snapshot.metrics.uniqueVisitors);
  const conversionRate = numericValue(snapshot.metrics.conversionRate);
  const topMarket = topBreakdown(snapshot.charts.byCountry);
  const topCampaign = [...snapshot.campaigns].sort((a, b) => b.visitors - a.visitors)[0];
  const fallbackCampaign = topBreakdown(snapshot.charts.byCampaign);
  const campaignName = topCampaign?.name || fallbackCampaign?.name || 'No campaign data';
  const campaignVisitors = topCampaign?.visitors ?? fallbackCampaign?.value ?? 0;
  const eventCount = numericValue(snapshot.metrics.eventsInView);
  const deliveryCount = snapshot.meta.browserEvents + snapshot.meta.serverEvents;
  const latestEvent = snapshot.events[0];
  const funnelVisitors = numericValue(snapshot.funnel.visitors);
  const planSelected = numericValue(snapshot.funnel.planSelected);
  const registrations = numericValue(snapshot.funnel.registrationCompleted);
  const checkouts = numericValue(snapshot.funnel.checkoutStarted);
  const deliveryState = snapshot.meta.failed > 0 ? 'attention' : deliveryCount > 0 ? 'receiving' : 'idle';
  const conversionState = checkouts > 0 ? 'converting' : registrations > 0 ? 'registered' : planSelected > 0 ? 'intent' : funnelVisitors > 0 ? 'traffic' : 'idle';
  const conversionLabel = checkouts > 0
    ? 'Checkout activity detected'
    : registrations > 0
      ? 'Registration activity detected'
      : planSelected > 0
        ? 'Plan intent detected'
        : funnelVisitors > 0
          ? 'Traffic is entering the funnel'
          : 'Awaiting funnel traffic';
  const signals = snapshot.events.slice(0, 6);

  return (
    <section className="command-telemetry" aria-labelledby="command-telemetry-title">
      <header className="command-telemetry-heading">
        <div>
          <p className="eyebrow">Orion command telemetry</p>
          <h2 id="command-telemetry-title">Acquisition engine, live.</h2>
        </div>
        <span className={`command-telemetry-state command-telemetry-state--${online > 0 ? 'live' : 'idle'}`} role="status">
          <i aria-hidden="true" /> {online > 0 ? `${online} visitors online` : 'No visitors online'}
        </span>
      </header>

      <div className="command-telemetry-bento">
        <article className="panel command-engine-card" data-state={online > 0 || eventCount > 0 ? 'active' : 'idle'}>
          <div className="command-engine-visual" data-activity={online > 0 ? 'live' : 'idle'} aria-hidden="true">
            <span className="command-engine-ring command-engine-ring--outer" />
            <span className="command-engine-ring command-engine-ring--middle" />
            <span className="command-engine-ring command-engine-ring--inner" />
            <span className="command-engine-sweep" />
            {topMarket && <span className="command-engine-node command-engine-node--market" />}
            {(topCampaign || fallbackCampaign) && <span className="command-engine-node command-engine-node--campaign" />}
            {eventCount > 0 && <span className="command-engine-node command-engine-node--signal" />}
            <span className="command-engine-core"><b>{online}</b><small>live</small></span>
          </div>
          <div className="command-engine-copy">
            <p className="eyebrow">Live engine</p>
            <h3>Visitor radar</h3>
            <p>{eventCount > 0 ? `${eventCount.toLocaleString()} events match the current analytics view.` : 'No event signals are visible for the selected filters.'}</p>
          </div>
          <dl className="command-engine-stats">
            <div><dt>Online now</dt><dd>{online.toLocaleString()}</dd></div>
            <div><dt>Unique visitors</dt><dd>{uniqueVisitors.toLocaleString()}</dd></div>
            <div><dt>Latest signal</dt><dd>{latestEvent ? eventName(latestEvent) : 'None'}</dd></div>
          </dl>
        </article>

        <article className="panel command-telemetry-card command-telemetry-card--market">
          <span className="command-telemetry-icon" aria-hidden="true">◎</span>
          <p>Top market</p>
          <strong>{topMarket ? `${countryFlag(topMarket.name)} ${topMarket.name}` : 'No market data'}</strong>
          <small>{topMarket ? `${topMarket.value.toLocaleString()} visitors in this view` : 'Awaiting visitor geography'}</small>
        </article>

        <article className="panel command-telemetry-card command-telemetry-card--campaign">
          <span className="command-telemetry-icon" aria-hidden="true">↗</span>
          <p>Top campaign</p>
          <strong>{campaignName}</strong>
          <small>{campaignVisitors.toLocaleString()} visitors{topCampaign ? ` · ${topCampaign.clicks.toLocaleString()} clicks` : ''}</small>
        </article>

        <article className="panel command-telemetry-card command-telemetry-card--pipeline" data-state={deliveryState}>
          <span className="command-telemetry-icon" aria-hidden="true">⌁</span>
          <p>Event pipeline</p>
          <strong>{eventCount.toLocaleString()} events in view</strong>
          <small>{deliveryCount.toLocaleString()} browser + server deliveries · {snapshot.meta.failed.toLocaleString()} failed</small>
        </article>

        <article className="panel command-telemetry-card command-telemetry-card--conversion" data-state={conversionState}>
          <span className="command-telemetry-icon" aria-hidden="true">◇</span>
          <p>Conversion status</p>
          <strong>{conversionRate.toLocaleString()}%</strong>
          <small>{conversionLabel}</small>
        </article>
      </div>

      <section className="panel command-signal-strip" aria-labelledby="command-signal-strip-title">
        <header>
          <div><p className="eyebrow">Signal strip</p><h3 id="command-signal-strip-title">Latest pipeline activity</h3></div>
          <span>{signals.length.toLocaleString()} shown</span>
        </header>
        {signals.length ? (
          <ol>
            {signals.map((signal, index) => (
              <li key={signal.event_id || `${signal.created_at || 'signal'}-${index}`}>
                <span className="command-signal-sequence">{String(index + 1).padStart(2, '0')}</span>
                <span className="command-signal-type"><i aria-hidden="true" />{eventName(signal)}</span>
                <span className="command-signal-context">{signal.utm_campaign || signal.country || visitorToken(signal.visitor_id)}</span>
                <time dateTime={signal.created_at || undefined}>{signalTime(signal.created_at)}</time>
              </li>
            ))}
          </ol>
        ) : <p className="empty-state command-signal-empty">No event signals match the current filters.</p>}
      </section>
    </section>
  );
}

function Overview({ snapshot, showActionCenter, onNavigate, onQueueCountChange }: { snapshot: Snapshot; showActionCenter: boolean; onNavigate: ActionCenterNavigate; onQueueCountChange: (count: number | null) => void }) { return <>
  {showActionCenter && <AdminActionCenter onNavigate={onNavigate} onQueueCountChange={onQueueCountChange} />}
  <CommandTelemetry snapshot={snapshot} />
  <div className="overview-grid"><TrendPanel data={snapshot.charts.byDay} /><article className="panel funnel-panel"><div className="panel-heading"><div><p className="eyebrow">Conversion funnel</p><h2>Visitor → checkout</h2></div></div><FunnelStep label="Landing-page visitors" value={snapshot.funnel.visitors} width={100} color={royalPalette.gold} /><FunnelStep label="Plan selected" value={snapshot.funnel.planSelected || 0} width={snapshot.funnel.visitors ? (snapshot.funnel.planSelected || 0) / snapshot.funnel.visitors * 100 : 0} color={royalPalette.cyan} /><FunnelStep label="Registration started" value={snapshot.funnel.registrationStarted || 0} width={snapshot.funnel.visitors ? (snapshot.funnel.registrationStarted || 0) / snapshot.funnel.visitors * 100 : 0} color={royalPalette.orange} /><FunnelStep label="Registration completed" value={snapshot.funnel.registrationCompleted || 0} width={snapshot.funnel.visitors ? (snapshot.funnel.registrationCompleted || 0) / snapshot.funnel.visitors * 100 : 0} color={royalPalette.green} /><FunnelStep label="Checkout started" value={snapshot.funnel.checkoutStarted || 0} width={snapshot.funnel.visitors ? (snapshot.funnel.checkoutStarted || 0) / snapshot.funnel.visitors * 100 : 0} color={royalPalette.goldBright} /></article></div>
  <div className="insight-grid"><BreakdownPanel title="Countries" eyebrow="Geography" data={snapshot.charts.byCountry} color={royalPalette.gold} /><BreakdownPanel title="Cities" eyebrow="Top markets" data={snapshot.charts.byCity} color={royalPalette.cyan} /><DonutPanel title="Devices" data={snapshot.charts.byDevice} /><BreakdownPanel title="Browsers" eyebrow="Technology" data={snapshot.charts.byBrowser} color={royalPalette.green} /></div>
  <div className="overview-grid lower"><BreakdownPanel title="Top referrers" eyebrow="Acquisition" data={snapshot.charts.byReferrer} color={royalPalette.goldBright} /><article className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Live activity</p><h2>Latest visitor signals</h2></div><span className="live-pill"><i /> Live</span></div><EventTable rows={snapshot.events.slice(0, 8)} /></article></div>
  <CampaignTable rows={snapshot.campaigns.slice(0, 8)} compact />
</> }

function TrendPanel({ data }: { data: any[] }) { return <article className="panel chart-panel command-trend-panel"><div className="panel-heading"><div><p className="eyebrow">Visitor trend</p><h2>Visitors and Telegram clicks</h2></div><span className="legend"><i className="cyan-dot" style={{ background: royalPalette.cyan }} /> Visitors <i className="green-dot" style={{ background: royalPalette.green }} /> Clicks</span></div><div className="chart-wrap command-trend-chart" role="img" aria-label="Area chart comparing visitors and Telegram clicks over the selected trend window"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id="orionVisitorFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={royalPalette.cyan} stopOpacity={0.42} /><stop offset="100%" stopColor={royalPalette.cyan} stopOpacity={0} /></linearGradient><linearGradient id="orionClickFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={royalPalette.green} stopOpacity={0.22} /><stop offset="100%" stopColor={royalPalette.green} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke={royalPalette.grid} vertical={false} /><XAxis dataKey="date" stroke={royalPalette.muted} tickLine={false} axisLine={false} /><YAxis stroke={royalPalette.muted} tickLine={false} axisLine={false} allowDecimals={false} /><Tooltip contentStyle={royalTooltipStyle} labelStyle={{ color: royalPalette.goldBright }} itemStyle={{ color: '#f5f8f8' }} cursor={{ stroke: 'rgba(246,196,83,.24)' }} /><Area type="monotone" dataKey="visitors" stroke={royalPalette.cyan} fill="url(#orionVisitorFill)" strokeWidth={2.2} activeDot={{ r: 4, fill: royalPalette.cyan, stroke: '#010202', strokeWidth: 2 }} /><Area type="monotone" dataKey="clicks" stroke={royalPalette.green} fill="url(#orionClickFill)" strokeWidth={2.2} activeDot={{ r: 4, fill: royalPalette.green, stroke: '#010202', strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div></article>; }
function BreakdownPanel({ title, eyebrow, data, color }: { title: string; eyebrow: string; data: Breakdown[]; color: string }) { const max = data[0]?.value || 1; return <article className="panel breakdown-panel"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div><div className="rank-list">{data.slice(0, 6).map((row, index) => <div className="rank-row" key={row.name}><span className="rank">{String(index + 1).padStart(2, '0')}</span><div><div><span>{title==='Countries'?`${countryFlag(row.name)} ${row.name}`:row.name}</span><strong>{row.value}</strong></div><i><b style={{ width: `${row.value / max * 100}%`, background: color }} /></i></div></div>)}{!data.length && <p className="empty-state">No data in this period.</p>}</div></article>; }
function DonutPanel({ title, data }: { title: string; data: Breakdown[] }) { const colors = [royalPalette.gold, royalPalette.cyan, royalPalette.green, royalPalette.orange]; return <article className="panel breakdown-panel command-donut-panel"><p className="eyebrow">Audience</p><h2>{title}</h2><div className="donut-layout"><div className="donut command-donut-chart" role="img" aria-label={`Donut chart showing ${title.toLowerCase()} distribution`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={46} outerRadius={68} paddingAngle={3} stroke="rgba(1,5,5,.9)" strokeWidth={2}>{data.map((row, index) => <Cell key={row.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip contentStyle={royalTooltipStyle} labelStyle={{ color: royalPalette.goldBright }} itemStyle={{ color: '#f5f8f8' }} /></PieChart></ResponsiveContainer></div><div className="mini-legend">{data.slice(0, 4).map((row, index) => <span key={row.name}><i style={{ background: colors[index % colors.length] }} />{row.name}<b>{row.value}</b></span>)}</div></div></article>; }
function FunnelStep({ label, value, width, color }: { label: string; value: number; width: number; color: string }) { const boundedWidth = value > 0 ? Math.max(3, Math.min(100, width)) : 0; return <div className="funnel-step"><div><span>{label}</span><strong>{value}</strong></div><div className="funnel-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(Math.max(0, Math.min(100, width)))} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${boundedWidth}%`, background: color }} /></div></div>; }
function EventTable({ rows }: { rows: DashboardEvent[] }) { return <div className="data-table"><div className="table-head"><span>Event</span><span>Visitor</span><span>Time</span></div>{rows.length ? rows.map((row, index) => <div className="table-row" key={row.event_id || `${row.created_at || 'event'}-${index}`}><span><b className="event-icon">{row.event_name === 'TelegramClick' || row.event_name === 'Lead' ? '↗' : '•'}</b>{eventName(row)}</span><code>{visitorToken(row.visitor_id)}</code><time dateTime={row.created_at || undefined}>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</time></div>) : <p className="empty-state">No events in this period.</p>}</div>; }
function VisitorTable({ rows }: { rows: any[] }) { return <article className="panel table-panel full"><div className="panel-heading"><div><p className="eyebrow">Anonymous audience</p><h2>Visitors</h2></div></div><div className="data-table"><div className="table-head visitor-head"><span>Visitor</span><span>Location</span><span>Device</span><span>Campaign</span><span>Telegram</span><span>Last visit</span></div>{rows.map((row) => <div className="table-row visitor-row" key={row.visitor_id}><code>{String(row.visitor_id).slice(0, 16)}…</code><span>{countryFlag(row.country)} {row.city || '—'}{row.country ? `, ${row.country}` : ''}</span><span>{row.device_type || '—'}</span><span>{row.utm_campaign || 'Organic'}</span><span className={row.telegram_clicked ? 'positive' : 'muted'}>{row.telegram_clicked ? 'Clicked' : '—'}</span><time>{new Date(row.last_seen).toLocaleString()}</time></div>)}</div></article>; }
function CampaignTable({ rows, compact = false }: { rows: Campaign[]; compact?: boolean }) { return <article className={`panel table-panel full ${compact ? 'campaign-compact' : ''}`}><div className="panel-heading"><div><p className="eyebrow">UTM attribution</p><h2>Campaign performance</h2></div></div><div className="data-table"><div className="table-head campaign-head"><span>Campaign</span><span>Visitors</span><span>Telegram clicks</span><span>Conversion</span></div>{rows.map((row) => <div className="table-row campaign-row" key={row.name}><span>{row.name}</span><strong>{row.visitors}</strong><span>{row.clicks}</span><span className="positive">{row.conversionRate}%</span></div>)}{!rows.length && <p className="empty-state">No campaign data in this period.</p>}</div></article>; }
function MetaPanel({ meta }: { meta: Snapshot['meta'] }) { return <div className="settings-grid"><article className="panel status-panel"><p className="eyebrow">Meta Events</p><h2>Browser + server events</h2><p className="muted">Shared event IDs are sent from the Framer Pixel and the Conversions API so Meta can deduplicate them.</p><div className="status-line"><span className="status-dot" /> Browser events: {meta.browserEvents}</div><div className="status-line"><span className="status-dot" /> Server events: {meta.serverEvents} · successful {meta.successful}</div><div className="status-line warning"><span className="status-dot" /> Failed sends: {meta.failed} · last sync {meta.lastSync ? new Date(meta.lastSync).toLocaleString() : '—'}</div></article><article className="panel status-panel"><p className="eyebrow">Event map</p><h2>Conversion signals</h2><p className="muted">PageView and ViewContent build intent. CompleteRegistration marks a verified signup, InitiateCheckout marks the protected order review, Lead is the official Telegram CTA, and Purchase remains backend-only.</p><div className="event-chip-list"><span>PageView</span><span>ViewContent</span><span>CompleteRegistration</span><span>InitiateCheckout</span><span>Lead</span><span>Contact</span><span>Purchase</span></div><p className="muted small">Recent deduplication IDs: {meta.eventIds.length ? meta.eventIds.join(', ') : 'none yet'}</p></article></div>; }
function SettingsPanel() { return <div className="settings-grid"><article className="panel status-panel"><p className="eyebrow">Installation</p><h2>Framer tracking checklist</h2><ol className="steps"><li>Paste <code>public/framer-tracking.js</code> into Framer Project Settings → Custom Code → End of body.</li><li>Add the Meta Pixel snippet immediately after the tracking script.</li><li>Set the production API base URL and Telegram destination in the snippet config.</li><li>Publish, then verify events in Meta Events Manager → Test events.</li></ol></article><article className="panel status-panel"><p className="eyebrow">Connections</p><h2>System settings</h2><div className="status-line"><span className="status-dot" /> Supabase connection is server-only</div><div className="status-line"><span className="status-dot" /> Telegram redirect is allow-listed</div><div className="status-line"><span className="status-dot" /> Raw IP storage disabled</div><p className="muted small">Data retention: configured with DATA_RETENTION_DAYS. Run the deletion utility on a schedule.</p></article></div>; }
