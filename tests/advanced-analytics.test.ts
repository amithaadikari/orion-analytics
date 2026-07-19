import { describe, expect, it } from 'vitest';
import { buildCountryDeviceHeatmap, buildDailyConversionHeatmap } from '@/lib/advanced-analytics';

describe('advanced analytics aggregations', () => {
  it('builds country by device counts without mixing unknown values', () => {
    expect(buildCountryDeviceHeatmap([
      { visitor_id: 'v_12345678', country: 'Sri Lanka', device_type: 'Mobile' },
      { visitor_id: 'v_87654321', country: 'Sri Lanka', device_type: 'Mobile' },
      { visitor_id: 'v_unknown1', country: null, device_type: null },
    ])).toEqual([
      { country: 'Sri Lanka', device: 'Mobile', value: 2 },
      { country: 'Unknown', device: 'Unknown', value: 1 },
    ]);
  });

  it('deduplicates visitors within each daily conversion stage', () => {
    const result = buildDailyConversionHeatmap(
      [{ visitor_id: 'v_12345678', last_seen: '2026-07-18T12:00:00Z' }],
      [
        { visitor_id: 'v_12345678', event_name: 'PlanSelected', created_at: '2026-07-18T12:01:00Z' },
        { visitor_id: 'v_12345678', event_name: 'PlanSelected', created_at: '2026-07-18T12:02:00Z' },
        { visitor_id: 'v_87654321', event_name: 'PlanSelected', created_at: '2026-07-18T12:03:00Z' },
      ],
    );
    expect(result).toContainEqual({ date: '2026-07-18', stage: 'Visitors', value: 1 });
    expect(result).toContainEqual({ date: '2026-07-18', stage: 'PlanSelected', value: 2 });
  });
});
