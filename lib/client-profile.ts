export const clientAvatarKeys = [
  'forex-gold',
  'forex-pulse',
  'forex-wave',
  'crypto-bitcoin',
  'crypto-coins',
  'crypto-orbit',
  'robot-core',
  'robot-radar',
  'robot-cpu',
] as const;

export type ClientAvatarKey = (typeof clientAvatarKeys)[number];

export const clientAvatarPresets: ReadonlyArray<{
  key: ClientAvatarKey;
  label: string;
  category: 'Forex' | 'Crypto' | 'Robot';
}> = [
  { key: 'forex-gold', label: 'Gold Trader', category: 'Forex' },
  { key: 'forex-pulse', label: 'Market Pulse', category: 'Forex' },
  { key: 'forex-wave', label: 'Wave Rider', category: 'Forex' },
  { key: 'crypto-bitcoin', label: 'Bitcoin Core', category: 'Crypto' },
  { key: 'crypto-coins', label: 'Crypto Stack', category: 'Crypto' },
  { key: 'crypto-orbit', label: 'Orbit Chain', category: 'Crypto' },
  { key: 'robot-core', label: 'Orion Bot', category: 'Robot' },
  { key: 'robot-radar', label: 'Signal Droid', category: 'Robot' },
  { key: 'robot-cpu', label: 'Quant Machine', category: 'Robot' },
];

export const brokerSuggestions = [
  'IC Markets',
  'Pepperstone',
  'Exness',
  'XM',
  'FP Markets',
  'Eightcap',
  'HFM',
  'FBS',
] as const;

export const tradingPairSuggestions = [
  'XAUUSD',
  'BTCUSD',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'NAS100',
  'US30',
  'ETHUSD',
  'GBPJPY',
  'EURJPY',
] as const;

export const clientProfileLimits = {
  nickname: 40,
  bio: 280,
  brokers: 8,
  tradingPairs: 12,
} as const;

export type ClientProfile = {
  nickname: string;
  telegramUsername: string;
  phoneNumber: string;
  bio: string;
  brokers: string[];
  tradingPairs: string[];
  avatarKey: ClientAvatarKey;
};

type ContactFallback = {
  telegramUsername?: string | null;
  phoneNumber?: string | null;
};

const defaultAvatarKey: ClientAvatarKey = 'robot-core';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown, maxItems: number, maxLength: number, uppercase = false) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of value) {
    const normalized = text(item, maxLength);
    const next = uppercase ? normalized.toUpperCase() : normalized;
    const identity = next.toLowerCase();
    if (!next || seen.has(identity)) continue;
    seen.add(identity);
    values.push(next);
    if (values.length >= maxItems) break;
  }
  return values;
}

export function normalizeClientAvatar(value: unknown): ClientAvatarKey {
  return typeof value === 'string' && clientAvatarKeys.includes(value as ClientAvatarKey)
    ? value as ClientAvatarKey
    : defaultAvatarKey;
}

export function readClientProfile(metadata: unknown, contact: ContactFallback = {}): ClientProfile {
  const root = record(metadata);
  const saved = record(root.orion_profile);
  return {
    nickname: text(saved.nickname, clientProfileLimits.nickname),
    telegramUsername: text(contact.telegramUsername, 80).replace(/^@/, ''),
    phoneNumber: text(contact.phoneNumber, 40),
    bio: text(saved.bio, clientProfileLimits.bio),
    brokers: list(saved.brokers, clientProfileLimits.brokers, 40),
    tradingPairs: list(saved.trading_pairs, clientProfileLimits.tradingPairs, 20, true),
    avatarKey: normalizeClientAvatar(saved.avatar_key),
  };
}

export function serializeClientProfile(profile: ClientProfile) {
  return {
    nickname: profile.nickname,
    bio: profile.bio,
    brokers: profile.brokers,
    trading_pairs: profile.tradingPairs,
    avatar_key: profile.avatarKey,
    updated_at: new Date().toISOString(),
  };
}

export function clientProfileDisplayName(profile: ClientProfile, fullName: string) {
  return profile.nickname || fullName.trim().split(/\s+/)[0] || 'Orion trader';
}
