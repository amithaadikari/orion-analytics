export type TradingConnectionState = 'online' | 'delayed' | 'offline' | 'never';

export type AdminTradingMonitorItem = {
  connectionId: string;
  clientId: string;
  clientName: string;
  plan: 'Basic' | 'Premium' | 'Lifetime';
  maskedLicenseKey: string;
  maskedAccountNumber: string;
  brokerServer: string;
  platform: 'MT4' | 'MT5';
  accountType: 'Demo' | 'Real';
  installationHint: string;
  state: TradingConnectionState;
  lastSeenAt: string | null;
  lastCapturedAt: string | null;
  eaVersion: string | null;
  terminalBuild: number | null;
  openPositions: number;
  attention: 'offline-open-positions' | 'delayed' | 'offline' | 'waiting-first-sync' | null;
};

export type AdminTradingMonitorSnapshot = {
  generatedAt: string;
  counts: {
    total: number;
    online: number;
    delayed: number;
    offline: number;
    never: number;
    offlineWithOpenPositions: number;
    rejected24h: number;
  };
  items: AdminTradingMonitorItem[];
};

export function tradingConnectionState(lastSeenAt: string | null, now = new Date()): TradingConnectionState {
  if (!lastSeenAt) return 'never';
  const seenAt = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seenAt)) return 'never';
  const ageSeconds = Math.max(0, (now.getTime() - seenAt) / 1000);
  if (ageSeconds <= 180) return 'online';
  if (ageSeconds <= 600) return 'delayed';
  return 'offline';
}
export function tradingConnectionAttention(state: TradingConnectionState, openPositions: number) {
  if (state === 'offline' && openPositions > 0) return 'offline-open-positions' as const;
  if (state === 'delayed') return 'delayed' as const;
  if (state === 'offline') return 'offline' as const;
  if (state === 'never') return 'waiting-first-sync' as const;
  return null;
}
