export type AccountSecurityEvent =
  | 'session_started'
  | 'password_changed'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'other_sessions_signed_out';

export async function recordAccountSecurityEvent(event: AccountSecurityEvent) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch('/api/account-security', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}
