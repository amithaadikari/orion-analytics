import { describe, expect, it } from 'vitest';
import {
  activeTradingAlertRuleCount,
  defaultTradingAlertPreferences,
  isTradingAlertSnapshot,
  tradingAlertAccess,
  type TradingAlertSnapshot,
} from '@/lib/trading-alerts';

const validSnapshot: TradingAlertSnapshot = {
  generatedAt: '2026-07-21T15:00:00Z',
  connection: {
    id: '11111111-1111-4111-8111-111111111111',
    plan: 'Premium',
    platform: 'MT5',
    accountType: 'Real',
    maskedAccountNumber: '•••5678',
    brokerServer: 'OrionBroker-Live01',
    currency: 'USD',
  },
  access: {
    plan: 'Premium',
    connectionHealth: true,
    finalClose: true,
    advancedEvents: true,
    riskGuardrails: true,
  },
  preferences: {
    connectionHealth: true,
    finalClose: true,
    tradeOpened: true,
    partialClose: true,
    dailyLossEnabled: true,
    dailyLossLimit: 100,
    drawdownEnabled: true,
    drawdownPercent: 12.5,
    equityFloorEnabled: true,
    equityFloor: 750,
  },
  monitoring: {
    activeRules: 7,
    activeBreaches: 1,
    lastEvaluatedAt: '2026-07-21T14:59:00Z',
    lastAlertAt: '2026-07-21T14:58:00Z',
  },
};

describe('trading alert plan access', () => {
  it('keeps Basic to connection health and final-close alerts', () => {
    expect(tradingAlertAccess(' basic ')).toEqual({
      plan: 'Basic',
      connectionHealth: true,
      finalClose: true,
      advancedEvents: false,
      riskGuardrails: false,
    });
  });

  it.each(['Premium', 'lifetime'])('unlocks advanced events and risk guardrails for %s', (plan) => {
    expect(tradingAlertAccess(plan)).toMatchObject({
      plan: plan.toLowerCase() === 'lifetime' ? 'Lifetime' : 'Premium',
      connectionHealth: true,
      finalClose: true,
      advancedEvents: true,
      riskGuardrails: true,
    });
  });

  it.each(['Free', 'Pro', 'Standard', 'Enterprise', null])('does not infer paid access from %s', (plan) => {
    expect(tradingAlertAccess(plan)).toEqual({
      plan: 'Free',
      connectionHealth: false,
      finalClose: false,
      advancedEvents: false,
      riskGuardrails: false,
    });
  });
});

describe('trading alert defaults and active rules', () => {
  it('enables only included Basic defaults and can suppress health on an older scope', () => {
    expect(defaultTradingAlertPreferences('Basic')).toEqual({
      connectionHealth: true,
      finalClose: true,
      tradeOpened: false,
      partialClose: false,
      dailyLossEnabled: false,
      dailyLossLimit: null,
      drawdownEnabled: false,
      drawdownPercent: null,
      equityFloorEnabled: false,
      equityFloor: null,
    });
    expect(defaultTradingAlertPreferences('Basic', false)).toMatchObject({
      connectionHealth: false,
      finalClose: true,
    });
  });

  it('enables Premium event defaults but leaves monetary guardrails opt-in', () => {
    expect(defaultTradingAlertPreferences('Premium')).toMatchObject({
      connectionHealth: true,
      finalClose: true,
      tradeOpened: true,
      partialClose: true,
      dailyLossEnabled: false,
      dailyLossLimit: null,
      drawdownEnabled: false,
      drawdownPercent: null,
      equityFloorEnabled: false,
      equityFloor: null,
    });
  });

  it('counts enabled rules only when the active plan grants them', () => {
    const preferences = {
      ...defaultTradingAlertPreferences('Premium'),
      dailyLossEnabled: true,
      dailyLossLimit: 100,
      drawdownEnabled: true,
      drawdownPercent: 10,
      equityFloorEnabled: true,
      equityFloor: 500,
    };

    expect(activeTradingAlertRuleCount(preferences, tradingAlertAccess('Premium'))).toBe(7);
    expect(activeTradingAlertRuleCount(preferences, tradingAlertAccess('Basic'))).toBe(2);
    expect(activeTradingAlertRuleCount(preferences, tradingAlertAccess('Pro'))).toBe(0);
  });
});

describe('trading alert snapshot guard', () => {
  it('accepts the complete bounded server snapshot', () => {
    expect(isTradingAlertSnapshot(validSnapshot)).toBe(true);
    expect(isTradingAlertSnapshot({
      ...validSnapshot,
      monitoring: { ...validSnapshot.monitoring, lastEvaluatedAt: null, lastAlertAt: null },
      preferences: {
        ...validSnapshot.preferences,
        dailyLossLimit: null,
        drawdownPercent: null,
        equityFloor: null,
      },
    })).toBe(true);
  });

  it.each([
    ['an array', []],
    ['an invalid generated time', { ...validSnapshot, generatedAt: 'not-a-date' }],
    ['an unknown connection plan', { ...validSnapshot, connection: { ...validSnapshot.connection, plan: 'Enterprise' } }],
    ['an invalid platform', { ...validSnapshot, connection: { ...validSnapshot.connection, platform: 'MT6' } }],
    ['a non-boolean access flag', { ...validSnapshot, access: { ...validSnapshot.access, riskGuardrails: 'yes' } }],
    ['a non-boolean preference', { ...validSnapshot, preferences: { ...validSnapshot.preferences, finalClose: 1 } }],
    ['a zero threshold', { ...validSnapshot, preferences: { ...validSnapshot.preferences, dailyLossLimit: 0 } }],
    ['a non-finite threshold', { ...validSnapshot, preferences: { ...validSnapshot.preferences, drawdownPercent: Number.NaN } }],
    ['a negative breach count', { ...validSnapshot, monitoring: { ...validSnapshot.monitoring, activeBreaches: -1 } }],
    ['a fractional rule count', { ...validSnapshot, monitoring: { ...validSnapshot.monitoring, activeRules: 1.5 } }],
    ['an invalid monitoring timestamp', { ...validSnapshot, monitoring: { ...validSnapshot.monitoring, lastAlertAt: 'not-a-date' } }],
  ])('rejects %s', (_label, value) => {
    expect(isTradingAlertSnapshot(value)).toBe(false);
  });
});
