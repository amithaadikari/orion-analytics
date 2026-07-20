// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: () => ({ auth: { signOut: mocks.signOut } }) }));

import LogoutButton from '@/components/logout-button';

describe('portal logout', () => {
  it('ends only the current browser session', async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    render(<LogoutButton redirectTo="/client-login" />);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(mocks.replace).toHaveBeenCalledWith('/client-login');
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
