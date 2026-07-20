// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PasswordField from '@/components/password-field';
import { normalizeAuthTheme } from '@/lib/auth-theme';
import { passwordStrength } from '@/lib/password-strength';

function PasswordHarness() {
  const [password, setPassword] = useState('StrongPass1!');
  const [confirmation, setConfirmation] = useState('');

  return (
    <>
      <PasswordField
        id="test-password"
        label="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        minLength={10}
        showStrength
      />
      <PasswordField
        id="test-confirmation"
        label="Confirm password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="new-password"
        minLength={10}
        matchValue={password}
      />
    </>
  );
}

describe('authentication experience', () => {
  it('accepts the blue theme and safely falls back to Royal Gold', () => {
    expect(normalizeAuthTheme('blue')).toBe('blue');
    expect(normalizeAuthTheme('gold')).toBe('gold');
    expect(normalizeAuthTheme('unknown')).toBe('gold');
    expect(normalizeAuthTheme()).toBe('gold');
  });

  it('provides useful, advisory password strength feedback', () => {
    expect(passwordStrength('')).toMatchObject({ score: 0, label: 'Weak', percent: 0, meetsLength: false });
    expect(passwordStrength('StrongPass1!')).toMatchObject({ score: 4, label: 'Strong', percent: 100, meetsLength: true });
  });

  it('reveals each password independently without changing its value or autocomplete', () => {
    render(<PasswordHarness />);

    const password = screen.getByLabelText('Password') as HTMLInputElement;
    const confirmation = screen.getByLabelText('Confirm password') as HTMLInputElement;
    const passwordToggle = screen.getByRole('button', { name: 'Show password' });

    expect(password.type).toBe('password');
    expect(password.value).toBe('StrongPass1!');
    expect(password.autocomplete).toBe('new-password');
    expect(password.getAttribute('autocapitalize')).toBe('none');
    expect(password.getAttribute('autocorrect')).toBe('off');
    expect(password.getAttribute('spellcheck')).toBe('false');
    expect(confirmation.type).toBe('password');

    fireEvent.click(passwordToggle);

    expect(password.type).toBe('text');
    expect(password.value).toBe('StrongPass1!');
    expect(passwordToggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBe(passwordToggle);
    expect(confirmation.type).toBe('password');
  });

  it('announces confirmation feedback only after the user starts typing', () => {
    render(<PasswordHarness />);

    const confirmation = screen.getByLabelText('Confirm password') as HTMLInputElement;
    expect(confirmation.getAttribute('aria-describedby')).toBeNull();

    fireEvent.change(confirmation, { target: { value: 'StrongPass1!' } });

    expect(confirmation.getAttribute('aria-describedby')).toBe('test-confirmation-password-hint');
    expect(screen.getByText('Passwords match')).toBeTruthy();
  });
});
