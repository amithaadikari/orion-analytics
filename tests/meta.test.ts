import { describe, expect, it } from 'vitest';
import { metaSchema } from '@/lib/validation';

describe('Meta event deduplication contract', () => {
  it('requires a shared event ID for browser/server matching', () => {
    const result = metaSchema.safeParse({ event_name: 'Lead', event_id: 'evt_shared_12345678', visitor_id: 'v_12345678' });
    expect(result.success).toBe(true);
  });
});
