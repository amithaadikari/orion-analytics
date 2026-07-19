export const CONVERSION_STAGES = [
  'Visitors',
  'ViewContent',
  'PlanSelected',
  'RegistrationStarted',
  'RegistrationCompleted',
  'CheckoutStarted',
  'TelegramClick',
] as const;

export type ConversionStage = (typeof CONVERSION_STAGES)[number];

type VisitorHeatmapRow = {
  visitor_id?: string | null;
  country?: string | null;
  device_type?: string | null;
  last_seen?: string | null;
};

type EventHeatmapRow = {
  visitor_id?: string | null;
  event_name?: string | null;
  created_at?: string | null;
};

export type CountryDeviceCell = { country: string; device: string; value: number };
export type DailyConversionCell = { date: string; stage: ConversionStage; value: number };

function dateKey(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function buildCountryDeviceHeatmap(rows: VisitorHeatmapRow[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const country = row.country?.trim() || 'Unknown';
    const device = row.device_type?.trim() || 'Unknown';
    const key = `${country}\u0000${device}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([key, value]) => {
      const [country, device] = key.split('\u0000');
      return { country, device, value } satisfies CountryDeviceCell;
    })
    .sort((left, right) => right.value - left.value || left.country.localeCompare(right.country));
}

export function buildDailyConversionHeatmap(visitors: VisitorHeatmapRow[], events: EventHeatmapRow[]) {
  const unique = new Map<string, Set<string>>();
  const add = (date: string | null, stage: ConversionStage, visitorId?: string | null) => {
    if (!date || !visitorId) return;
    const key = `${date}\u0000${stage}`;
    const ids = unique.get(key) || new Set<string>();
    ids.add(visitorId);
    unique.set(key, ids);
  };

  visitors.forEach((row) => add(dateKey(row.last_seen), 'Visitors', row.visitor_id));
  events.forEach((row) => {
    if (!CONVERSION_STAGES.includes(row.event_name as ConversionStage) || row.event_name === 'Visitors') return;
    add(dateKey(row.created_at), row.event_name as ConversionStage, row.visitor_id);
  });

  return [...unique.entries()]
    .map(([key, visitorIds]) => {
      const [date, stage] = key.split('\u0000') as [string, ConversionStage];
      return { date, stage, value: visitorIds.size } satisfies DailyConversionCell;
    })
    .sort((left, right) => left.date.localeCompare(right.date) || CONVERSION_STAGES.indexOf(left.stage) - CONVERSION_STAGES.indexOf(right.stage));
}
