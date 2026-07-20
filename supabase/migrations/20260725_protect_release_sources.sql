-- Release source URLs are server-only secrets. Client portal pages render safe
-- metadata through the authenticated Next.js server and stream files through
-- /api/downloads/:releaseId, so ordinary authenticated users do not need raw
-- SELECT access to product_releases.
drop policy if exists product_releases_authenticated_read on public.product_releases;
drop policy if exists product_releases_admin_read on public.product_releases;
create policy product_releases_admin_read on public.product_releases
  for select to authenticated
  using (public.is_approved_admin());

-- Support the exact current-release request lookup used by the activation
-- journey without scanning a client's full download history.
create index if not exists download_events_client_release_requested_idx
  on public.download_events (client_id, release_id, downloaded_at desc);
