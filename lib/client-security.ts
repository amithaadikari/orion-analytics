import { getClientIp, hashIp } from '@/lib/rate-limit';
import { geoFromRequest, sanitizeString } from '@/lib/security';

export const accountSecurityEvents = {
  session_started: {
    title: 'New sign-in recorded',
    detail: 'A successful Orion account session was opened.',
    notification: 'A successful sign-in was recorded for your Orion account.',
  },
  password_changed: {
    title: 'Password changed',
    detail: 'Your Orion account password was updated.',
    notification: 'Your Orion account password was changed.',
  },
  mfa_enabled: {
    title: 'Authenticator protection enabled',
    detail: 'A verified authenticator was added to your account.',
    notification: 'Authenticator MFA is now active on your Orion account.',
  },
  mfa_disabled: {
    title: 'Authenticator protection removed',
    detail: 'A verified authenticator was removed from your account.',
    notification: 'Authenticator MFA was removed from your Orion account.',
  },
  other_sessions_signed_out: {
    title: 'Other sessions signed out',
    detail: 'Refresh access was revoked for your other Orion sessions.',
    notification: 'Other signed-in devices were removed from your Orion account.',
  },
} as const;

export type AccountSecurityEventName = keyof typeof accountSecurityEvents;

type DeviceDetails = {
  browser: string;
  os: string;
  device: string;
  country: string | null;
  ipHash: string;
};

export function securityDeviceFromRequest(request: Request): DeviceDetails {
  const userAgent = request.headers.get('user-agent') || '';
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /OPR\//i.test(userAgent) ? 'Opera'
      : /Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent) ? 'Chrome'
        : /Firefox\//i.test(userAgent) ? 'Firefox'
          : /Safari\//i.test(userAgent) && /Version\//i.test(userAgent) ? 'Safari'
            : 'Unknown browser';
  const os = /iPhone|iPad|iPod/i.test(userAgent) ? 'iOS'
    : /Android/i.test(userAgent) ? 'Android'
      : /Windows NT/i.test(userAgent) ? 'Windows'
        : /Mac OS X|Macintosh/i.test(userAgent) ? 'macOS'
          : /Linux/i.test(userAgent) ? 'Linux'
            : 'Unknown OS';
  const device = /iPad|Tablet/i.test(userAgent) ? 'Tablet'
    : /Mobi|iPhone|Android/i.test(userAgent) ? 'Mobile'
      : 'Desktop';
  const country = sanitizeString(geoFromRequest(request).country, 3)?.toUpperCase() || null;
  return { browser, os, device, country, ipHash: hashIp(getClientIp(request)) };
}

export function securityDeviceLabel(row: { browser?: unknown; os?: unknown; device?: unknown; country?: unknown }) {
  return [row.device, row.browser, row.os, row.country]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' · ') || 'Device details unavailable';
}

export function isExactSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export function isMissingAccountSecurityRelation(error: { code?: string; message?: string } | null | undefined) {
  const code = error?.code?.toUpperCase();
  const message = error?.message?.toLowerCase() || '';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const namesSecurityObject = message.includes('client_security_events')
    || message.includes('client_account_preferences')
    || message.includes('record_client_security_event_atomic');
  const explicitlyMissing = message.includes('does not exist')
    || (message.includes('schema cache') && (message.includes('could not find') || message.includes('not find')));
  return namesSecurityObject && explicitlyMissing;
}

type SecurityBucket = { count: number; resetAt: number };
const securityBuckets = new Map<string, SecurityBucket>();

/** Best-effort instance limiter. Production edge-wide throttling should also be enabled. */
export function accountSecurityRateLimit(request: Request, userId: string) {
  const now = Date.now();
  if (securityBuckets.size > 2_000) {
    for (const [key, bucket] of securityBuckets) if (bucket.resetAt <= now) securityBuckets.delete(key);
  }
  const key = `${userId}:${hashIp(getClientIp(request))}`;
  const current = securityBuckets.get(key);
  if (!current || current.resetAt <= now) {
    securityBuckets.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 8;
}
