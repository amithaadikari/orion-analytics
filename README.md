# Orion Analytics

Private Next.js dashboard and server-side tracking service for the Orion Gold Scalper Framer landing page.

## What is included

- Supabase Auth with an approved-admin allow-list.
- RLS-protected visitors, sessions, events, leads and admins tables.
- Server-only tracking endpoints with Zod validation, payload limits, rate limiting and no raw IP storage.
- A fixed-destination `/api/join` redirect that records Telegram clicks and sends a Meta Conversions API `Lead` event.
- Framer-ready first-party visitor script, consent handling and Meta Pixel snippet.
- Dark Orion dashboard with overview, visitors, campaigns, events, Meta Events and settings views.
- Retention utility, seed data, unit tests and deployment guides.

## Local setup

```bash
cd analytics
npm install
cp .env.example .env.local
npm run typecheck
npm test
npm run dev
```

Open `http://localhost:3000/login`. Create an email/password user in Supabase Auth, then insert that user's UUID into `public.admins` (see the migration and seed file). The service-role key is only read by server route handlers.

## Supabase setup

1. Create a Supabase project.
2. Run the files in `supabase/migrations` in timestamp order. Existing projects should apply the latest `20260724_orion_command_suite.sql` migration before enabling the new Action Center, Revenue Intelligence, Client 360, notification, support, and protected-download features.
3. Enable email/password in Authentication → Providers.
4. Create the first admin user, copy its Auth UUID, and insert it into `public.admins` with role `admin`.
5. Put the project URL, anon key and service-role key in `.env.local` / Vercel Environment Variables.

The public Framer page never talks directly to Supabase. It only calls the rate-limited Next.js routes, and public roles have no read or insert policies.

## Framer installation

1. Deploy this app and use its HTTPS URL as `apiBase`.
2. In Framer Project Settings → Custom Code → End of body, paste `public/framer-tracking.js` after setting:

```html
<script>
  window.ORION_ANALYTICS_CONFIG = {
    apiBase: 'https://analytics.example.com',
    joinEndpoint: 'https://analytics.example.com/api/join',
    requireConsent: true
  };
</script>
<script src="https://analytics.example.com/framer-tracking.js"></script>
```

`TRACKING_ALLOWED_ORIGINS` must contain the exact published Framer origin (comma-separate additional approved origins); tracking routes reject browser origins that are not listed.

3. Paste `public/meta-pixel.js` beneath it with the real `META_PIXEL_ID` substituted. Never put `META_ACCESS_TOKEN` in Framer.
4. Paste `public/consent-banner.html` if consent is legally required for your audience. It defaults to disabled until the visitor chooses.
5. Existing Telegram links can stay as direct links. The script records `TelegramClick` and browser `Lead` events. For server-side redirect tracking, change a CTA URL to `https://analytics.example.com/api/join`; the destination is taken only from `TELEGRAM_CHANNEL_URL`.

The script stores only an anonymous visitor ID, session ID, campaign attribution and Meta cookies. It does not fingerprint, ask for names/emails, or collect Telegram usernames.

## Vercel deployment

1. Import the `analytics` directory as the Vercel project root.
2. Add every variable in `.env.example` for Preview and Production. Use a strong random `IP_HASH_SALT`. Set `PRODUCT_DOWNLOAD_HOSTS` to the exact comma-separated hostnames that may serve Orion release files; protected downloads reject every other host and redirect.
3. Set the production domain in the Framer script's `apiBase`.
4. Add the analytics domain to any Framer CSP or security policy you use.
5. Protect preview deployments or use a separate Supabase project; never use production service credentials in an unprotected preview.

## Meta verification

1. Add `META_PIXEL_ID`, `META_ACCESS_TOKEN`, `META_API_VERSION` and optionally `META_TEST_EVENT_CODE` in Vercel.
2. Open Meta Events Manager → Test events and copy the test code into the environment.
3. Visit the Framer page, accept consent and click a Telegram CTA.
4. Confirm the browser `Lead` and server `Lead` share one `event_id` and are deduplicated.
5. Remove `META_TEST_EVENT_CODE` after QA. `Purchase` is intentionally not emitted from the browser; send it only from an authenticated backend confirmation flow.

## Security and retention

- Supabase service-role and Meta access tokens are server-only.
- The join endpoint does not accept a destination parameter, preventing open redirects.
- Request bodies are capped and validated; rate limiting uses an HMAC-like salted IP hash in memory and never persists raw IPs.
- Vercel/Cloudflare location headers are used only for country/city enrichment.
- Run `npx tsx scripts/visitor-deletion.ts` from a protected scheduler using the service environment to enforce `DATA_RETENTION_DAYS`.
- Publish a privacy policy describing anonymous IDs, campaign parameters, Meta cookies, retention, consent and deletion requests.

## Commands

```bash
npm run dev       # local dashboard
npm run typecheck # TypeScript
npm test          # Vitest
npm run build     # production build
```
