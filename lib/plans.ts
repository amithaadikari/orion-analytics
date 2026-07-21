export const planKeys = ['basic', 'premium', 'lifetime'] as const;

export type PlanKey = (typeof planKeys)[number];

export type PlanDetails = {
  key: PlanKey;
  name: string;
  price: number;
  priceLabel: string;
  license: string;
  description: string;
  highlights: readonly string[];
};

export const plans: Record<PlanKey, PlanDetails> = {
  basic: {
    key: 'basic',
    name: 'Basic',
    price: 50,
    priceLabel: '$50',
    license: '30-day license',
    description: 'Focused London-session automation with Orion’s Safe profile.',
    highlights: ['London session', 'Safe risk profile', 'Maximum 2 positions', '7-day live trading dashboard'],
  },
  premium: {
    key: 'premium',
    name: 'Premium',
    price: 100,
    priceLabel: '$100',
    license: '90-day license',
    description: 'More session access, direction control, and Safe or Balanced profiles.',
    highlights: ['London + New York', 'Safe + Balanced profiles', 'Maximum 5 positions', '90-day analytics + advanced metrics'],
  },
  lifetime: {
    key: 'lifetime',
    name: 'Lifetime',
    price: 329,
    priceLabel: '$329',
    license: 'Lifetime license',
    description: 'The complete configurable Orion V5 control set.',
    highlights: ['All supported sessions', 'All profiles + Custom', 'Configurable position limit', 'All recorded analytics + advanced metrics'],
  },
};

export function normalizePlan(value: unknown): PlanKey | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return planKeys.includes(normalized as PlanKey) ? normalized as PlanKey : null;
}

export function normalizeTrackingId(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9._:-]{8,180}$/.test(normalized) ? normalized : null;
}

const allowedAuthDestinations = new Set(['/portal', '/portal/trading', '/portal/profile', '/portal/settings', '/checkout', '/reset-password']);
const documentDestination = /^\/(?:invoice|receipt)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeAuthNext(value: unknown, fallback = '/portal') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) return fallback;
  try {
    const origin = 'https://orion-client.invalid';
    const target = new URL(value, origin);
    if (target.origin !== origin || (!allowedAuthDestinations.has(target.pathname) && !documentDestination.test(target.pathname))) return fallback;
    return `${target.pathname}${target.search}`;
  } catch {
    return fallback;
  }
}

export function safeMfaNext(value: unknown, fallback = '/portal') {
  if (typeof value === 'string') {
    try {
      const origin = 'https://orion-auth.invalid';
      const target = new URL(value, origin);
      if (target.origin === origin && target.pathname === '/dashboard') return `${target.pathname}${target.search}`;
    } catch { /* Fall through to the client destination allow-list. */ }
  }
  return safeAuthNext(value, fallback);
}

export function planFromPath(value: unknown) {
  const next = safeAuthNext(value, '');
  if (!next) return null;
  return normalizePlan(new URL(next, 'https://orion-client.invalid').searchParams.get('plan'));
}

export function checkoutPath(plan: PlanKey | null) {
  return plan ? `/checkout?plan=${plan}` : '/portal';
}

export function checkoutSelectionPath(plan: PlanKey | null) {
  return plan ? checkoutPath(plan) : '/checkout';
}
