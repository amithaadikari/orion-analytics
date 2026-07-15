import { describe, expect, it } from 'vitest';
import { eventSchema, visitorSchema } from '@/lib/validation';

describe('tracking validation', () => {
  it('accepts a valid anonymous visitor', () => {
    expect(visitorSchema.safeParse({ visitor_id: 'v_12345678', landing_page: 'https://orion.example' }).success).toBe(true);
  });
  it('rejects missing visitor IDs and unknown event names', () => {
    expect(visitorSchema.safeParse({}).success).toBe(false);
    expect(eventSchema.safeParse({ visitor_id: 'v_12345678', event_id: 'evt_12345678', event_name: 'Hack' }).success).toBe(false);
  });
});
