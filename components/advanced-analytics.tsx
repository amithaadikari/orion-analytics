'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { geoCentroid, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldAtlas from 'world-atlas/countries-110m.json';
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
  const total = countries.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(1, ...countries.map((row) => row.value));
  const rowsByCode = new Map(countries.map((row) => [countryCode(row.name), row]).filter((entry): entry is [string, Breakdown] => Boolean(entry[0])));
  const topMarkets = countries
    .map((row) => {
      const code = countryCode(row.name);
      const shape = code ? WORLD_SHAPE_BY_CODE.get(code) : undefined;
      const point = code ? shape?.centroid || projectMicroCountry(code) : null;
      return code && point ? { ...row, code, point, hasShape: Boolean(shape) } : null;
    })
    .filter((row): row is Breakdown & { code: string; point: [number, number]; hasShape: boolean } => Boolean(row))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3);
  return <article className={styles.card}>
    <div className={styles.cardHeading}><div><p>Selected-period geography</p><h3>Visitor world map</h3></div><span>{total.toLocaleString()} visitors</span></div>
    <div className={mapStyles.mapWrap}>
      <div className={mapStyles.mapLegend} aria-label="Visitor density legend"><span>Visitor density</span><i>Low</i><b aria-hidden="true" /><i>High</i></div>
      <svg className={mapStyles.worldMap} viewBox="0 0 720 340" role="group" aria-label="Interactive world map showing visitors by country">
        <rect x="1" y="1" width="718" height="338" rx="20" className={mapStyles.mapOcean} />
        <path d={WORLD_GRATICULE_PATH} className={mapStyles.mapGrid} />
        <g className={mapStyles.countryShapes}>{WORLD_SHAPES.map((shape) => {
          const row = shape.code ? rowsByCode.get(shape.code) : undefined;
          const selected = Boolean(row && row.name === activeCountry);
          const label = row ? `${countryName(row.name)}: ${row.value.toLocaleString()} ${row.value === 1 ? 'visitor' : 'visitors'}, ${total ? (row.value / total * 100).toFixed(1) : '0'}% of selected traffic` : shape.name;
          const className = row ? selected ? mapStyles.countryShapeSelected : mapStyles.countryShapeActive : mapStyles.countryShape;
          const heat = row ? `${Math.round(24 + row.value / max * 68)}%` : '0%';
          return <path
            key={shape.id}
            d={shape.path}
            className={className}
            style={{ '--country-heat': heat } as CSSProperties}
            role={row ? 'button' : undefined}
            tabIndex={row ? 0 : undefined}
            aria-label={row ? label : undefined}
            aria-pressed={row ? selected : undefined}
            aria-hidden={row ? undefined : true}
            onClick={row ? () => onSelect(row.name) : undefined}
            onKeyDown={row ? (event) => activateKey(event, () => onSelect(row.name)) : undefined}
          ><title>{label}</title></path>;
        })}</g>
        <g className={mapStyles.topMarkets}>{topMarkets.map((market, index) => {
          const radius = 3.5 + Math.sqrt(market.value / max) * 3.5;
          const interactive = !market.hasShape;
          const label = `${countryName(market.name)}: ${market.value.toLocaleString()} ${market.value === 1 ? 'visitor' : 'visitors'}`;
          return <g
            key={market.code}
            className={`${index === 0 ? mapStyles.primaryBeacon : mapStyles.marketBeacon} ${interactive ? mapStyles.microBeacon : ''}`.trim()}
            transform={`translate(${market.point[0]} ${market.point[1]})`}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${label}, select country filter` : undefined}
            aria-hidden={interactive ? undefined : true}
            onClick={interactive ? () => onSelect(market.name) : undefined}
            onKeyDown={interactive ? (event) => activateKey(event, () => onSelect(market.name)) : undefined}
          >
            <title>{label}</title>
            <circle r={radius + 8} className={mapStyles.beaconHalo} />
            <circle r={radius} className={mapStyles.beaconCore} />
            <text x="0" y={-(radius + 9)} textAnchor="middle">{market.code} · {market.value.toLocaleString()}</text>
          </g>;
        })}</g>
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
function activateKey(event: KeyboardEvent<SVGElement>, action: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } }
function trapDialogFocus(event: KeyboardEvent<HTMLElement>, dialog: HTMLElement | null) { if (event.key !== 'Tab' || !dialog) return; const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }

type WorldCountryFeature = Feature<Geometry, { name?: string }>;
type WorldShape = { id: string; name: string; code: string | null; path: string; centroid: [number, number] };

const WORLD_CODE_ALIASES: Record<string, string> = {
  'W. Sahara': 'EH', 'United States of America': 'US', 'Dem. Rep. Congo': 'CD', 'Dominican Rep.': 'DO', 'Falkland Is.': 'FK', Greenland: 'GL',
  'Fr. S. Antarctic Lands': 'TF', 'Puerto Rico': 'PR', "Côte d'Ivoire": 'CI', 'Central African Rep.': 'CF', Congo: 'CG', 'Eq. Guinea': 'GQ',
  Palestine: 'PS', Myanmar: 'MM', Turkey: 'TR', 'New Caledonia': 'NC', 'Solomon Is.': 'SB',
  'Bosnia and Herz.': 'BA', Macedonia: 'MK', Kosovo: 'XK', 'Trinidad and Tobago': 'TT', 'S. Sudan': 'SS',
};

const WORLD_TOPOLOGY = worldAtlas as unknown as Topology;
const WORLD_FEATURE_COLLECTION = feature(WORLD_TOPOLOGY, WORLD_TOPOLOGY.objects.countries) as FeatureCollection<Geometry, { name?: string }>;
const WORLD_PROJECTION = geoNaturalEarth1().fitExtent([[18, 20], [702, 320]], WORLD_FEATURE_COLLECTION);
const WORLD_PATH = geoPath(WORLD_PROJECTION);
const WORLD_GRATICULE_PATH = WORLD_PATH(geoGraticule10()) || '';
const WORLD_SHAPES: WorldShape[] = WORLD_FEATURE_COLLECTION.features.map((country, index) => {
  const name = country.properties?.name || `Country ${index + 1}`;
  const projectedCentroid = WORLD_PROJECTION(geoCentroid(country as WorldCountryFeature)) || [360, 170];
  return {
    id: String(country.id || `${name}-${index}`),
    name,
    code: WORLD_CODE_ALIASES[name] || countryCode(name),
    path: WORLD_PATH(country as WorldCountryFeature) || '',
    centroid: projectedCentroid,
  };
});
const WORLD_SHAPE_BY_CODE = new Map(WORLD_SHAPES.filter((shape) => shape.code).map((shape) => [shape.code as string, shape]));
const MICRO_COUNTRY_COORDINATES: Record<string, [number, number]> = {
  AD: [1.52, 42.51], BH: [50.55, 26.07], BN: [114.73, 4.54], HK: [114.17, 22.32], KW: [47.48, 29.31], LI: [9.56, 47.17],
  LU: [6.13, 49.81], MC: [7.42, 43.74], MT: [14.38, 35.94], MV: [73.22, 3.2], PR: [-66.59, 18.22], PS: [35.2, 31.9],
  QA: [51.18, 25.35], SG: [103.82, 1.35], SM: [12.46, 43.94], VA: [12.45, 41.9],
};
function projectMicroCountry(code: string): [number, number] | null {
  const coordinate = MICRO_COUNTRY_COORDINATES[code];
  return coordinate ? WORLD_PROJECTION(coordinate) : null;
}

export default AdvancedAnalytics;
