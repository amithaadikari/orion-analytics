# Deployment guide

1. Run the Supabase migration in `supabase/migrations/20260715_orion_analytics.sql`.
2. Create an Auth email/password user and add its UUID to `public.admins`.
3. Create a Vercel project with `analytics` as the root directory.
4. Add all `.env.example` values to Preview and Production. Set `TRACKING_ALLOWED_ORIGINS` to the exact published Framer origin.
5. Deploy, open `/login`, and verify the approved user can reach the dashboard.
6. Use the deployed HTTPS origin as `apiBase` in Framer and republish the landing page.

Never put `SUPABASE_SERVICE_ROLE_KEY`, `META_ACCESS_TOKEN`, `IP_HASH_SALT` or `CONVERSION_INTERNAL_SECRET` in Framer or `NEXT_PUBLIC_*` variables.
