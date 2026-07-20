import { describe, expect, it } from 'vitest';
import {
  clientProfileDisplayName,
  normalizeClientAvatar,
  readClientProfile,
  serializeClientProfile,
} from '@/lib/client-profile';
import { clientProfileSchema } from '@/lib/validation';

describe('client trading profile', () => {
  it('normalizes saved authenticated metadata and preserves existing contact fields', () => {
    const profile = readClientProfile({
      orion_profile: {
        nickname: '  Gold Hunter  ',
        telegram_username: '@metadata_user',
        phone_number: '+1 555 100 2000',
        bio: '  London-session trader.  ',
        brokers: ['IC Markets', 'IC Markets', 'Exness'],
        trading_pairs: ['xauusd', 'BTCUSD', 'xauusd'],
        avatar_key: 'robot-radar',
      },
    }, { telegramUsername: 'database_user', phoneNumber: '+94 77 123 4567' });

    expect(profile).toEqual({
      nickname: 'Gold Hunter',
      telegramUsername: 'database_user',
      phoneNumber: '+94 77 123 4567',
      bio: 'London-session trader.',
      brokers: ['IC Markets', 'Exness'],
      tradingPairs: ['XAUUSD', 'BTCUSD'],
      avatarKey: 'robot-radar',
    });
  });

  it('keeps contact details canonical in the client record instead of stale metadata', () => {
    const profile = readClientProfile({
      orion_profile: { telegram_username: 'stale_user', phone_number: '+1 555 100 2000' },
    }, { telegramUsername: null, phoneNumber: null });

    expect(profile.telegramUsername).toBe('');
    expect(profile.phoneNumber).toBe('');
  });

  it('uses a safe animated robot fallback for unknown avatar values', () => {
    expect(normalizeClientAvatar('unknown')).toBe('robot-core');
    expect(readClientProfile(null).avatarKey).toBe('robot-core');
  });

  it('normalizes profile updates and rejects protected account fields', () => {
    const parsed = clientProfileSchema.safeParse({
      nickname: '  Quant One ',
      telegramUsername: '@quant_one',
      phoneNumber: '+44 (0) 7700 900123',
      bio: 'Automated gold and major-pair trader.',
      brokers: ['Pepperstone', 'pepperstone', 'Eightcap'],
      tradingPairs: ['xauusd', 'XAUUSD', 'eurusd'],
      avatarKey: 'crypto-bitcoin',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.telegramUsername).toBe('quant_one');
      expect(parsed.data.brokers).toEqual(['Pepperstone', 'Eightcap']);
      expect(parsed.data.tradingPairs).toEqual(['XAUUSD', 'EURUSD']);
    }

    expect(clientProfileSchema.safeParse({
      nickname: '', telegramUsername: '', phoneNumber: '', bio: '', brokers: [], tradingPairs: [], avatarKey: 'robot-core', plan: 'Lifetime',
    }).success).toBe(false);
  });

  it('serializes only profile preferences and uses nickname as the portal display name', () => {
    const profile = readClientProfile({ orion_profile: { nickname: 'Night Scalper' } });
    expect(clientProfileDisplayName(profile, 'Ishanka Adhikari')).toBe('Night Scalper');
    expect(Object.keys(serializeClientProfile(profile)).sort()).toEqual([
      'avatar_key', 'bio', 'brokers', 'nickname', 'trading_pairs', 'updated_at',
    ]);
  });
});
