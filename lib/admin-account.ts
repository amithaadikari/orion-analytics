import { clientAvatarKeys, normalizeClientAvatar, type ClientAvatarKey } from '@/lib/client-profile';

export type AdminDashboardTheme = 'royal' | 'black';

export type AdminProfile = {
  displayName: string;
  avatarKey: ClientAvatarKey;
};

export type AdminAlertPreferences = {
  registrationAlerts: boolean;
  paymentAlerts: boolean;
  licenseAlerts: boolean;
  supportAlerts: boolean;
};

export type AdminAccountPreferences = AdminAlertPreferences & {
  theme: AdminDashboardTheme;
};

export const adminAvatarKeys = clientAvatarKeys;

export function defaultAdminDisplayName(email?: string | null) {
  if (!email) return 'Orion Administrator';
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const readable = local.split(/\s+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  return readable.length >= 2 ? readable.slice(0, 80) : 'Orion Administrator';
}

export function normalizeAdminTheme(value: unknown): AdminDashboardTheme {
  return value === 'black' ? 'black' : 'royal';
}

export function readAdminProfile(row: Record<string, unknown> | null | undefined, email?: string | null): AdminProfile {
  const savedName = typeof row?.display_name === 'string' ? row.display_name.trim().slice(0, 80) : '';
  return {
    displayName: savedName.length >= 2 ? savedName : defaultAdminDisplayName(email),
    avatarKey: normalizeClientAvatar(row?.avatar_key),
  };
}

export function readAdminPreferences(row: Record<string, unknown> | null | undefined): AdminAccountPreferences {
  return {
    theme: normalizeAdminTheme(row?.dashboard_theme),
    registrationAlerts: row?.registration_alerts !== false,
    paymentAlerts: row?.payment_alerts !== false,
    licenseAlerts: row?.license_alerts !== false,
    supportAlerts: row?.support_alerts !== false,
  };
}

export function isMissingAdminAccountRelation(error: { code?: string; message?: string } | null | undefined) {
  const code = error?.code?.toUpperCase();
  const message = error?.message?.toLowerCase() || '';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const namesObject = message.includes('admin_account_preferences')
    || message.includes('admin_account_events')
    || message.includes('record_admin_account_event_atomic');
  const missing = message.includes('does not exist')
    || (message.includes('schema cache') && (message.includes('could not find') || message.includes('not find')));
  return namesObject && missing;
}
