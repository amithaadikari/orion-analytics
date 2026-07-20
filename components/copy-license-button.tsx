'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import styles from './software-access-hub.module.css';

type CopyLicenseButtonProps = {
  licenseKey: string;
  compact?: boolean;
};

export default function CopyLicenseButton({ licenseKey, compact = false }: CopyLicenseButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copyLicense() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText(licenseKey);
      setState('copied');
    } catch {
      setState('error');
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState('idle'), 2200);
  }

  const label = state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : compact ? 'Copy' : 'Copy key';

  return (
    <button
      className={`${styles.copyButton} ${compact ? styles.copyButtonCompact : ''}`}
      type="button"
      onClick={copyLicense}
      aria-label={`Copy license key ${licenseKey}`}
      data-state={state}
    >
      {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
