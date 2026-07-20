// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminActionCenter from '@/components/admin-action-center';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('administrator action center', () => {
  it('shows support-only attention truthfully and opens the support desk', async () => {
    const alerts = { registrations: 0, payments: 0, licenses: 0, support: 5, suspended: 0 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      counts: { ...alerts, suspended: 0, total: 5 },
      alerts,
      queues: { registrations: [], payments: [], licenses: [], suspended: [] },
    }), { status: 200 })));
    const onNavigate = vi.fn();
    const onAlertCountsChange = vi.fn();

    render(<AdminActionCenter onNavigate={onNavigate} onAlertCountsChange={onAlertCountsChange} />);

    expect(await screen.findByText('Support conversations need attention')).toBeTruthy();
    expect(screen.queryByText('All review queues are clear')).toBeNull();
    expect(screen.getByLabelText('5 support conversations')).toBeTruthy();
    expect(onAlertCountsChange).toHaveBeenCalledWith(alerts);
    fireEvent.click(screen.getByRole('button', { name: /Open support desk/i }));
    expect(onNavigate).toHaveBeenCalledWith('support', 'Open');
  });
});
