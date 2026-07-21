# Orion V5.3 Demo and installation pairing

## Product rules

- Every Real and Demo session requires an active Orion license and one active installation seat.
- The license plan returned by Orion is authoritative. Basic, Premium, and Lifetime enable only their corresponding EA features on both Real and Demo accounts.
- Real identity remains client-wide and uses the existing verified Real-account workflow.
- Demo identity is registered per license and matches the exact login, broker server, and MetaTrader platform.
- Standard membership can replace a Demo identity once every seven days.
- Active Pro membership can replace a Demo identity twice in a rolling 24-hour window.
- Every license has one active installation ID. A client can replace it twice in a rolling 24-hour window; a successful replacement revokes the old installation immediately.
- An administrator can perform an audited emergency installation reset. The client must then pair the new installation from the portal.
- Strategy Tester and Contest accounts remain unsupported.

## Pairing flow

1. The client downloads and attaches Orion V5.3 to MetaTrader.
2. The EA creates an opaque `ORN-INST-...` identifier inside that terminal's private Files sandbox and shows it in the Experts log.
3. The client signs in with MFA, selects the license in the License Pairing Center, and submits that Installation ID.
4. The server normalizes and hashes the ID. PostgreSQL stores only its SHA-256 hash and a short display hint.
5. Demo users also register the exact Demo login and broker server against the selected license.
6. The EA sends the license key, account identity/type, and installation ID to `/api/license/validate`. The route hashes both secrets before calling PostgreSQL.
7. PostgreSQL returns the license's stored plan only after the license, client, platform, account binding, and installation binding all match.

The server never auto-claims a license from the first EA validation. Pairing requires the authenticated portal, so a copied EA file and license key running on another normal installation receives `INSTALLATION_MISMATCH`.

## Validation request

```json
{
  "licenseKey": "ORN-XXXX-XXXX-XXXX-XXXX",
  "accountNumber": "12345678",
  "brokerServer": "Broker-Demo",
  "platform": "MT5",
  "accountType": "Demo",
  "installationId": "ORN-INST-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
}
```

The endpoint is strict: missing or additional fields return `INVALID_REQUEST`.

## Definitive denials

- `INVALID_LICENSE`
- `LICENSE_INACTIVE`
- `ACCOUNT_NOT_REGISTERED`
- `ACCOUNT_MISMATCH`
- `DEMO_ACCOUNT_NOT_REGISTERED`
- `DEMO_ACCOUNT_MISMATCH`
- `INSTALLATION_NOT_REGISTERED`
- `INSTALLATION_MISMATCH`

Transport failures use the EA's bounded grace period only after a successful validation for the exact same license, login, server, account type, and installation ID. A definitive denial never inherits grace.

## Deployment order

1. Compile and upload the V5.3 `.ex5` to the private Release Center as a Draft. Do not promote it until the cutover window.
2. Announce a short licensing maintenance window. The final API intentionally rejects the older four-field request, and V5.2 cannot be secured because its Demo path is local and keyless.
3. Apply `supabase/migrations/20260801_demo_license_installation_seats.sql` in Supabase.
4. Deploy the Next.js application and verify `/api/license/validate` is available without exposing a Vercel login page.
5. Immediately publish/promote V5.3, retire V5.2, and ask clients to download V5.3.
6. Each client registers Demo details where needed and pairs the Installation ID shown by V5.3. Real users must pair an installation too.

Do not deploy the strict six-field validator until the compiled V5.3 release is ready. Deploying it earlier immediately blocks V5.1/V5.2 validation and creates avoidable downtime.

Applying source code does not apply the Supabase migration, and applying the migration does not deploy Vercel. Verify both separately.

## Security boundary

No DLL-free MQL design can provide an unforgeable hardware identity. A determined user could deliberately copy both the installation-state file and the exact broker credentials. Orion prevents ordinary EX5/key sharing by requiring the independently paired terminal ID and exact account identity, rate-limiting replacements, and revoking the old seat. Additional legitimate simultaneous seats require another license.
