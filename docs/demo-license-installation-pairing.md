# Orion V5.1 secure Demo and installation pairing

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

1. The client downloads and attaches the secure Orion V5.1 build to MetaTrader, then enters the matching license key.
2. The EA creates an opaque `ORN-INST-...` identifier in that terminal's private Files sandbox and sends a pending device-approval request to Orion.
3. The EA displays a six-digit approval code. The EA remains blocked while the request is pending.
4. The client opens the authenticated Orion portal with MFA. Real users must already have the exact verified Real identity; Demo users must register the exact Demo login and broker server for the selected license.
5. The License Pairing Center shows the pending device and its six-digit code. The client compares both codes and approves only when they match exactly.
6. Orion activates that installation. If this is a replacement, the previous installation stops validating immediately and the normal replacement limit still applies.
7. The EA checks the approval status and then calls `/api/license/validate`. PostgreSQL returns the license's stored plan only after the license, client, platform, account binding, and installation binding all match.

The EA request creates only a pending record; it never auto-claims a license or installation seat. Activation requires an authenticated portal approval with the matching six-digit code, so a copied EA file and license key cannot silently replace the client's approved installation.

## Advanced Recovery: manual Installation ID

Automatic approval is the normal setup path. If the pending request cannot be recovered, the client can open **License Pairing Center → Advanced Recovery**, select the correct license, and enter the complete `ORN-INST-...` value shown in the EA's Experts log.

Manual recovery does not bypass any security rule. Real and Demo identity requirements remain exact, only one installation can be active per license, installation replacements remain limited to two per rolling 24 hours, and a successful replacement immediately deactivates the previous installation.

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

1. Compile the updated secure V5.1 `.ex5`, confirm zero errors, and upload it to the private Release Center as a Draft.
2. Apply `supabase/migrations/20260801_demo_license_installation_seats.sql` only if it is not already active, then apply `supabase/migrations/20260802_pending_installation_approvals.sql`.
3. Deploy the Next.js application and verify the public device-request, approval-status, and `/api/license/validate` endpoints are available without exposing a Vercel login page.
4. Use the Draft on a registered Demo identity to verify request creation, the same six-digit code in MT5 and the portal, MFA approval, and the subsequent normal license validation.
5. Publish the updated V5.1 release and ask clients to download it. Each client registers the required exact Real or Demo identity, compares the code, and approves the pending device. Manual Installation ID pairing remains available only under Advanced Recovery.

The automatic request layer is additive to the existing secure V5.1 validator and manual Installation ID flow, so the database and web application can be activated before the updated EA is published.

Applying source code does not apply the Supabase migration, and applying the migration does not deploy Vercel. Verify both separately.

## Security boundary

No DLL-free MQL design can provide an unforgeable hardware identity. A determined user could deliberately copy both the installation-state file and the exact broker credentials. Orion prevents ordinary EX5/key sharing by requiring the independently paired terminal ID and exact account identity, rate-limiting replacements, and revoking the old seat. Additional legitimate simultaneous seats require another license.
