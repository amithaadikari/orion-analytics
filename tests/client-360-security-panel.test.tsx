// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Client360Panel from '@/components/client-360-panel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const basePayload = {
  client: { full_name: 'Client One', email: 'client@example.com', country: 'LK', notes: null },
  profile: {
    nickname: '', bio: '', avatarKey: 'robot-core', telegramUsername: '', phoneNumber: '', brokers: [], tradingPairs: [],
    updatedAt: null, linked: true, available: true, visible: true,
  },
  health: { score: 92, label: 'Healthy', tone: 'green', reasons: ['No operational issues detected'] },
  timeline: [], reminders: [], communications: [],
};

describe('Client 360 portal security summary', () => {
  it('shows only sanitized current authentication facts for administrators', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...basePayload,
      security: {
        visible: true, portalState: 'linked', mfaStatus: 'enabled', signInAvailable: true,
        lastSignInAt: '2026-07-20T12:00:00.000Z', activityAvailable: true,
        lastActivity: { id: 'event-1', type: 'session_started', title: 'New sign-in recorded', createdAt: '2026-07-20T12:00:00.000Z', device: 'Desktop · Chrome · macOS · LK' },
      },
    }), { status: 200 })));

    render(<Client360Panel clientId="11111111-1111-4111-8111-111111111111" canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Security' }));
    expect(screen.getByRole('region', { name: 'Security' })).toBeTruthy();
    expect(screen.getByText('Portal security status')).toBeTruthy();
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0);
    expect(screen.getByText('New sign-in recorded')).toBeTruthy();
    expect(document.body.textContent).not.toContain('session_id');
    expect(document.body.textContent).not.toContain('ip_hash');
  });

  it('does not expose the security section to an analytics-only viewer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...basePayload,
      profile: { ...basePayload.profile, visible: false },
      security: { visible: false },
    }), { status: 200 })));

    render(<Client360Panel clientId="11111111-1111-4111-8111-111111111111" canWrite={false} />);
    await screen.findByText('No timeline records yet.');
    expect(screen.queryByRole('button', { name: 'Security' })).toBeNull();
    expect(screen.queryByText('Portal security status')).toBeNull();
  });
});
