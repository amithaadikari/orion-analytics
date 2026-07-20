'use client';

import React, { useState, type ChangeEventHandler } from 'react';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { passwordStrength } from '@/lib/password-strength';

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete: 'current-password' | 'new-password';
  minLength: number;
  required?: boolean;
  showStrength?: boolean;
  matchValue?: string;
};

export default function PasswordField({ id, label, value, onChange, autoComplete, minLength, required = true, showStrength = false, matchValue }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const hintId = `${id}-password-hint`;
  const isConfirmation = typeof matchValue === 'string';
  const matches = isConfirmation && Boolean(value) && value === matchValue;
  const hasHint = showStrength || (isConfirmation && Boolean(value));

  return (
    <div className="auth-field auth-password-field">
      <label className="auth-field-label" htmlFor={id}>{label}</label>
      <span className="auth-input-shell auth-password-shell">
        <span className="auth-input-icon" aria-hidden="true"><LockKeyhole size={14} /></span>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={minLength}
          required={required}
          value={value}
          aria-describedby={hasHint ? hintId : undefined}
          onChange={onChange}
        />
        <button type="button" className="auth-password-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-controls={id} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
          <span>{visible ? 'Hide' : 'Show'}</span>
        </button>
      </span>

      {showStrength && (
        <div className="auth-password-strength" id={hintId} data-score={strength.score}>
          <span><i style={{ width: `${strength.percent}%` }} /></span>
          <small><b>{value ? strength.label : 'Password strength'}</b><em>{strength.meetsLength ? '10+ characters met' : 'Use at least 10 characters'}</em></small>
        </div>
      )}

      {isConfirmation && value && (
        <p className={`auth-password-match ${matches ? 'is-match' : 'is-pending'}`} id={hintId} aria-live="polite">
          <span aria-hidden="true">{matches ? '✓' : '•'}</span>{matches ? 'Passwords match' : 'Passwords do not match yet'}
        </p>
      )}
    </div>
  );
}
