import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePeriod } from '@/components/sales-command-center';

describe('sales reporting periods', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the current UTC day for Today and compares it with Yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));

    expect(resolvePeriod('today', '', '')).toMatchObject({
      startKey: '2026-07-20',
      endKey: '2026-07-20',
      previousStartKey: '2026-07-19',
      previousEndKey: '2026-07-19',
      days: 1,
      label: 'Today',
      previousLabel: 'Yesterday',
    });
  });

  it('uses the prior UTC day for Yesterday and compares it with the day before', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));

    expect(resolvePeriod('yesterday', '', '')).toMatchObject({
      startKey: '2026-07-19',
      endKey: '2026-07-19',
      previousStartKey: '2026-07-18',
      previousEndKey: '2026-07-18',
      days: 1,
      label: 'Yesterday',
      previousLabel: 'Day before',
    });
  });
});
