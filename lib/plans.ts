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
    highlights: ['London session', 'Safe risk profile', 'Maximum 2 positions'],
  },
  premium: {
    key: 'premium',
    name: 'Premium',
    price: 100,
    priceLabel: '$100',
    license: '90-day license',
    description: 'More session access, direction control, and Safe or Balanced profiles.',
    highlights: ['London + New York', 'Safe + Balanced profiles', 'Maximum 5 positions'],
  },
  lifetime: {
    key: 'lifetime',
    name: 'Lifetime',
    price: 329,
    priceLabel: '$329',
    license: 'Lifetime license',
    description: 'The complete configurable Orion V5 control set.',
    highlights: ['All supported sessions', 'All profiles + Custom', 'Configurable position limit'],
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

const allowedAuthDestinations = new Set(['/portal', '/checkout', '/reset-password']);

export function safeAuthNext(value: unknown, fallback = '/portal') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) return fallback;
  try {
    const origin = 'https://orion-client.invalid';
    const target = new URL(value, origin);
    if (target.origin !== origin || !allowedAuthDestinations.has(target.pathname)) return fallback;
    return `${target.pathname}${target.search}`;
  } catch {
    return fallback;
  }
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
