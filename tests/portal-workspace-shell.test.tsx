// @vitest-environment jsdom

import React, { type ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/portal-notifications-provider', () => ({
  PortalNotificationsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/portal-notification-bell', () => ({
  default: () => <button type="button">Notifications</button>,
}));
vi.mock('@/components/client-avatar', () => ({
  default: () => <span>Client avatar</span>,
}));
vi.mock('@/components/logout-button', () => ({
  default: () => <button type="button">Log out</button>,
}));
vi.mock('@/components/orion-brand', () => ({
  default: () => <span>Orion</span>,
}));

import PortalWorkspaceShell from '@/components/portal-workspace-shell';

beforeEach(() => {
  vi.stubGlobal('React', React);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('portal workspace navigation', () => {
  it('marks Performance as the active page and links directly to its dedicated route', () => {
    render(
      <PortalWorkspaceShell
        currentView="performance"
        clientName="Ishanka Adhikari"
        clientDisplayName="Ishanka"
        clientAvatarKey="forex-gold"
        clientPlan="Premium"
        clientStatus="Active"
        initialTheme="gold"
      >
        <section>Performance workspace content</section>
      </PortalWorkspaceShell>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Portal navigation' });
    const performance = within(navigation).getByRole('link', { name: 'Performance' });
    expect(performance.getAttribute('href')).toBe('/portal/performance');
    expect(performance.getAttribute('aria-current')).toBe('page');
    expect(performance.classList.contains('is-active')).toBe(true);

    const overview = within(navigation).getByRole('link', { name: 'Overview' });
    expect(overview.getAttribute('href')).toBe('/portal');
    expect(overview.hasAttribute('aria-current')).toBe(false);
    expect(screen.getByText('Performance workspace content')).toBeTruthy();
  });
});
