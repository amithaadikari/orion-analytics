import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  accountChangeEligibility,
  canonicalClientPlan,
  effectiveMembership,
  maskTradingAccount,
  type TradingAccountHistoryItem,
  type TradingAccountSnapshot,
  type TradingAccountView,
  type TradingPlatform,
} from '@/lib/trading-accounts';

type DatabaseClient = ReturnType<typeof createSupabaseAdminClient>;
type DatabaseError = { code?: string; message?: string; details?: string } | null | undefined;

export async function loadTradingAccountSnapshot(db: DatabaseClient, clientId: string, options: { includeAdminDetails?: boolean } = {}) {
  const now = new Date();
  const [clientResult, accountsResult, changesResult, licensesResult, queueResult] = await Promise.all([
    db.from('clients')
      .select('id,status,plan,membership_tier,membership_status,membership_started_at,membership_expires_at')
      .eq('id', clientId)
      .maybeSingle(),
    db.from('client_trading_accounts')
      .select('id,client_id,account_number,broker,broker_server,platform,account_type,currency,status,verified_at,registered_at,deactivated_at,change_source')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('trading_account_changes')
      .select('id,client_id,previous_account_id,new_account_id,membership_tier,changed_by,change_kind,override_reason,next_client_change_at,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('licenses')
      .select('id,platform,status,expires_at,revoked_at,trading_account_id,binding_version')
      .eq('client_id', clientId)
      .limit(500),
    db.from('legacy_trading_account_backfill_queue')
      .select('normalized_account_number,platform,resolution_status')
      .eq('client_id', clientId)
      .eq('resolution_status', 'Pending')
      .limit(500),
  ]);

  const error = clientResult.error || accountsResult.error || changesResult.error || licensesResult.error || queueResult.error;
  if (error) throw tradingAccountsDatabaseError(error);
  if (!clientResult.data) throw Object.assign(new Error('Client not found'), { status: 404, code: 'CLIENT_NOT_FOUND' });

  const accounts = (accountsResult.data || []).filter((row) => row.account_type === 'Real').map(publicAccount);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const currentAccount = accounts.find((account) => account.status === 'Active') || null;
  const hasRegisteredAccount = accounts.some((account) => account.verifiedAt !== null);
  const history = (changesResult.data || []).flatMap((row): TradingAccountHistoryItem[] => {
    const next = accountMap.get(row.new_account_id);
    if (!next) return [];
    const previous = row.previous_account_id ? accountMap.get(row.previous_account_id) || null : null;
    return [{
      id: row.id,
      changedBy: row.changed_by as TradingAccountHistoryItem['changedBy'],
      changeKind: row.change_kind as TradingAccountHistoryItem['changeKind'],
      membershipTier: row.membership_tier === 'Pro' ? 'Pro' : 'Standard',
      previousAccount: previous ? { maskedAccountNumber: previous.maskedAccountNumber, platform: previous.platform } : null,
      newAccount: {
        maskedAccountNumber: next.maskedAccountNumber,
        platform: next.platform,
        broker: next.broker,
        brokerServer: next.brokerServer,
      },
      ...(options.includeAdminDetails ? { overrideReason: row.override_reason || null } : {}),
      nextClientChangeAt: row.next_client_change_at || null,
      createdAt: row.created_at,
    }];
  });
  const membership = effectiveMembership(clientResult.data, now);
  const validLicenses = (licensesResult.data || []).filter((license) => isEligibleLicense(license, now));
  const eligibleLicenses = validLicenses.length;
  const eligiblePlatforms = [...new Set(validLicenses.map((license) => license.platform).filter((platform): platform is TradingPlatform => platform === 'MT4' || platform === 'MT5'))];
  const licensesBound = currentAccount
    ? validLicenses.filter((license) => license.trading_account_id === currentAccount.id).length
    : 0;
  const eligibility = accountChangeEligibility({
    clientPlan: canonicalClientPlan(clientResult.data.plan),
    membershipTier: membership.effectiveTier,
    currentAccount,
    hasRegisteredAccount,
    clientStatus: clientResult.data.status,
    eligibleLicenses,
    history,
    now,
  });
  const legacyNumbers = [...new Set((queueResult.data || [])
    .map((row) => row.normalized_account_number)
    .filter((value) => /^[0-9]{4,24}$/.test(value)))];

  const snapshot: TradingAccountSnapshot = {
    serverTime: now.toISOString(),
    clientStatus: clientResult.data.status,
    clientPlan: canonicalClientPlan(clientResult.data.plan),
    membership,
    currentAccount,
    hasRegisteredAccount,
    licensesBound,
    eligibleLicenses,
    eligiblePlatforms,
    canChange: eligibility.canChange,
    nextChangeAt: eligibility.nextChangeAt,
    cooldownDays: 7,
    cooldownReason: eligibility.cooldownReason,
    legacyReview: {
      pendingCount: (queueResult.data || []).length,
      suggestedAccountNumber: legacyNumbers.length === 1 ? legacyNumbers[0] : null,
    },
    history,
  };
  return snapshot;
}

function publicAccount(row: Record<string, unknown>): TradingAccountView {
  const accountNumber = String(row.account_number || '');
  return {
    id: String(row.id || ''),
    accountNumber,
    maskedAccountNumber: maskTradingAccount(accountNumber),
    broker: String(row.broker || ''),
    brokerServer: String(row.broker_server || ''),
    platform: (row.platform === 'MT4' ? 'MT4' : 'MT5') as TradingPlatform,
    currency: typeof row.currency === 'string' ? row.currency : null,
    status: String(row.status || ''),
    verifiedAt: typeof row.verified_at === 'string' ? row.verified_at : null,
    registeredAt: String(row.registered_at || ''),
    deactivatedAt: typeof row.deactivated_at === 'string' ? row.deactivated_at : null,
  };
}

function isEligibleLicense(license: Record<string, unknown>, now: Date) {
  if (license.status !== 'Active' || license.revoked_at) return false;
  if (!license.expires_at) return true;
  const expires = new Date(String(license.expires_at)).getTime();
  return !Number.isNaN(expires) && expires >= now.getTime();
}

function tradingAccountsDatabaseError(error: DatabaseError) {
  if (isMissingTradingAccountSchema(error)) {
    return Object.assign(new Error('Trading accounts are waiting for the latest database migration.'), { status: 503, code: 'MIGRATION_REQUIRED' });
  }
  return Object.assign(new Error('Trading accounts are temporarily unavailable.'), { status: 500, code: 'DATABASE_ERROR' });
}

export function isMissingTradingAccountSchema(error: DatabaseError) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return ['42p01', '42703', '42883', 'pgrst202', 'pgrst204', 'pgrst205'].includes(String(error?.code || '').toLowerCase())
    || ['client_trading_accounts', 'trading_account_changes', 'legacy_trading_account_backfill_queue', 'change_registered_real_account'].some((name) => message.includes(name) && (message.includes('does not exist') || message.includes('could not find')));
}

export function publicTradingAccountError(error: DatabaseError) {
  if (isMissingTradingAccountSchema(error)) return { status: 503, code: 'MIGRATION_REQUIRED', message: 'Trading accounts are waiting for the latest database migration.', nextChangeAt: null as string | null };
  const message = String(error?.message || '');
  const timed = message.match(/(ACCOUNT_CHANGE_COOLDOWN|PRO_CHANGE_RATE_LIMIT):([^\s]+)/);
  if (timed) {
    return {
      status: 409,
      code: timed[1],
      message: timed[1] === 'ACCOUNT_CHANGE_COOLDOWN'
        ? 'Standard membership can replace a real account once every 7 days.'
        : 'For account security, Pro membership allows two self-service replacements in 24 hours.',
      nextChangeAt: timed[2],
    };
  }
  const known: Record<string, { status: number; message: string }> = {
    REAL_ACCOUNT_CHANGE_REQUIRES_LIFETIME: { status: 403, message: 'Your registered real account is fixed. Self-service account replacement is available only with Lifetime.' },
    ACCOUNT_ALREADY_REGISTERED: { status: 409, message: 'This real account is already registered to another Orion client.' },
    ADMIN_OVERRIDE_REASON_REQUIRED: { status: 400, message: 'Enter an override reason of at least 10 characters.' },
    NO_ACTIVE_LICENSE: { status: 409, message: 'An active license for this platform is required before registration.' },
    CLIENT_NOT_ACTIVE: { status: 409, message: 'This Orion client account is not active.' },
    CLIENT_NOT_FOUND: { status: 404, message: 'The linked Orion client account was not found.' },
    ADMIN_ACCESS_REQUIRED: { status: 403, message: 'Administrator access is required.' },
    REQUEST_ID_CONFLICT: { status: 409, message: 'This request identifier was already used.' },
  };
  const code = Object.keys(known).find((key) => message.includes(key));
  if (code) return { ...known[code], code, nextChangeAt: null as string | null };
  if (error?.code === '23505') return { status: 409, code: 'ACCOUNT_CONFLICT', message: 'The real account could not be registered because it conflicts with an existing account.', nextChangeAt: null as string | null };
  return { status: 500, code: 'ACCOUNT_CHANGE_FAILED', message: 'The real account could not be changed. Your existing binding was preserved.', nextChangeAt: null as string | null };
}
