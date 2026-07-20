// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import AdminProfileMenu, { identityInitials, readableIdentity } from '@/components/admin-profile-menu';

afterEach(cleanup);

describe('administrator profile identity', () => {
  it('turns an email identifier into a readable dashboard name', () => {
    expect(readableIdentity('orion.admin-team@example.com')).toBe('Orion Admin Team');
  });

  it('uses concise initials and a safe fallback', () => {
    expect(identityInitials('Orion Admin Team')).toBe('OA');
    expect(readableIdentity(null)).toBe('Orion administrator');
    expect(identityInitials('')).toBe('O');
  });

  it('moves focus into the profile dialog and restores it on Escape', async () => {
    render(<AdminProfileMenu admin={{ email: 'owner@orionscalper.com', role: 'admin' }} onNavigate={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Open administrator profile/i });
    fireEvent.click(trigger);
    const firstAction = await screen.findByRole('button', { name: /Profile & security/i });
    await waitFor(() => expect(document.activeElement).toBe(firstAction));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });
});
