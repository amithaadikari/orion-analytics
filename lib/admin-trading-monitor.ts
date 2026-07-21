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
  reliability?: AdminTradingReliabilitySnapshot;
};

export const CURRENT_ORION_EA_VERSION = '5.2.0';

export type AdminTradingVersionAdoption = {
  currentVersion: string;
  totalConnections: number;
  reportingConnections: number;
  currentConnections: number;
  unknownConnections: number;
  adoptionPercent: number | null;
  breakdown: Array<{
    version: string;
    connections: number;
    percentage: number;
    current: boolean;
  }>;
};

export type AdminTradingReliabilityIncident = {
  id: string;
  incidentType: 'offline_with_open_positions' | 'offline_stream' | 'rejection_spike';
  severity: 'critical' | 'high' | 'warning';
  status: 'Open' | 'Resolved';
  summary: string;
  clientId: string | null;
  clientName: string | null;
  maskedAccountNumber: string | null;
  maskedLicenseKey: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
};

export type AdminTradingReliabilityRun = {
  id: string;
  jobName: 'reliability-evaluator' | 'telemetry-retention';
  status: 'Running' | 'Succeeded' | 'Failed';
  evaluatorVersion: string | null;
  startedAt: string;
  completedAt: string | null;
  streamsEvaluated: number;
  offlineWithOpenPositions: number;
  offlineStreams: number;
  rejectionWindowCount: number;
  rejectionSpikes: number;
  incidentsDetected: number;
  incidentsOpened: number;
  incidentsRefreshed: number;
  incidentsResolved: number;
  errorCode: string | null;
  skipped: boolean;
  skipReason: 'concurrent_evaluation' | null;
};

export type AdminTradingReliabilitySnapshot = {
  available: boolean;
  unavailableReason: 'migration_pending' | 'temporarily_unavailable' | null;
  canAcknowledge: boolean;
  versions: AdminTradingVersionAdoption;
  incidents: AdminTradingReliabilityIncident[];
  openIncidentCount: number;
  openIncidentOverflow: boolean;
  runs: AdminTradingReliabilityRun[];
};

export function buildEaVersionAdoption(
  items: AdminTradingMonitorItem[],
  currentVersion = CURRENT_ORION_EA_VERSION,
): AdminTradingVersionAdoption {
  const totals = new Map<string, number>();
  for (const item of items) {
    const version = item.eaVersion?.trim().replace(/^v/i, '');
    if (version) totals.set(version, (totals.get(version) || 0) + 1);
  }
  const totalConnections = items.length;
  const reportingConnections = [...totals.values()].reduce((total, count) => total + count, 0);
  const currentConnections = totals.get(currentVersion) || 0;
  const percentage = (count: number) => totalConnections
    ? Math.round((count / totalConnections) * 1000) / 10
    : 0;
  return {
    currentVersion,
    totalConnections,
    reportingConnections,
    currentConnections,
    unknownConnections: totalConnections - reportingConnections,
    adoptionPercent: totalConnections ? percentage(currentConnections) : null,
    breakdown: [...totals.entries()]
      .map(([version, connections]) => ({
        version,
        connections,
        percentage: percentage(connections),
        current: version === currentVersion,
      }))
      .sort((left, right) => Number(right.current) - Number(left.current)
        || right.connections - left.connections
        || right.version.localeCompare(left.version, undefined, { numeric: true })),
  };
}

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
