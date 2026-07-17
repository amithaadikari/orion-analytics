'use client';

import { useEffect } from 'react';
import { trackFunnelEvent } from '@/lib/client-tracking';
import type { PlanKey } from '@/lib/plans';

export default function RegistrationTracker({ plan }: { plan: PlanKey | null }) {
  useEffect(() => {
    void trackFunnelEvent('RegistrationCompleted', plan, {}, 'orion_registration_completed');
  }, [plan]);

  return null;
}
