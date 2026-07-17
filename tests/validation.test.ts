import { describe, expect, it } from 'vitest';
import { eventSchema, funnelEventSchema, visitorSchema } from '@/lib/validation';

describe('tracking validation', () => {
  it('accepts a valid anonymous visitor', () => {
    expect(visitorSchema.safeParse({ visitor_id: 'v_12345678', landing_page: 'https://orion.example' }).success).toBe(true);
  });
  it('rejects missing visitor IDs and unknown event names', () => {
    expect(visitorSchema.safeParse({}).success).toBe(false);
    expect(eventSchema.safeParse({ visitor_id: 'v_12345678', event_id: 'evt_12345678', event_name: 'Hack' }).success).toBe(false);
  });

  it('accepts only the defined purchase-funnel events and plans', () => {
    const base = { visitor_id: 'v_12345678', session_id: 's_12345678', event_id: 'evt_12345678' };
    expect(funnelEventSchema.safeParse({ ...base, event_name: 'PlanSelected', plan: 'premium' }).success).toBe(true);
    expect(funnelEventSchema.safeParse({ ...base, event_name: 'CheckoutStarted', plan: 'lifetime' }).success).toBe(true);
    expect(funnelEventSchema.safeParse({ ...base, event_name: 'PaymentSubmitted', plan: 'premium' }).success).toBe(false);
    expect(funnelEventSchema.safeParse({ ...base, event_name: 'PlanSelected', plan: 'enterprise' }).success).toBe(false);
  });
});
