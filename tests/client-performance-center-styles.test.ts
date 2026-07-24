import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('components/client-performance-center.module.css', 'utf8');

describe('client Performance Center calendar readability', () => {
  it('collapses unused tablet month tracks before daily P&L values become clipped', () => {
    const tabletStart = css.indexOf('@media (max-width: 1280px)');
    const tabletEnd = css.indexOf('@media (max-width: 940px)');
    const tabletRules = css.slice(tabletStart, tabletEnd);

    expect(tabletStart).toBeGreaterThanOrEqual(0);
    expect(tabletEnd).toBeGreaterThan(tabletStart);
    expect(tabletRules).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));',
    );
    expect(tabletRules).not.toContain(
      'grid-template-columns: repeat(2, minmax(245px, 1fr));',
    );
  });
});
