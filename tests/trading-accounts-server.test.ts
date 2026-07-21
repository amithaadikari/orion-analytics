import { describe, expect, it } from 'vitest';
import { publicTradingAccountError } from '@/lib/trading-accounts-server';

describe('public trading-account errors', () => {
  it('maps the Lifetime replacement entitlement without exposing database details', () => {
    expect(publicTradingAccountError({ code: 'P0001', message: 'REAL_ACCOUNT_CHANGE_REQUIRES_LIFETIME' })).toEqual({
      status: 403,
      code: 'REAL_ACCOUNT_CHANGE_REQUIRES_LIFETIME',
      message: 'Your registered real account is fixed. Self-service account replacement is available only with Lifetime.',
      nextChangeAt: null,
    });
  });
});
