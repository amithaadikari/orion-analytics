# Secure EA Release Center

Orion release files are stored privately and are delivered only through the authenticated client download gateway. A client must have an active Orion account, the same plan as an active non-expired license, and a matching MT4 or MT5 license for the current release channel.

## Activate the release center

1. Apply `supabase/migrations/20260729_secure_ea_release_center.sql` in the Supabase SQL editor after all earlier migrations.
2. Confirm the Vercel project has the server-only `SUPABASE_SERVICE_ROLE_KEY` and the existing public Supabase URL and anon key.
3. Sign in as an administrator with the required account assurance, open **Releases**, and create a private draft.
4. Upload an `.ex4`, `.ex5`, or `.zip` file no larger than 50 MB. A release for **Both** platforms must be a `.zip` package.
5. Wait for the server-side size, type, and SHA-256 integrity verification to finish.
6. Review the release notes, then explicitly publish. Publishing moves the appropriate MT4 and/or MT5 channel atomically and can create one deduplicated client notification per eligible client.

The first authorized upload creates or updates the private `orion-ea-releases` Storage bucket. Do not add public read policies, do not expose a service-role key to the browser, and do not change the bucket to public.

## Release workflow

- **Draft:** metadata can be edited and the private package can be replaced.
- **Verified:** the package exists in private storage and has passed integrity checks, but clients cannot access it.
- **Current:** the release is assigned to an MT4 and/or MT5 channel. Only current-channel packages are downloadable.
- **Restore:** selecting an older published version repoints the channel without deleting newer history.
- **Archive:** removes a non-current version from release candidates while preserving its audit history. A current version cannot be archived.
- **Delete draft:** permanently removes only an unused draft that has never been published or requested.

Download activity records when protected delivery begins; it does not claim that the client finished downloading the file.

## Production verification

1. Create and verify a test draft without publishing it. Confirm it does not appear in a client portal.
2. Publish it for one platform and confirm only a client with the matching active license can see and request it.
3. Confirm an expired, suspended, mismatched-platform, or mismatched-plan client is denied.
4. Publish a newer test version, then restore the older one and confirm new requests use the restored channel.
5. Confirm the client notification appears once and the admin delivery metrics increase after a permitted request.
6. Confirm neither API responses nor client HTML contain the private Storage path or a signed download URL.

Legacy HTTPS release URLs remain supported through the protected proxy only when their exact hostname is present in `PRODUCT_DOWNLOAD_HOSTS`. Migrate legacy releases to private uploads when practical.
