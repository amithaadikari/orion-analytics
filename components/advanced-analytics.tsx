'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { countryCode, countryFlag, countryName } from '@/lib/country';
import styles from './advanced-analytics.module.css';
import mapStyles from './advanced-analytics-map.module.css';

type Breakdown = { name: string; value: number };
type Campaign = { name: string; visitors: number; clicks: number; conversionRate: number };
type CountryDeviceCell = { country: string; device: string; value: number };
type DailyConversionCell = { date: string; stage: string; value: number };
type VisitorRow = { visitor_id: string; country?: string; city?: string; device_type?: string; utm_campaign?: string; last_seen?: string };

export type AdvancedFilterPatch = Partial<Record<'country' | 'campaign' | 'device' | 'event' | 'date', string | null>>;
export type AdvancedFilterSource = 'world-map' | 'campaign-chart' | 'country-device-heatmap' | 'conversion-heatmap';
export type AdvancedAnalyticsSnapshot = {
  charts: { byCountry: Breakdown[]; byDevice: Breakdown[] };
  campaigns: Campaign[];
  visitors: VisitorRow[];
  heatmaps: {
    countries?: Breakdown[];
    countryDevice: CountryDeviceCell[];
    dailyConversion: DailyConversionCell[];
    devices?: string[];
    stages?: string[];
  };
};

export type AdvancedAnalyticsProps = {
  snapshot: AdvancedAnalyticsSnapshot;
  activeFilters?: AdvancedFilterPatch;
  onFilterChange: (patch: AdvancedFilterPatch, source: AdvancedFilterSource) => void;
  journeyEndpoint?: (visitorId: string) => string;
  visitorLimit?: number;
};

type Journey = {
  visitor: { token: string; firstSeen: string; lastSeen: string; country: string; city: string | null; device: string; browser: string; operatingSystem: string; campaign: string; source: string | null; medium: string | null; landingPage: string | null; referrer: string | null };
  timeline: { id: string; type: 'session' | 'event'; label: string; detail: string | null; occurredAt: string; session: string | null }[];
};

export function AdvancedAnalytics({ snapshot, activeFilters = {}, onFilterChange, journeyEndpoint = (id) => `/api/analytics/visitor/${encodeURIComponent(id)}`, visitorLimit = 10 }: AdvancedAnalyticsProps) {
  const [journeyVisitor, setJourneyVisitor] = useState<VisitorRow | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyError, setJourneyError] = useState('');
  const [journeyLoading, setJourneyLoading] = useState(false);

  const openJourney = useCallback(async (visitor: VisitorRow) => {
    setJourneyVisitor(visitor);
    setJourney(null);
    setJourneyError('');
    setJourneyLoading(true);
    try {
      const response = await fetch(journeyEndpoint(visitor.visitor_id), { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 404 ? 'Visitor journey was not found.' : 'Visitor journey is unavailable.');
      setJourney(await response.json());
    } catch (error) {
      setJourneyError(error instanceof Error ? error.message : 'Visitor journey is unavailable.');
    } finally {
      setJourneyLoading(false);
    }
  }, [journeyEndpoint]);

  const closeJourney = useCallback(() => setJourneyVisitor(null), []);
  useEffect(() => {
    if (!journeyVisitor) return;
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') closeJourney(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', close); };
  }, [closeJourney, journeyVisitor]);

  const visitors = snapshot.visitors.slice(0, visitorLimit);
  return <section className={styles.module} aria-label="Advanced analytics">
    <header className={styles.heading}>
      <div><p>Advanced analytics</p><h2>Explore every market signal</h2></div>
      <span>Click a map point, bar, or heat cell to filter the full dashboard.</span>
    </header>
    <div className={styles.primaryGrid}>
      <WorldActivityMap countries={snapshot.heatmaps.countries || snapshot.charts.byCountry} activeCountry={activeFilters.country} onSelect={(country) => onFilterChange({ country: toggle(activeFilters.country, country) }, 'world-map')} />
      <CampaignComparisonChart campaigns={snapshot.campaigns} activeCampaign={activeFilters.campaign} onSelect={(campaign) => onFilterChange({ campaign: toggle(activeFilters.campaign, campaign) }, 'campaign-chart')} />
    </div>
    <div className={styles.heatmapGrid}>
      <CountryDeviceHeatmap cells={snapshot.heatmaps.countryDevice} devices={snapshot.heatmaps.devices} active={activeFilters} onSelect={(country, device) => { const selected = activeFilters.country === country && activeFilters.device === device; onFilterChange({ country: selected ? null : country, device: selected ? null : device }, 'country-device-heatmap'); }} />
      <ConversionHeatmap cells={snapshot.heatmaps.dailyConversion} stages={snapshot.heatmaps.stages} active={activeFilters} onSelect={(date, stage) => onFilterChange({ date, event: stage === 'Visitors' ? null : toggle(activeFilters.event, stage) }, 'conversion-heatmap')} />
    </div>
    <article className={styles.visitorPanel}>
      <div className={styles.cardHeading}><div><p>Journey explorer</p><h3>Recent anonymous visitors</h3></div><span>Projected identifiers only</span></div>
      <div className={styles.visitorList}>
        {visitors.map((visitor) => <button type="button" key={visitor.visitor_id} onClick={() => void openJourney(visitor)}>
          <span>{mask(visitor.visitor_id)}</span><strong>{visitor.country || 'Unknown'}{visitor.city ? ` · ${visitor.city}` : ''}</strong><small>{visitor.device_type || 'Unknown device'} · {visitor.utm_campaign || 'Organic'}</small><time>{formatTime(visitor.last_seen)}</time>
        </button>)}
        {!visitors.length && <p className={styles.empty}>No visitors match the current filters.</p>}
      </div>
    </article>
    {journeyVisitor && <VisitorJourneyDrawer visitor={journeyVisitor} journey={journey} loading={journeyLoading} error={journeyError} onClose={closeJourney} />}
  </section>;
}

export function WorldActivityMap({ countries, activeCountry, onSelect }: { countries: Breakdown[]; activeCountry?: string | null; onSelect: (country: string) => void }) {
  const max = Math.max(1, ...countries.map((row) => row.value));
  const located = countries.map((row) => ({ ...row, point: countryPoint(row.name) })).filter((row) => row.point) as (Breakdown & { point: [number, number] })[];
  return <article className={styles.card}>
    <div className={styles.cardHeading}><div><p>Selected-period geography</p><h3>Visitor world map</h3></div><span>{countries.reduce((total, row) => total + row.value, 0).toLocaleString()} visitors</span></div>
    <div className={mapStyles.mapWrap}>
      <svg className={mapStyles.worldMap} viewBox="0 0 720 340" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="718" height="338" rx="20" className={mapStyles.mapOcean} />
        <g className={mapStyles.dotMatrix}>{WORLD_DOTS.map((dot) => <circle key={dot.key} cx={dot.x} cy={dot.y} r="1.8" className={`${mapStyles.landDot} ${mapStyles[`landDot${dot.region}`]}`} style={{ '--dot-delay': `${dot.delay}s` } as CSSProperties} />)}</g>
        {located.map((country, index) => {
          const [x, y] = project(country.point[1], country.point[0]);
          const radius = 4 + Math.sqrt(country.value / max) * 8;
          const selected = country.name === activeCountry;
          return <g key={country.name} className={selected ? mapStyles.mapPointActive : mapStyles.mapPoint} onClick={() => onSelect(country.name)}>
            <circle cx={x} cy={y} r={radius + 7} className={mapStyles.mapPulse} />
            <circle cx={x} cy={y} r={radius} className={mapStyles.mapBubble} />
            {(selected || index < 4) && <text x={x} y={y - radius - 7} textAnchor="middle">{countryCode(country.name) || country.name}</text>}
          </g>;
        })}
      </svg>
      <div className={mapStyles.countryRail} role="group" aria-label="Filter analytics by visitor country">
        {countries.map((row) => <button key={row.name} type="button" aria-pressed={row.name === activeCountry} onClick={() => onSelect(row.name)}><span>{countryFlag(row.name)}</span><strong>{countryName(row.name)}</strong><b>{row.value}</b></button>)}
        {!countries.length && <p className={mapStyles.empty}>Country activity will appear here when visitor geography is available.</p>}
      </div>
    </div>
  </article>;
}

export function CampaignComparisonChart({ campaigns, activeCampaign, onSelect }: { campaigns: Campaign[]; activeCampaign?: string | null; onSelect: (campaign: string) => void }) {
  const maximum = Math.max(1, ...campaigns.flatMap((row) => [row.visitors, row.clicks]));
  return <article className={styles.card}>
    <div className={styles.cardHeading}><div><p>Acquisition</p><h3>Campaign comparison</h3></div><span>Visitors · clicks · conversion</span></div>
    <div className={styles.campaignChart}>
      {campaigns.slice(0, 10).map((campaign) => <button type="button" aria-pressed={campaign.name === activeCampaign} key={campaign.name} onClick={() => onSelect(campaign.name)}>
        <span><strong>{campaign.name}</strong><small>{campaign.conversionRate}% conversion</small></span>
        <i className={styles.visitorBar} style={{ width: `${Math.max(2, campaign.visitors / maximum * 100)}%` }}><b>{campaign.visitors}</b></i>
        <i className={styles.clickBar} style={{ width: `${Math.max(2, campaign.clicks / maximum * 100)}%` }}><b>{campaign.clicks}</b></i>
      </button>)}
      {!campaigns.length && <p className={styles.empty}>No campaign data in this period.</p>}
    </div>
  </article>;
}

function CountryDeviceHeatmap({ cells, devices: providedDevices, active, onSelect }: { cells: CountryDeviceCell[]; devices?: string[]; active: AdvancedFilterPatch; onSelect: (country: string, device: string) => void }) {
  const countries = useMemo(() => totals(cells, 'country').slice(0, 9).map(([name]) => name), [cells]);
  const devices = providedDevices?.length ? providedDevices.slice(0, 6) : totals(cells, 'device').slice(0, 6).map(([name]) => name);
  const maximum = Math.max(1, ...cells.map((cell) => cell.value));
  const value = (country: string, device: string) => cells.find((cell) => cell.country === country && cell.device === device)?.value || 0;
  return <article className={styles.card}>
    <div className={styles.cardHeading}><div><p>Audience matrix</p><h3>Country × device</h3></div><span>Unique visitor records</span></div>
    <div className={styles.heatmap} style={{ '--columns': devices.length || 1 } as CSSProperties}>
      <span />{devices.map((device) => <b key={device}>{device}</b>)}
      {countries.map((country) => <div className={styles.heatmapRow} key={country}>
        <strong>{country}</strong>{devices.map((device) => { const count = value(country, device); return <button type="button" key={device} disabled={!count} aria-label={`${country}, ${device}: ${count} visitors`} aria-pressed={active.country === country && active.device === device} style={{ '--heat': count / maximum } as CSSProperties} onClick={() => onSelect(country, device)}>{count || '—'}</button>; })}
      </div>)}
      {!countries.length && <p className={styles.empty}>No country/device data in this period.</p>}
    </div>
  </article>;
}

function ConversionHeatmap({ cells, stages: providedStages, active, onSelect }: { cells: DailyConversionCell[]; stages?: string[]; active: AdvancedFilterPatch; onSelect: (date: string, stage: string) => void }) {
  const dates = [...new Set(cells.map((cell) => cell.date))].sort().slice(-10);
  const stages = (providedStages?.length ? providedStages : [...new Set(cells.map((cell) => cell.stage))]).slice(0, 7);
  const maximum = Math.max(1, ...cells.map((cell) => cell.value));
  const value = (date: string, stage: string) => cells.find((cell) => cell.date === date && cell.stage === stage)?.value || 0;
  return <article className={styles.card}>
    <div className={styles.cardHeading}><div><p>Conversion pulse</p><h3>Daily stage heatmap</h3></div><span>Unique visitors per stage</span></div>
    <div className={styles.conversionHeatmap} style={{ '--columns': dates.length || 1 } as CSSProperties}>
      <span />{dates.map((date) => <b key={date}>{date.slice(5)}</b>)}
      {stages.map((stage) => <div className={styles.heatmapRow} key={stage}>
        <strong title={stage}>{stageLabel(stage)}</strong>{dates.map((date) => { const count = value(date, stage); return <button type="button" key={date} disabled={!count} aria-label={`${date}, ${stage}: ${count} visitors`} aria-pressed={active.date === date && active.event === stage} style={{ '--heat': count / maximum } as CSSProperties} onClick={() => onSelect(date, stage)}>{count || '—'}</button>; })}
      </div>)}
      {!dates.length && <p className={styles.empty}>No conversion data in this period.</p>}
    </div>
  </article>;
}

export function VisitorJourneyDrawer({ visitor, journey, loading, error, onClose }: { visitor: VisitorRow; journey: Journey | null; loading: boolean; error: string; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);
  return createPortal(<div className={styles.drawerBackdrop} role="presentation" onMouseDown={onClose}>
    <aside ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="visitor-journey-title" onKeyDown={(event) => trapDialogFocus(event, drawerRef.current)} onMouseDown={(event) => event.stopPropagation()}>
      <button ref={closeRef} type="button" className={styles.close} aria-label="Close visitor journey" onClick={onClose}>×</button>
      <p className={styles.drawerEyebrow}>Anonymous journey</p><h2 id="visitor-journey-title">{journey?.visitor.token || mask(visitor.visitor_id)}</h2>
      {journey && <div className={styles.journeyFacts}><span><small>Location</small>{journey.visitor.country}{journey.visitor.city ? ` · ${journey.visitor.city}` : ''}</span><span><small>Device</small>{journey.visitor.device} · {journey.visitor.browser}</span><span><small>Campaign</small>{journey.visitor.campaign}</span><span><small>First → last</small>{formatTime(journey.visitor.firstSeen)} → {formatTime(journey.visitor.lastSeen)}</span></div>}
      {loading && <p className={styles.loading}>Building the visitor timeline…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {journey && <ol className={styles.timeline}>{journey.timeline.map((item, index) => <li key={item.id}><i>{String(index + 1).padStart(2, '0')}</i><div><time>{formatTime(item.occurredAt)}</time><strong>{item.label}</strong><p>{item.detail || 'Tracked interaction'}{item.session ? ` · ${item.session}` : ''}</p></div></li>)}{!journey.timeline.length && <p className={styles.empty}>No journey events were recorded.</p>}</ol>}
    </aside>
  </div>, document.body);
}

function totals(cells: CountryDeviceCell[], key: 'country' | 'device') {
  const sums = new Map<string, number>();
  cells.forEach((cell) => sums.set(cell[key], (sums.get(cell[key]) || 0) + cell.value));
  return [...sums.entries()].sort((left, right) => right[1] - left[1]);
}

function toggle(active: string | null | undefined, next: string) { return active === next ? null : next; }
function mask(value: string) { return value.length <= 14 ? value : `${value.slice(0, 10)}…${value.slice(-4)}`; }
function formatTime(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }
function stageLabel(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace('Registration', 'Reg.'); }
function activateKey(event: KeyboardEvent<SVGGElement>, action: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } }
function trapDialogFocus(event: KeyboardEvent<HTMLElement>, dialog: HTMLElement | null) { if (event.key !== 'Tab' || !dialog) return; const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
function project(longitude: number, latitude: number): [number, number] { return [14 + (longitude + 180) / 360 * 692, 14 + (90 - latitude) / 180 * 312]; }

const CENTROIDS: Record<string, [number, number]> = {
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5], BR: [-10.8, -52.9], AR: [-38.4, -63.6], CL: [-33.4, -70.7], CO: [4.6, -74.1], PE: [-9.2, -75], VE: [6.4, -66.6], EC: [-1.4, -78.4],
  GB: [55.4, -3.4], IE: [53.1, -8], FR: [46.2, 2.2], ES: [40.5, -3.7], PT: [39.4, -8.2], DE: [51.2, 10.4], IT: [42.8, 12.8], NL: [52.1, 5.3], BE: [50.5, 4.5], CH: [46.8, 8.2], AT: [47.5, 14.6], PL: [51.9, 19.1], SE: [60.1, 18.6], NO: [60.5, 8.5], FI: [61.9, 25.7], DK: [56.3, 9.5], GR: [39.1, 21.8], RO: [45.9, 24.9], UA: [48.4, 31.2], RU: [61.5, 105.3], AZ: [40.1, 47.6],
  TR: [39, 35.2], IL: [31, 34.9], SA: [23.9, 45.1], AE: [23.4, 53.8], EG: [26.8, 30.8], MA: [31.8, -7.1], NG: [9.1, 8.7], KE: [-0.02, 37.9], TZ: [-6.4, 34.9], GH: [7.9, -1], ZA: [-30.6, 22.9], QA: [25.3, 51.2], KW: [29.3, 47.5], OM: [20.6, 56.1],
  IN: [20.6, 79], PK: [30.4, 69.3], BD: [23.7, 90.4], LK: [7.9, 80.8], NP: [28.4, 84.1], CN: [35.9, 104.2], JP: [36.2, 138.3], KR: [36.5, 127.9], ID: [-0.8, 113.9], MY: [4.2, 101.98], SG: [1.35, 103.8], TH: [15.9, 100.99], VN: [14.1, 108.3], PH: [12.9, 121.8], AU: [-25.3, 133.8], NZ: [-40.9, 174.9],
};
function countryPoint(country: string) { const code = countryCode(country); return code ? CENTROIDS[code] || null : null; }

type LandRegionName = 'NorthAmerica' | 'SouthAmerica' | 'Europe' | 'Africa' | 'Asia' | 'Oceania';
type LandRegion = { name: LandRegionName; polygons: [number, number][][] };

const LAND_REGIONS: LandRegion[] = [
  { name: 'NorthAmerica', polygons: [
    [[-168, 72], [-140, 73], [-118, 56], [-103, 50], [-83, 47], [-55, 54], [-52, 40], [-74, 20], [-98, 15], [-118, 30], [-130, 52], [-154, 60]],
    [[-72, 81], [-18, 81], [-18, 61], [-48, 58], [-67, 67]],
  ] },
  { name: 'SouthAmerica', polygons: [[[-81, 13], [-58, 10], [-35, -6], [-47, -28], [-55, -55], [-69, -51], [-76, -23]]] },
  { name: 'Europe', polygons: [[[-12, 36], [-10, 58], [4, 71], [30, 70], [43, 56], [35, 41], [18, 35]]] },
  { name: 'Africa', polygons: [[[-18, 36], [31, 37], [51, 12], [40, -35], [16, -36], [-9, 5]]] },
  { name: 'Asia', polygons: [[[30, 72], [176, 70], [166, 53], [146, 40], [129, 20], [114, -10], [91, 7], [66, 21], [51, 39], [36, 49]]] },
  { name: 'Oceania', polygons: [[[110, -10], [155, -10], [154, -41], [114, -43]], [[165, -34], [180, -34], [180, -48], [168, -48]]] },
];

const WORLD_DOTS = (() => {
  const dots: { key: string; x: number; y: number; region: LandRegionName; delay: number }[] = [];
  for (let latitude = 78; latitude >= -54; latitude -= 6) {
    for (let longitude = -174; longitude <= 174; longitude += 6) {
      const region = LAND_REGIONS.find((candidate) => candidate.polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon)));
      if (!region) continue;
      const [x, y] = project(longitude, latitude);
      dots.push({ key: `${longitude}:${latitude}`, x, y, region: region.name, delay: (dots.length % 13) * .06 });
    }
  }
  return dots;
})();

function pointInPolygon(longitude: number, latitude: number, polygon: [number, number][]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentLongitude, currentLatitude] = polygon[current];
    const [previousLongitude, previousLatitude] = polygon[previous];
    const crosses = (currentLatitude > latitude) !== (previousLatitude > latitude)
      && longitude < (previousLongitude - currentLongitude) * (latitude - currentLatitude) / (previousLatitude - currentLatitude) + currentLongitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

export default AdvancedAnalytics;
