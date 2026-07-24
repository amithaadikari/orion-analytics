import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('components/client-performance-center.module.css', 'utf8');

describe('client Performance Center calendar readability', () => {
  it('collapses unused month tracks at every viewport width', () => {
    const monthListStart = css.indexOf('.monthList {');
    const monthListEnd = css.indexOf('}', monthListStart);
    const baseRules = css.slice(monthListStart, monthListEnd);
    const tabletStart = css.indexOf('@media (max-width: 1280px)');
    const tabletEnd = css.indexOf('@media (max-width: 940px)');
    const tabletRules = css.slice(tabletStart, tabletEnd);

    expect(monthListStart).toBeGreaterThanOrEqual(0);
    expect(baseRules).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr));',
    );
    expect(baseRules).not.toContain('repeat(3');
    expect(tabletStart).toBeGreaterThanOrEqual(0);
    expect(tabletEnd).toBeGreaterThan(tabletStart);
    expect(tabletRules).not.toContain('.monthList');
  });

  it('never hides or ellipsizes an exact financial value', () => {
    const valueStart = css.indexOf('.calendarDay strong {');
    const valueEnd = css.indexOf('}', valueStart);
    const valueRules = css.slice(valueStart, valueEnd);

    expect(valueStart).toBeGreaterThanOrEqual(0);
    expect(valueRules).toContain('font: 700 11px/1.25');
    expect(valueRules).toContain('overflow: visible;');
    expect(valueRules).toContain('overflow-wrap: anywhere;');
    expect(valueRules).toContain('text-overflow: clip;');
    expect(valueRules).toContain('white-space: normal;');
    expect(valueRules).not.toContain('overflow: hidden;');
    expect(valueRules).not.toContain('text-overflow: ellipsis;');
  });

  it('keeps narrow calendars readable inside one keyboard-focusable scroller', () => {
    const mobileStart = css.indexOf('@media (max-width: 700px)');
    const mobileEnd = css.indexOf('@media (max-width: 460px)');
    const mobileRules = css.slice(mobileStart, mobileEnd);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileEnd).toBeGreaterThan(mobileStart);
    expect(mobileRules).toContain('.calendarViewport {');
    expect(mobileRules).toContain('overflow-x: auto;');
    expect(mobileRules).toContain('min-width: 620px;');
  });
});
