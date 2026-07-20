// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ClientPortalInsights from '@/components/client-portal-insights';

afterEach(cleanup);

const baseProps = {
  licenses: [],
  payments: [],
  releases: [],
  downloads: [],
  recordsAvailable: true,
  downloadHistoryAvailable: true,
  planSelectionPath: '/checkout',
  showHeading: false,
};

describe('client activation journey', () => {
  it('guides a free client to choose a plan and marks payment as the current step', () => {
    render(<ClientPortalInsights {...baseProps} client={{ plan: 'Free', status: 'Pending' }} />);

    expect(screen.getByText('Choose a plan')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review Orion plans/i }).getAttribute('href')).toBe('/checkout');
    expect(screen.getByText('Payment verified').closest('li')?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('1 of 5')).toBeTruthy();
  });

  it('uses the newest matching payment status rather than an older paid record', () => {
    render(
      <ClientPortalInsights
        {...baseProps}
        client={{ plan: 'Basic', status: 'Pending' }}
        payments={[
          { id: 'new', plan: 'Basic', status: 'Pending', created_at: '2026-07-20T10:00:00Z' },
          { id: 'old', plan: 'Basic', status: 'Paid', created_at: '2026-07-19T10:00:00Z' },
        ]}
      />,
    );

    expect(screen.getByText('Verification pending')).toBeTruthy();
    expect(screen.getByText('Your payment is awaiting Orion review.')).toBeTruthy();
  });

  it('does not verify the current plan from a paid record belonging to another plan', () => {
    render(
      <ClientPortalInsights
        {...baseProps}
        client={{ plan: 'Premium', status: 'Pending' }}
        payments={[{ id: 'basic-payment', plan: 'Basic', status: 'Paid' }]}
      />,
    );

    expect(screen.getByText('Payment required')).toBeTruthy();
    expect(screen.getByText('No verified payment is linked yet.')).toBeTruthy();
  });

  it('shows a complete five-step record and activation action after a licensed download', () => {
    render(
      <ClientPortalInsights
        {...baseProps}
        client={{ plan: 'Basic', status: 'Active' }}
        payments={[{ id: 'payment', plan: 'Basic', status: 'Paid' }]}
        licenses={[{ id: 'license', plan: 'Basic', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' }]}
        releases={[{ id: 'release', version: 'v5.1', title: 'Orion V5', platform: 'MT5', download_url: 'https://downloads.example.com/orion.ex5' }]}
        downloads={[{ id: 'download', release_id: 'release', version: 'v5.1', downloaded_at: '2026-07-20T10:00:00Z' }]}
      />,
    );

    expect(screen.getByText('5 of 5')).toBeTruthy();
    expect(screen.getByText('Download requested')).toBeTruthy();
    expect(screen.getByText('Continue setup in MetaTrader')).toBeTruthy();
  });

  it('keeps a newer release ready when only an older release request was recorded', () => {
    render(
      <ClientPortalInsights
        {...baseProps}
        client={{ plan: 'Basic', status: 'Active' }}
        payments={[{ id: 'payment', plan: 'Basic', status: 'Paid' }]}
        licenses={[{ id: 'license', plan: 'Basic', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' }]}
        releases={[{ id: 'new-release', version: 'v5.2', title: 'Orion V5', platform: 'MT5', download_url: 'https://downloads.example.com/orion.ex5' }]}
        downloads={[{ id: 'old-download', release_id: 'old-release', version: 'v5.1', downloaded_at: '2026-07-19T10:00:00Z' }]}
      />,
    );

    expect(screen.getByText('Ready to download')).toBeTruthy();
    expect(screen.getByText('v5.2 is ready for secure download.')).toBeTruthy();
    expect(screen.getByText('4 of 5')).toBeTruthy();
  });

  it('uses platform-neutral setup guidance for a recorded MT4 release request', () => {
    render(
      <ClientPortalInsights
        {...baseProps}
        client={{ plan: 'Basic', status: 'Active' }}
        payments={[{ id: 'payment', plan: 'Basic', status: 'Paid' }]}
        licenses={[{ id: 'license', plan: 'Basic', platform: 'MT4', status: 'Active', expires_at: '2099-12-31' }]}
        releases={[{ id: 'release-mt4', version: 'v5.1', title: 'Orion V5', platform: 'MT4', download_url: 'https://downloads.example.com/orion.ex4' }]}
        downloads={[{ id: 'download-mt4', release_id: 'release-mt4', version: 'v5.1', downloaded_at: '2026-07-20T10:00:00Z' }]}
      />,
    );

    expect(screen.getByText('Continue setup in MetaTrader')).toBeTruthy();
    expect(screen.queryByText(/inside MT5/i)).toBeNull();
  });

  it('prioritizes a suspended account over ordinary plan selection', () => {
    render(<ClientPortalInsights {...baseProps} client={{ plan: 'Free', status: 'Suspended' }} />);

    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Restore account access')).toBeTruthy();
    expect(screen.getByText('Access approved').closest('li')?.getAttribute('aria-current')).toBe('step');
  });

  it('shows one neutral unavailable state when secure records cannot be confirmed', () => {
    render(<ClientPortalInsights {...baseProps} recordsAvailable={false} client={{ plan: 'Basic', status: 'Active' }} />);

    expect(screen.getByText('Status temporarily unavailable')).toBeTruthy();
    expect(screen.getByText('Refresh your portal')).toBeTruthy();
    expect(screen.queryByText('Payment required')).toBeNull();
  });

  it('keeps download history waiting when no compatible release exists yet', () => {
    render(
      <ClientPortalInsights
        {...baseProps}
        client={{ plan: 'Basic', status: 'Active' }}
        payments={[{ id: 'payment', plan: 'Basic', status: 'Paid' }]}
        licenses={[{ id: 'license', plan: 'Basic', platform: 'MT5', status: 'Active', expires_at: '2099-12-31' }]}
        downloadHistoryAvailable={false}
      />,
    );

    expect(screen.getByText('Release pending')).toBeTruthy();
    expect(screen.getByText('No compatible release yet')).toBeTruthy();
    expect(screen.queryByText('Download activity is temporarily unavailable.')).toBeNull();
  });
});
