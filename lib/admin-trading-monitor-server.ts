import 'server-only';

import type { createSupabaseAdminClient } from '@/lib/supabase/server';
import { maskLicenseKey } from '@/lib/license-runtime';
import { maskTradingAccount } from '@/lib/trading-accounts';
import { isMissingTradingTelemetrySchema } from '@/lib/trading-telemetry-server';
import {
  tradingConnectionAttention,
  tradingConnectionState,
  type AdminTradingMonitorItem,
  type AdminTradingMonitorSnapshot,
} from '@/lib/admin-trading-monitor';

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;
type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export async function loadAdminTradingMonitor(db: DatabaseClient): Promise<AdminTradingMonitorSnapshot> {
  const now = new Date();
  const rejectedSince = new Date(now.getTime() - 86_400_000).toISOString();
  const [clientResult, licenseResult, scopeResult, streamResult, installationResult, demoResult, realResult, rejectionResult] = await Promise.all([
    db.from('clients').select('id,full_name,status').limit(5000),
    db.from('licenses').select('id,client_id,license_key,plan,platform,status,expires_at,revoked_at,binding_version,trading_account_id,created_at').order('created_at', { ascending: false }).limit(5000),
    db.from('orion_telemetry_account_scopes').select('id,client_id,license_id,platform,account_type,trading_account_id,demo_account_id,account_number,broker_server,last_seen_at').order('last_seen_at', { ascending: false }).limit(5000),
    db.from('orion_telemetry_streams').select('id,account_scope_id,client_id,license_id,installation_id,binding_version,status,last_seen_at,last_captured_at,ea_version,terminal_build,open_position_count').order('last_seen_at', { ascending: false }).limit(5000),
    db.from('license_installations').select('id,license_id,client_id,installation_hint,status').eq('status', 'Active').limit(5000),
    db.from('license_demo_accounts').select('id,license_id,client_id,account_number,broker_server,platform,status').eq('status', 'Active').limit(5000),
    db.from('client_trading_accounts').select('id,client_id,account_number,broker_server,platform,status,verified_at,account_type').eq('status', 'Active').eq('account_type', 'Real').limit(5000),
    db.from('orion_telemetry_rejections').select('id', { count: 'exact', head: true }).gte('rejected_at', rejectedSince),
  ]);
  const error = clientResult.error || licenseResult.error || scopeResult.error || streamResult.error || installationResult.error
    || demoResult.error || realResult.error || rejectionResult.error;
  if (error) throw adminTradingMonitorDatabaseError(error);

  const clients = new Map((clientResult.data || []).map((row) => [row.id, row]));
  const installations = new Map((installationResult.data || []).map((row) => [row.license_id, row]));
  const demos = new Map((demoResult.data || []).map((row) => [row.license_id, row]));
  const reals = new Map((realResult.data || []).map((row) => [row.id, row]));
  const scopesByLicense = new Map<string, Array<Record<string, unknown>>>();
  for (const scope of scopeResult.data || []) {
    const rows = scopesByLicense.get(scope.license_id) || [];
    rows.push(scope);
    scopesByLicense.set(scope.license_id, rows);
  }
  const streamsByScope = new Map<string, Array<Record<string, unknown>>>();
  for (const stream of streamResult.data || []) {
    const rows = streamsByScope.get(stream.account_scope_id) || [];
    rows.push(stream);
    streamsByScope.set(stream.account_scope_id, rows);
  }

  const items: AdminTradingMonitorItem[] = [];
  for (const license of licenseResult.data || []) {
    const client = clients.get(license.client_id);
    const installation = installations.get(license.id);
    if (!client || client.status !== 'Active' || !installation || !licenseActive(license, now)) continue;
    const real = license.trading_account_id ? reals.get(license.trading_account_id) : null;
    const demo = demos.get(license.id);
    const scopes = scopesByLicense.get(license.id) || [];
    const identities: Array<{ accountType: 'Demo' | 'Real'; account: Record<string, unknown>; scope: Record<string, unknown> | undefined }> = [];
    if (real?.verified_at) identities.push({ accountType: 'Real', account: real, scope: scopes.find((row) => row.trading_account_id === real.id) });
    if (demo) identities.push({ accountType: 'Demo', account: demo, scope: scopes.find((row) => row.demo_account_id === demo.id) });
    for (const identity of identities) {
      const stream = identity.scope
        ? (streamsByScope.get(String(identity.scope.id)) || []).find((row) => row.status === 'Active' && Number(row.binding_version) === Number(license.binding_version || 0))
        : null;
      const lastSeenAt = typeof stream?.last_seen_at === 'string' ? stream.last_seen_at : null;
      const state = tradingConnectionState(lastSeenAt, now);
      const openPositions = Math.max(0, Math.min(100, Number(stream?.open_position_count || 0)));
      items.push({
        connectionId: String(identity.scope?.id || `${license.id}-${identity.accountType.toLowerCase()}`),
        clientId: String(client.id),
        clientName: String(client.full_name || 'Orion client'),
        plan: license.plan === 'Lifetime' ? 'Lifetime' : license.plan === 'Premium' ? 'Premium' : 'Basic',
        maskedLicenseKey: maskLicenseKey(String(license.license_key || '')),
        maskedAccountNumber: maskTradingAccount(String(identity.account.account_number || '')),
        brokerServer: String(identity.account.broker_server || ''),
        platform: license.platform === 'MT4' ? 'MT4' : 'MT5',
        accountType: identity.accountType,
        installationHint: String(installation.installation_hint || 'Paired'),
        state,
        lastSeenAt,
        lastCapturedAt: typeof stream?.last_captured_at === 'string' ? stream.last_captured_at : null,
        eaVersion: typeof stream?.ea_version === 'string' ? stream.ea_version : null,
        terminalBuild: Number.isInteger(stream?.terminal_build) ? Number(stream?.terminal_build) : null,
        openPositions,
        attention: tradingConnectionAttention(state, openPositions),
      });
    }
  }
  items.sort((left, right) => attentionRank(left) - attentionRank(right) || String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')) || left.clientName.localeCompare(right.clientName));
  const counts = {
    total: items.length,
    online: items.filter((item) => item.state === 'online').length,
    delayed: items.filter((item) => item.state === 'delayed').length,
    offline: items.filter((item) => item.state === 'offline').length,
    never: items.filter((item) => item.state === 'never').length,
    offlineWithOpenPositions: items.filter((item) => item.attention === 'offline-open-positions').length,
    rejected24h: Number(rejectionResult.count || 0),
  };
  return { generatedAt: now.toISOString(), counts, items };
}

function licenseActive(license: Record<string, unknown>, now: Date) {
  if (license.status !== 'Active' || license.revoked_at) return false;
  if (!license.expires_at) return true;
  const expires = Date.parse(String(license.expires_at));
  return Number.isFinite(expires) && expires >= now.getTime();
}

function attentionRank(item: AdminTradingMonitorItem) {
  if (item.attention === 'offline-open-positions') return 0;
  if (item.state === 'offline') return 1;
  if (item.state === 'delayed') return 2;
  if (item.state === 'never') return 3;
  return 4;
}

function adminTradingMonitorDatabaseError(error: DatabaseError) {
  if (isMissingTradingTelemetrySchema(error)) {
    return Object.assign(new Error('Telemetry migration required'), { code: 'TELEMETRY_MIGRATION_REQUIRED', status: 503 });
  }
  return Object.assign(new Error('EA fleet unavailable'), { code: 'DATABASE_ERROR', status: 500 });
}

export function publicAdminTradingMonitorError(error: unknown) {
  const known = error as { code?: string };
  if (known?.code === 'TELEMETRY_MIGRATION_REQUIRED') {
    return { status: 503, message: 'The EA fleet monitor is waiting for the latest database migration.' };
  }
  return { status: 500, message: 'The EA fleet monitor is temporarily unavailable.' };
}
