// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SoftwareAccessHub from '@/components/software-access-hub';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const activeLicense = {
  id: 'license-basic-mt5',
  license_key: 'ORN-BASIC-5X91Z',
  platform: 'MT5',
  account_number: '20401988',
  plan: 'Basic',
  status: 'Active',
  issued_at: '2026-07-20T00:00:00Z',
  expires_at: '2099-12-31',
};

const currentRelease = {
  id: 'release-mt5',
  version: '5.2',
  title: 'Orion Gold Scalper',
  release_notes: 'Stability and execution updates for the current MT5 build.',
  platform: 'MT5',
  download_url: 'protected',
  released_at: '2026-07-19T12:00:00Z',
};

const baseProps = {
  client: { plan: 'Basic', status: 'Active' },
  licenses: [activeLicense],
  releases: [currentRelease],
  downloadActivity: [],
  recordsAvailable: true,
  activityAvailable: true,
  currentReleaseRequested: false,
  currentReleaseRequestAvailable: true,
};

describe('Software Access Hub', () => {
  it('shows the current license, compatible release, secure action, and truthful request history', () => {
    render(
      <SoftwareAccessHub
        {...baseProps}
        currentReleaseRequested
        downloadActivity={[{ id: 'event-1', release_id: currentRelease.id, version: '5.2', platform: 'MT5', downloaded_at: '2026-07-20T10:30:00Z' }]}
      />,
    );

    expect(screen.getByText('Orion Software Center')).toBeTruthy();
    expect(screen.getByText('Access ready')).toBeTruthy();
    expect(screen.getByText(activeLicense.license_key)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Securely download Orion Gold Scalper, version 5.2/i }).getAttribute('href')).toBe(`/api/downloads/${currentRelease.id}`);
    expect(screen.getByText('Secure delivery requested')).toBeTruthy();
    expect(screen.getByText(/does not confirm that the file finished downloading/i)).toBeTruthy();
    expect(screen.queryByText(/Downloaded successfully/i)).toBeNull();
  });

  it('blocks the download action for a suspended account even when a license exists', () => {
    render(<SoftwareAccessHub {...baseProps} client={{ plan: 'Basic', status: 'Suspended' }} />);

    expect(screen.getByText('Account paused')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Securely download/i })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Contact support/i }).length).toBeGreaterThan(0);
  });

  it('shows renewal attention and does not expose a secure action for an expired license', () => {
    render(<SoftwareAccessHub {...baseProps} licenses={[{ ...activeLicense, expires_at: '2020-01-01' }]} />);

    expect(screen.getByText('Renewal needed')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Securely download/i })).toBeNull();
  });

  it('fails closed when core software records cannot be confirmed', () => {
    render(<SoftwareAccessHub {...baseProps} recordsAvailable={false} />);

    expect(screen.getByText('Status unavailable')).toBeTruthy();
    expect(screen.getByText('License status temporarily unavailable')).toBeTruthy();
    expect(screen.getByText('Release status unavailable')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Securely download/i })).toBeNull();
  });

  it('does not label a missing Basic expiry date as lifetime access', () => {
    render(<SoftwareAccessHub {...baseProps} licenses={[{ ...activeLicense, expires_at: null }]} />);

    expect(screen.getByText('Expiry date not set')).toBeTruthy();
    expect(screen.queryByText('Lifetime access')).toBeNull();
  });

  it('keeps release details and the download action on the same downloadable build', () => {
    const announcedRelease = { ...currentRelease, id: 'release-next', version: '6.0', title: 'Orion Next Preview', download_url: null, released_at: '2026-07-20T12:00:00Z' };
    render(<SoftwareAccessHub {...baseProps} releases={[announcedRelease, currentRelease]} />);

    expect(screen.getByText('Orion Gold Scalper')).toBeTruthy();
    expect(screen.queryByText('Orion Next Preview')).toBeNull();
    expect(screen.getByRole('link', { name: /Securely download Orion Gold Scalper, version 5.2/i }).getAttribute('href')).toBe(`/api/downloads/${currentRelease.id}`);
  });

  it('shows a secure action for each actively licensed platform', () => {
    const mt4License = { ...activeLicense, id: 'license-basic-mt4', license_key: 'ORN-BASIC-MT4', platform: 'MT4', account_number: '4001002' };
    const mt4Release = { ...currentRelease, id: 'release-mt4', version: '4.8', title: 'Orion MT4 Edition', platform: 'MT4' };
    render(<SoftwareAccessHub {...baseProps} licenses={[activeLicense, mt4License]} releases={[currentRelease, mt4Release]} />);

    expect(screen.getByRole('link', { name: /Securely download Orion Gold Scalper, version 5.2/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Securely download Orion MT4 Edition, version 4.8, for MT4/i }).getAttribute('href')).toBe('/api/downloads/release-mt4');
    expect(screen.getByText(/MQL4 or MQL5 → Experts/i)).toBeTruthy();
  });

  it('does not show remaining access for a license explicitly marked expired', () => {
    render(<SoftwareAccessHub {...baseProps} licenses={[{ ...activeLicense, status: 'Expired', expires_at: '2099-12-31' }]} />);

    expect(screen.getByText('License marked expired')).toBeTruthy();
    expect(screen.queryByText(/days remaining/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Securely download/i })).toBeNull();
  });

  it('keeps an old-plan license out of the main current-plan access card', () => {
    render(<SoftwareAccessHub {...baseProps} licenses={[{ ...activeLicense, id: 'premium-license', plan: 'Premium' }]} />);

    expect(screen.getByText('No license assigned yet')).toBeTruthy();
    expect(screen.getByText('License pending')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Securely download/i })).toBeNull();
  });

  it('labels an expired client account as an attention state', () => {
    render(<SoftwareAccessHub {...baseProps} client={{ plan: 'Basic', status: 'Expired' }} />);

    expect(screen.getByText('Account expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Securely download/i })).toBeNull();
  });

  it('does not infer a first download when recent activity is unavailable', () => {
    render(<SoftwareAccessHub {...baseProps} activityAvailable={false} />);

    expect(screen.getByText('Available for secure download')).toBeTruthy();
    expect(screen.queryByText('Ready for first download')).toBeNull();
  });

  it('copies the visible license key with clear feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<SoftwareAccessHub {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: `Copy license key ${activeLicense.license_key}` }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(activeLicense.license_key));
    expect(screen.getByText('Copied')).toBeTruthy();
  });
});
