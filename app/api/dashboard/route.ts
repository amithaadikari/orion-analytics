import { requireAdminApi } from '@/lib/auth';
import { EVENT_LABELS, rangeEnd, rangeStart } from '@/lib/utils';
import { jsonError } from '@/lib/security';

type Visitor = Record<string, any>;
type Event = Record<string, any>;

export async function GET(request: Request) {
  const { supabase, user, admin } = await requireAdminApi();
  if (!user || !admin) return jsonError('Unauthorized', 401);
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '7d';
  const countryFilter = url.searchParams.get('country');
  const campaignFilter = url.searchParams.get('campaign');
  const deviceFilter = url.searchParams.get('device');
  const eventFilter = url.searchParams.get('event');
  const start = url.searchParams.get('start') ? new Date(url.searchParams.get('start') as string) : rangeStart(range);
  const end = url.searchParams.get('end') ? new Date(url.searchParams.get('end') as string) : rangeEnd(range);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return jsonError('Invalid date range');
  const [visitorsResult, eventsResult] = await Promise.all([
    supabase.from('visitors').select('*').gte('last_seen', start.toISOString()).lte('last_seen', end.toISOString()).order('last_seen', { ascending: false }).limit(10000),
    supabase.from('events').select('*').gte('created_at', start.toISOString()).lte('created_at', end.toISOString()).order('created_at', { ascending: false }).limit(20000)
  ]);
  if (visitorsResult.error || eventsResult.error) return jsonError('Unable to load analytics', 500);
  const visitors = ((visitorsResult.data || []) as Visitor[]).filter((row) =>
    (!countryFilter || countryFilter === 'all' || (row.country || 'Unknown') === countryFilter) &&
    (!campaignFilter || campaignFilter === 'all' || (row.utm_campaign || 'Organic') === campaignFilter) &&
    (!deviceFilter || deviceFilter === 'all' || (row.device_type || 'Unknown') === deviceFilter)
  );
  const events = ((eventsResult.data || []) as Event[]).filter((row) => !eventFilter || eventFilter === 'all' || row.event_name === eventFilter);
  const telegramIds = new Set(events.filter((event) => event.event_name === 'TelegramClick').map((event) => event.visitor_id));
  const byCountry = countBy(visitors, (row) => row.country || 'Unknown');
  const byCampaign = countBy(visitors, (row) => row.utm_campaign || 'Organic');
  const byDevice = countBy(visitors, (row) => row.device_type || 'Unknown');
  const byDay = dailySeries(visitors, events, start, end);
  const eventCounts = countBy(events, (row) => row.event_name);
  const eventCountMap = Object.fromEntries(eventCounts.map(({ name, value }) => [name, value]));
  const periodMs = Math.max(86_400_000, end.getTime() - start.getTime());
  const previousStart = new Date(start.getTime() - periodMs);
  const previousEnd = new Date(start.getTime() - 1);
  const [{ data: previousVisitors }, { data: previousEvents }] = await Promise.all([
    supabase.from('visitors').select('visitor_id').gte('last_seen', previousStart.toISOString()).lte('last_seen', previousEnd.toISOString()).limit(10000),
    supabase.from('events').select('event_name').gte('created_at', previousStart.toISOString()).lte('created_at', previousEnd.toISOString()).limit(20000)
  ]);
  const { data: metaEvents } = await supabase.from('meta_events').select('event_id,event_name,status,sent_at').gte('sent_at', start.toISOString()).lte('sent_at', end.toISOString()).order('sent_at', { ascending: false }).limit(20000);
  const previousClicks = (previousEvents || []).filter((row) => row.event_name === 'TelegramClick').length;
  const snapshot = {
    range: { start: start.toISOString(), end: end.toISOString() },
    metrics: {
      visitorsToday: visitors.filter((row) => new Date(row.last_seen).toDateString() === new Date().toDateString()).length,
      uniqueVisitors: new Set(visitors.map((row) => row.visitor_id)).size,
      telegramClicks: eventCountMap.TelegramClick || 0,
      conversionRate: visitors.length ? Number(((telegramIds.size / visitors.length) * 100).toFixed(1)) : 0,
      returningVisitors: visitors.filter((row) => row.first_seen && new Date(row.first_seen).getTime() < new Date(row.last_seen).getTime() - 60_000).length,
      topCountry: byCountry[0]?.name || '—', topCampaign: byCampaign[0]?.name || 'Organic'
    },
    comparison: { visitors: percentChange(visitors.length, (previousVisitors || []).length), telegramClicks: percentChange(eventCountMap.TelegramClick || 0, previousClicks) },
    meta: { browserEvents: events.filter((event) => ['PageView', 'ViewContent', 'Lead', 'SupportClick', 'Purchase'].includes(event.event_name)).length, serverEvents: (metaEvents || []).length, successful: (metaEvents || []).filter((event) => event.status === 'sent').length, failed: (metaEvents || []).filter((event) => event.status === 'failed').length, lastSync: metaEvents?.[0]?.sent_at || null, eventIds: (metaEvents || []).slice(0, 10).map((event) => event.event_id) },
    funnel: { visitors: visitors.length, viewContent: eventCountMap.ViewContent || 0, telegramClicks: eventCountMap.TelegramClick || 0 },
    charts: { byDay, byCountry: byCountry.slice(0, 8), byCampaign: byCampaign.slice(0, 8), byDevice },
    events: events.slice(0, 120).map((event) => ({ ...event, label: EVENT_LABELS[event.event_name] || event.event_name })),
    visitors: visitors.slice(0, 120).map((visitor) => ({ ...visitor, telegram_clicked: telegramIds.has(visitor.visitor_id) }))
  };
  return Response.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } });
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function countBy(rows: Record<string, any>[], get: (row: Record<string, any>) => string) {
  const counts = new Map<string, number>();
  rows.forEach((row) => { const key = get(row); counts.set(key, (counts.get(key) || 0) + 1); });
  return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function dailySeries(visitors: Visitor[], events: Event[], start: Date, end: Date) {
  const dates = new Map<string, { date: string; visitors: number; clicks: number }>();
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) { const key = cursor.toISOString().slice(0, 10); dates.set(key, { date: key.slice(5), visitors: 0, clicks: 0 }); }
  visitors.forEach((row) => { const key = new Date(row.last_seen).toISOString().slice(0, 10); if (dates.has(key)) dates.get(key)!.visitors += 1; });
  events.filter((event) => event.event_name === 'TelegramClick').forEach((row) => { const key = new Date(row.created_at).toISOString().slice(0, 10); if (dates.has(key)) dates.get(key)!.clicks += 1; });
  return [...dates.values()];
}
