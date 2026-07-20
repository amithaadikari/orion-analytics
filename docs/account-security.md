# Account security activation

The Orion account-security release adds password management, authenticator MFA,
security activity, session revocation, and a client-controlled license-reminder
preference. Complete the steps below before inviting clients to enable MFA.

## 1. Apply the database migration

Run `supabase/migrations/20260727_client_account_security.sql` in the Supabase
SQL editor. Apply it before enabling the new settings page in production so the
database-level AAL policies are active when a client enrolls an authenticator.

The migration is designed to be idempotent. It creates forward-only security
activity and preference tables, tightens authenticated read policies, and does
not store raw IP addresses, full user-agent strings, passwords, one-time codes,
or authenticator secrets.

The existing protected `scripts/visitor-deletion.ts` retention job also deletes
client security events older than 180 days. Keep that job scheduled with the
service role to enforce the documented security-event retention period.

## 2. Verify Supabase Auth settings

In Authentication settings:

- Keep email/password sign-in enabled.
- Keep email confirmation and Secure Email Change enabled.
- Enable TOTP enrollment and TOTP verification under Multi-Factor Authentication.
- Enable Secure Password Change (and the current-password requirement if it is
  available for the project).
- Set the Site URL to `https://app.orionscalper.com`.
- Allow the exact callback URL
  `https://app.orionscalper.com/auth/callback`. Add preview callbacks only for
  controlled preview environments.
- Configure custom SMTP before production client use. Supabase's default mailer
  is intended for testing and has delivery restrictions.
- Enable Supabase security emails for password, email, and MFA-factor changes.
  Orion treats these alerts as essential and does not expose an opt-out.

The password rules shown in Orion must remain aligned with the Supabase project
password policy.

## 3. Test the assurance flow

Use a non-production client account and verify all of the following:

1. Sign in without MFA and open `/portal/settings`.
2. Enroll a TOTP authenticator, scan the QR code, and verify a six-digit code.
3. Sign out locally and sign in again. The app must stop at `/mfa` before the
   portal opens.
4. Confirm a wrong or expired code cannot open `/portal`, `/checkout`, an invoice,
   a receipt, a protected download, a client API, or the admin dashboard.
5. Confirm a valid code promotes the session to AAL2 and returns only to a safe
   internal destination.
6. Confirm ordinary **Log out** ends only the current browser session, while
   **Sign out other devices** keeps the current session active.
7. Change the password using the configured current-password or email nonce flow.
8. Disable license-reminder email and verify the reminder job still updates an
   expired license but skips only the optional reminder email.

## 4. Lost-authenticator recovery

Supabase TOTP does not currently provide recovery codes through the JavaScript
client used by Orion. If a client loses every enrolled authenticator, do not
remove the factor based only on an email or chat request.

An approved owner should verify the client's identity using the organization's
documented support process, record the administrative action, then remove the
verified factor through the Supabase administrator MFA controls. Ask the client
to sign in, enroll a new authenticator immediately, and confirm the new factor
before closing the recovery ticket.

## Operational notes

- Orion security activity begins when this release is applied; it does not
  invent or backfill older device history.
- **Sign out other devices** revokes other refresh tokens. Already-issued access
  tokens can remain valid until their configured JWT expiry.
- The application stores only normalized browser, operating-system, device, and
  country labels plus a salted IP hash for security-event correlation.
- Supabase Auth Audit Logs remain the authoritative operator-side authentication
  record.
