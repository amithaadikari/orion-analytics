import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('components/license-runtime-center.module.css', 'utf8');

describe('license runtime action contrast', () => {
  it('uses defined fallback colors for the primary Demo and device actions', () => {
    const primaryButton = css.match(/\.primaryButton\s*\{([^}]+)\}/)?.[1] || '';
    expect(primaryButton).toContain('background-color: var(--portal-secondary, #42d9ff)');
    expect(primaryButton).toContain('var(--portal-secondary-bright, #7ce8ff)');
    expect(css).not.toContain('var(--portal-secondary-deep)');
  });

  it('keeps disabled action labels readable without opacity dimming', () => {
    const disabledActions = css.match(/\.primaryButton:disabled,([\s\S]*?)\n\}/)?.[1] || '';
    expect(disabledActions).toContain('color: #9aa1ab');
    expect(disabledActions).toContain('opacity: 1');
  });
});
