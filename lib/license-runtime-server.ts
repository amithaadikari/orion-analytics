import 'server-only';

import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  installationHint,
  maskLicenseKey,
  normalizeInstallationId,
  type LicenseRuntimeItem,
  type LicenseRuntimeSnapshot,
  type OrionLicensePlan,
} from '@/lib/license-runtime';
import { effectiveMembership, maskTradingAccount, type TradingPlatform } from '@/lib/trading-accounts';

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;
type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export function hashInstallationId(value: string) {
  return createHash('sha256').update(normalizeInstallationId(value), 'utf8').digest('hex');
}

export async function loadLicenseRuntimeSnapshot(db: DatabaseClient, clientId: string): Promise<LicenseRuntimeSnapshot> {
  const now = new Date();
  const [clientResult, licensesResult, demosResult, demoChangesResult, installationsResult, installationChangesResult] = await Promise.all([
    db.from('clients')
      .select('id,status,membership_tier,membership_status,membership_started_at,membership_expires_at')
      .eq('id', clientId)
      .maybeSingle(),
    db.from('licenses')
      .select('id,license_key,plan,platform,status,expires_at,revoked_at,binding_version,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('license_demo_accounts')
      .select('id,license_id,account_number,broker_server,platform,status,registered_at')
      .eq('client_id', clientId)
      .eq('status', 'Active')
      .limit(500),
    db.from('license_demo_account_changes')
      .select('license_id,changed_by,change_kind,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('license_installations')
      .select('id,license_id,installation_hint,device_label,status,activated_at,last_seen_at')
      .eq('client_id', clientId)
      .eq('status', 'Active')
      .limit(500),
    db.from('license_installation_changes')
      .select('license_id,changed_by,change_kind,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const error = clientResult.error || licensesResult.error || demosResult.error || demoChangesResult.error || installationsResult.error || installationChangesResult.error;
  if (error) throw licenseRuntimeDatabaseError(error);
  if (!clientResult.data) throw Object.assign(new Error('Client not found'), { status: 404, code: 'CLIENT_NOT_FOUND' });

  const membership = effectiveMembership(clientResult.data, now);
  const demos = new Map((demosResult.data || []).map((row) => [row.license_id, row]));
  const installations = new Map((installationsResult.data || []).map((row) => [row.license_id, row]));
  const demoChanges = demoChangesResult.data || [];
  const installationChanges = installationChangesResult.data || [];
  const clientActive = clientResult.data.status === 'Active';

  const licenses: LicenseRuntimeItem[] = (licensesResult.data || []).map((row) => {
    const eligible = isEligibleLicense(row, now) && clientActive;
    const demo = demos.get(row.id);
    const installation = installations.get(row.id);
    const demoEligibility = runtimeDemoEligibility({
      eligible,
      clientActive,
      membershipTier: membership.effectiveTier,
      hasBinding: Boolean(demo),
      changes: demoChanges.filter((change) => change.license_id === row.id),
      now,
    });
    const installationEligibility = runtimeInstallationEligibility({
      eligible,
      clientActive,
      hasBinding: Boolean(installation),
      changes: installationChanges.filter((change) => change.license_id === row.id),
      now,
    });
    return {
      id: row.id,
      maskedLicenseKey: maskLicenseKey(row.license_key || ''),
      plan: normalizePlan(row.plan),
      platform: normalizePlatform(row.platform),
      status: String(row.status || ''),
      expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
      bindingVersion: Number.isInteger(row.binding_version) && row.binding_version >= 0 ? row.binding_version : 0,
      eligible,
      demoAccount: demo ? {
        id: demo.id,
        maskedAccountNumber: maskTradingAccount(demo.account_number),
        brokerServer: String(demo.broker_server || ''),
        platform: normalizePlatform(demo.platform),
        registeredAt: String(demo.registered_at || ''),
      } : null,
      installation: installation ? {
        id: installation.id,
        hint: String(installation.installation_hint || 'Paired'),
        label: String(installation.device_label || 'MT5 installation'),
        activatedAt: String(installation.activated_at || ''),
        lastSeenAt: typeof installation.last_seen_at === 'string' ? installation.last_seen_at : null,
      } : null,
      ...demoEligibility,
      ...installationEligibility,
    };
  });

  return {
    serverTime: now.toISOString(),
    clientStatus: clientResult.data.status,
    membership,
    licenses,
  };
}

function runtimeDemoEligibility({ eligible, clientActive, membershipTier, hasBinding, changes, now }: {
  eligible: boolean;
  clientActive: boolean;
  membershipTier: 'Standard' | 'Pro';
  hasBinding: boolean;
  changes: Array<{ changed_by?: string | null; change_kind?: string | null; created_at?: string | null }>;
  now: Date;
}) {
  if (!clientActive) return { canChangeDemo: false, nextDemoChangeAt: null, demoCooldownReason: 'inactive' as const };
  if (!eligible) return { canChangeDemo: false, nextDemoChangeAt: null, demoCooldownReason: 'license-inactive' as const };
  if (!hasBinding) return { canChangeDemo: true, nextDemoChangeAt: null, demoCooldownReason: null };
  const replacements = changeTimes(changes, now);
  if (membershipTier === 'Standard') {
    const next = replacements[0] ? replacements[0] + 7 * 86_400_000 : null;
    if (next && next > now.getTime()) return { canChangeDemo: false, nextDemoChangeAt: new Date(next).toISOString(), demoCooldownReason: 'standard' as const };
    return { canChangeDemo: true, nextDemoChangeAt: null, demoCooldownReason: null };
  }
  const recent = replacements.filter((time) => time > now.getTime() - 86_400_000);
  if (recent.length >= 2) {
    return { canChangeDemo: false, nextDemoChangeAt: new Date(Math.min(...recent) + 86_400_000).toISOString(), demoCooldownReason: 'pro-security' as const };
  }
  return { canChangeDemo: true, nextDemoChangeAt: null, demoCooldownReason: null };
}

function runtimeInstallationEligibility({ eligible, clientActive, hasBinding, changes, now }: {
  eligible: boolean;
  clientActive: boolean;
  hasBinding: boolean;
  changes: Array<{ changed_by?: string | null; change_kind?: string | null; created_at?: string | null }>;
  now: Date;
}) {
  if (!clientActive) return { canReplaceInstallation: false, nextInstallationChangeAt: null, installationCooldownReason: 'inactive' as const };
  if (!eligible) return { canReplaceInstallation: false, nextInstallationChangeAt: null, installationCooldownReason: 'license-inactive' as const };
  if (!hasBinding) return { canReplaceInstallation: true, nextInstallationChangeAt: null, installationCooldownReason: null };
  const recent = changeTimes(changes, now).filter((time) => time > now.getTime() - 86_400_000);
  if (recent.length >= 2) {
    return { canReplaceInstallation: false, nextInstallationChangeAt: new Date(Math.min(...recent) + 86_400_000).toISOString(), installationCooldownReason: 'security-limit' as const };
  }
  return { canReplaceInstallation: true, nextInstallationChangeAt: null, installationCooldownReason: null };
}

function changeTimes(changes: Array<{ changed_by?: string | null; change_kind?: string | null; created_at?: string | null }>, now: Date) {
  return changes
    .filter((change) => change.changed_by === 'Client' && ['Replacement', 'Reactivation'].includes(String(change.change_kind || '')))
    .map((change) => new Date(String(change.created_at || '')).getTime())
    .filter((time) => Number.isFinite(time) && time <= now.getTime())
    .sort((left, right) => right - left);
}

function isEligibleLicense(license: Record<string, unknown>, now: Date) {
  if (license.status !== 'Active' || license.revoked_at) return false;
  if (!license.expires_at) return true;
  const expires = new Date(String(license.expires_at)).getTime();
  return Number.isFinite(expires) && expires >= now.getTime();
}

function normalizePlan(value: unknown): OrionLicensePlan {
  if (value === 'Premium') return 'Premium';
  if (value === 'Lifetime') return 'Lifetime';
  return 'Basic';
}

function normalizePlatform(value: unknown): TradingPlatform {
  return value === 'MT4' ? 'MT4' : 'MT5';
}

function licenseRuntimeDatabaseError(error: DatabaseError) {
  if (isMissingLicenseRuntimeSchema(error)) {
    return Object.assign(new Error('Demo and installation pairing are waiting for the latest database migration.'), { status: 503, code: 'MIGRATION_REQUIRED' });
  }
  return Object.assign(new Error('License pairing is temporarily unavailable.'), { status: 500, code: 'DATABASE_ERROR' });
}

export function isMissingLicenseRuntimeSchema(error: DatabaseError) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return ['42p01', '42703', '42883', 'pgrst202', 'pgrst204', 'pgrst205'].includes(String(error?.code || '').toLowerCase())
    || ['license_demo_accounts', 'license_demo_account_changes', 'license_installations', 'license_installation_changes', 'validate_orion_license_runtime'].some((name) => message.includes(name) && (message.includes('does not exist') || message.includes('could not find')));
}

export function publicLicenseRuntimeError(error: DatabaseError) {
  if (isMissingLicenseRuntimeSchema(error)) return { status: 503, code: 'MIGRATION_REQUIRED', message: 'Demo and installation pairing are waiting for the latest database migration.', nextChangeAt: null as string | null };
  const message = String(error?.message || '');
  const timed = message.match(/(DEMO_ACCOUNT_CHANGE_COOLDOWN|PRO_DEMO_CHANGE_RATE_LIMIT|INSTALLATION_CHANGE_RATE_LIMIT):([^\s]+)/);
  if (timed) {
    const messages: Record<string, string> = {
      DEMO_ACCOUNT_CHANGE_COOLDOWN: 'Standard membership can replace a Demo account once every 7 days.',
      PRO_DEMO_CHANGE_RATE_LIMIT: 'For account security, Pro membership allows two Demo-account replacements in 24 hours.',
      INSTALLATION_CHANGE_RATE_LIMIT: 'For license security, an installation can be replaced twice in a rolling 24 hours.',
    };
    return { status: 409, code: timed[1], message: messages[timed[1]], nextChangeAt: timed[2] };
  }
  const known: Record<string, { status: number; message: string }> = {
    CLIENT_NOT_FOUND: { status: 404, message: 'The linked Orion client account was not found.' },
    CLIENT_NOT_ACTIVE: { status: 409, message: 'This Orion client account is not active.' },
    LICENSE_NOT_FOUND: { status: 404, message: 'The selected license was not found.' },
    LICENSE_NOT_ACTIVE: { status: 409, message: 'The selected license is not active.' },
    DEMO_ACCOUNT_ALREADY_REGISTERED: { status: 409, message: 'This Demo identity is already registered to another Orion client.' },
    REQUEST_ID_CONFLICT: { status: 409, message: 'This request identifier was already used.' },
    ADMIN_ACCESS_REQUIRED: { status: 403, message: 'Administrator access is required.' },
    ADMIN_OVERRIDE_REASON_REQUIRED: { status: 400, message: 'Enter an emergency-reset reason of at least 10 characters.' },
  };
  const code = Object.keys(known).find((key) => message.includes(key));
  if (code) return { ...known[code], code, nextChangeAt: null as string | null };
  if (error?.code === '23505') return { status: 409, code: 'PAIRING_CONFLICT', message: 'The pairing could not be changed because it conflicts with an active record.', nextChangeAt: null as string | null };
  return { status: 500, code: 'PAIRING_CHANGE_FAILED', message: 'The pairing could not be changed. The previous binding was preserved.', nextChangeAt: null as string | null };
}

export { installationHint };
