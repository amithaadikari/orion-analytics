'use client';

import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { trackFunnelEvent } from '@/lib/client-tracking';
import type { PlanKey } from '@/lib/plans';

type Props = {
  plan: PlanKey;
};

export default function CheckoutActions({ plan }: Props) {
  useEffect(() => {
    const syncIntent = async () => {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.updateUser({ data: { selected_plan: plan } });
    };

    void syncIntent();
    void trackFunnelEvent('PlanSelected', plan, {}, `orion_plan_selected_${plan}`);
    void trackFunnelEvent('CheckoutStarted', plan, {}, `orion_checkout_started_${plan}`);
  }, [plan]);

  return null;
}
