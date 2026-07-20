-- Secure EA release delivery foundations. Private objects are managed only
-- through server-side Storage APIs; catalog tables are deliberately untouched.

alter table public.product_releases
  add column if not exists asset_status text not null default 'none',
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists original_filename text,
  add column if not exists file_size_bytes bigint,
  add column if not exists sha256 text,
  add column if not exists content_type text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists file_verified_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists promoted_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists publish_generation bigint not null default 0,
  add column if not exists created_by_auth_user_id uuid,
  add column if not exists create_idempotency_key uuid;

-- Avoid rewriting audit timestamps if this idempotent migration is replayed.
-- The trigger is restored after normalization and constraints are installed.
drop trigger if exists product_releases_updated_at on public.product_releases;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_releases_created_by_auth_user_fk'
      and conrelid = 'public.product_releases'::regclass
  ) then
    alter table public.product_releases
      add constraint product_releases_created_by_auth_user_fk
      foreign key (created_by_auth_user_id) references auth.users(id) on delete set null;
  end if;
end;
$$;

-- Normalize only values introduced by an interrupted/partial deployment. Old
-- URL-backed releases remain URL-backed and retain their full release history.
update public.product_releases
set download_url = nullif(btrim(download_url), ''),
    storage_bucket = nullif(btrim(storage_bucket), ''),
    storage_path = nullif(btrim(storage_path), ''),
    original_filename = nullif(btrim(original_filename), ''),
    content_type = nullif(lower(btrim(content_type)), ''),
    sha256 = nullif(lower(btrim(sha256)), ''),
    asset_status = case lower(coalesce(asset_status, 'none'))
      when 'none' then 'none'
      when 'pending' then 'pending'
      when 'ready' then 'ready'
      when 'failed' then 'failed'
      when 'withdrawn' then 'withdrawn'
      else 'failed'
    end,
    updated_at = coalesce(updated_at, created_at, released_at, now()),
    publish_generation = greatest(coalesce(publish_generation, 0), 0);

-- If a partially deployed row has both sources, prefer a fully verified private
-- object. Otherwise retain the working legacy URL and detach incomplete private
-- metadata without deleting any Storage object.
update public.product_releases
set download_url = null,
    updated_at = now()
where download_url is not null
  and storage_path is not null
  and storage_bucket = 'orion-ea-releases'
  and asset_status = 'ready'
  and original_filename is not null
  and file_size_bytes between 1 and 52428800
  and sha256 ~ '^[a-f0-9]{64}$'
  and content_type in (
    'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
  )
  and file_verified_at is not null;

update public.product_releases
set storage_bucket = null,
    storage_path = null,
    original_filename = null,
    file_size_bytes = null,
    sha256 = null,
    content_type = null,
    uploaded_at = null,
    file_verified_at = null,
    asset_status = case when archived_at is null then 'none' else 'withdrawn' end,
    updated_at = now()
where download_url is not null
  and storage_path is not null;

-- A half-populated Storage destination is never a usable source.
update public.product_releases
set storage_bucket = null,
    storage_path = null,
    original_filename = null,
    file_size_bytes = null,
    sha256 = null,
    content_type = null,
    uploaded_at = null,
    file_verified_at = null,
    asset_status = case when archived_at is null then 'failed' else 'withdrawn' end,
    updated_at = now()
where num_nonnulls(storage_bucket, storage_path) = 1;

-- Detach malformed private destinations left by an interrupted deployment. The
-- object itself is not deleted here; cleanup must go through the Storage API.
update public.product_releases
set storage_bucket = null,
    storage_path = null,
    original_filename = null,
    file_size_bytes = null,
    sha256 = null,
    content_type = null,
    uploaded_at = null,
    file_verified_at = null,
    asset_status = case when archived_at is null then 'failed' else 'withdrawn' end,
    published = false,
    promoted_at = null,
    updated_at = now()
where storage_path is not null
  and not coalesce((
    storage_bucket = 'orion-ea-releases'
    and storage_path ~* '^releases/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(ex4|ex5|zip)$'
    and split_part(storage_path, '/', 2) = id::text
  ), false);

-- A private source is Ready only after all server-verified delivery metadata is
-- present. Demotion preserves the row and object path while preventing publish.
update public.product_releases
set asset_status = case when archived_at is null then 'failed' else 'withdrawn' end,
    published = false,
    promoted_at = null,
    original_filename = case
      when original_filename = btrim(original_filename)
        and char_length(original_filename) between 1 and 180
        and position('/' in original_filename) = 0
        and position(E'\\' in original_filename) = 0
      then original_filename else null end,
    file_size_bytes = case
      when file_size_bytes between 1 and 52428800 then file_size_bytes else null end,
    sha256 = case when sha256 ~ '^[a-f0-9]{64}$' then sha256 else null end,
    content_type = case
      when content_type in (
        'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
      ) then content_type else null end,
    updated_at = now()
where storage_path is not null
  and asset_status = 'ready'
  and not coalesce((
    original_filename is not null
    and original_filename = btrim(original_filename)
    and char_length(original_filename) between 1 and 180
    and position('/' in original_filename) = 0
    and position(E'\\' in original_filename) = 0
    and file_size_bytes between 1 and 52428800
    and sha256 ~ '^[a-f0-9]{64}$'
    and content_type in (
      'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
    )
    and file_verified_at is not null
  ), false);

-- Normalize metadata on non-ready partial rows too, so the migration can add
-- strict column constraints without trusting interrupted deployment values.
update public.product_releases
set original_filename = case
      when original_filename = btrim(original_filename)
        and char_length(original_filename) between 1 and 180
        and position('/' in original_filename) = 0
        and position(E'\\' in original_filename) = 0
      then original_filename else null end,
    file_size_bytes = case
      when file_size_bytes between 1 and 52428800 then file_size_bytes else null end,
    sha256 = case when sha256 ~ '^[a-f0-9]{64}$' then sha256 else null end,
    content_type = case
      when content_type in (
        'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
      ) then content_type else null end,
    updated_at = now()
where storage_path is not null;

update public.product_releases
set asset_status = 'withdrawn',
    published = false,
    updated_at = now()
where archived_at is not null;

-- Preserve valid legacy publications, but safely return any source-less or
-- incompletely verified historical publication to draft state before adding
-- the source-readiness constraints.
update public.product_releases
set published = false,
    promoted_at = null,
    updated_at = now()
where published = true
  and (
    archived_at is not null
    or not coalesce((
      nullif(btrim(download_url), '') is not null
      or (
        asset_status = 'ready'
        and storage_bucket = 'orion-ea-releases'
        and storage_path is not null
        and original_filename is not null
        and file_size_bytes between 1 and 52428800
        and sha256 ~ '^[a-f0-9]{64}$'
        and content_type in (
          'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
        )
        and file_verified_at is not null
      )
    ), false)
  );

update public.product_releases
set published_at = coalesce(published_at, released_at, created_at, now()),
    promoted_at = coalesce(promoted_at, published_at, released_at, created_at, now()),
    publish_generation = greatest(publish_generation, 1),
    updated_at = coalesce(updated_at, now())
where published = true;

alter table public.product_releases
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column publish_generation set default 0,
  alter column publish_generation set not null;

alter table public.product_releases drop constraint if exists product_releases_asset_status_check;
alter table public.product_releases add constraint product_releases_asset_status_check
  check (asset_status in ('none', 'pending', 'ready', 'failed', 'withdrawn'));

alter table public.product_releases drop constraint if exists product_releases_source_exclusive_check;
alter table public.product_releases add constraint product_releases_source_exclusive_check
  check (num_nonnulls(nullif(btrim(download_url), ''), storage_path) <= 1);

alter table public.product_releases drop constraint if exists product_releases_storage_pair_check;
alter table public.product_releases add constraint product_releases_storage_pair_check
  check ((storage_bucket is null) = (storage_path is null));

alter table public.product_releases drop constraint if exists product_releases_storage_bucket_check;
alter table public.product_releases add constraint product_releases_storage_bucket_check
  check (storage_bucket is null or storage_bucket = 'orion-ea-releases');

alter table public.product_releases drop constraint if exists product_releases_storage_path_check;
alter table public.product_releases add constraint product_releases_storage_path_check
  check (
    storage_path is null
    or (
      storage_path ~* '^releases/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(ex4|ex5|zip)$'
      and split_part(storage_path, '/', 2) = id::text
    )
  );

alter table public.product_releases drop constraint if exists product_releases_original_filename_check;
alter table public.product_releases add constraint product_releases_original_filename_check
  check (
    original_filename is null
    or (
      original_filename = btrim(original_filename)
      and char_length(original_filename) between 1 and 180
      and position('/' in original_filename) = 0
      and position(E'\\' in original_filename) = 0
    )
  );

alter table public.product_releases drop constraint if exists product_releases_file_size_check;
alter table public.product_releases add constraint product_releases_file_size_check
  check (file_size_bytes is null or file_size_bytes between 1 and 52428800);

alter table public.product_releases drop constraint if exists product_releases_sha256_check;
alter table public.product_releases add constraint product_releases_sha256_check
  check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$');

alter table public.product_releases drop constraint if exists product_releases_content_type_check;
alter table public.product_releases add constraint product_releases_content_type_check
  check (content_type is null or content_type in (
    'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
  ));

alter table public.product_releases drop constraint if exists product_releases_publish_generation_check;
alter table public.product_releases add constraint product_releases_publish_generation_check
  check (publish_generation >= 0);

alter table public.product_releases drop constraint if exists product_releases_published_not_archived_check;
alter table public.product_releases add constraint product_releases_published_not_archived_check
  check (not published or archived_at is null);

alter table public.product_releases drop constraint if exists product_releases_archived_status_check;
alter table public.product_releases add constraint product_releases_archived_status_check
  check (archived_at is null or asset_status = 'withdrawn');

alter table public.product_releases drop constraint if exists product_releases_published_source_ready_check;
alter table public.product_releases add constraint product_releases_published_source_ready_check
  check (
    not published
    or nullif(btrim(download_url), '') is not null
    or coalesce((
      asset_status = 'ready'
      and storage_bucket = 'orion-ea-releases'
      and storage_path is not null
      and original_filename is not null
      and file_size_bytes between 1 and 52428800
      and sha256 ~ '^[a-f0-9]{64}$'
      and content_type in (
        'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
      )
      and file_verified_at is not null
    ), false)
  );

-- Remove every legacy one-column UNIQUE constraint on version, regardless of
-- the generated constraint name, then enforce version uniqueness per platform
-- without case sensitivity.
do $$
declare
  constraint_row record;
  version_attnum smallint;
begin
  select attnum::smallint into version_attnum
  from pg_attribute
  where attrelid = 'public.product_releases'::regclass
    and attname = 'version'
    and not attisdropped;

  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.product_releases'::regclass
      and contype = 'u'
      and array_length(conkey, 1) = 1
      and conkey[1] = version_attnum
  loop
    execute format('alter table public.product_releases drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

create unique index if not exists product_releases_version_platform_ci_uidx
  on public.product_releases (lower(version), lower(platform));
create unique index if not exists product_releases_storage_source_uidx
  on public.product_releases (storage_bucket, storage_path)
  where storage_path is not null;
create unique index if not exists product_releases_create_idempotency_uidx
  on public.product_releases (created_by_auth_user_id, create_idempotency_key)
  where created_by_auth_user_id is not null and create_idempotency_key is not null;
create index if not exists product_releases_delivery_state_idx
  on public.product_releases (published, archived_at, platform, promoted_at desc);

drop trigger if exists product_releases_updated_at on public.product_releases;
create trigger product_releases_updated_at
  before update on public.product_releases
  for each row execute function public.set_updated_at();

create table if not exists public.product_release_uploads (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.product_releases(id) on delete cascade,
  admin_id uuid references public.admins(id) on delete set null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  expected_size_bytes bigint not null,
  expected_content_type text not null,
  expected_sha256 text,
  status text not null default 'Pending',
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_release_uploads_status_check
    check (status in ('Pending', 'Ready', 'Failed', 'Expired')),
  constraint product_release_uploads_bucket_check
    check (storage_bucket = 'orion-ea-releases'),
  constraint product_release_uploads_path_check check (
    storage_path ~* '^releases/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(ex4|ex5|zip)$'
    and split_part(storage_path, '/', 2) = release_id::text
  ),
  constraint product_release_uploads_filename_check check (
    original_filename = btrim(original_filename)
    and char_length(original_filename) between 1 and 180
    and position('/' in original_filename) = 0
    and position(E'\\' in original_filename) = 0
  ),
  constraint product_release_uploads_size_check
    check (expected_size_bytes between 1 and 52428800),
  constraint product_release_uploads_content_type_check check (
    expected_content_type in (
      'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
    )
  ),
  constraint product_release_uploads_sha256_check
    check (expected_sha256 is null or expected_sha256 ~ '^[a-f0-9]{64}$'),
  constraint product_release_uploads_expiry_check check (expires_at > created_at),
  constraint product_release_uploads_ready_finalized_check
    check (status <> 'Ready' or finalized_at is not null)
);

create unique index if not exists product_release_uploads_storage_uidx
  on public.product_release_uploads (storage_bucket, storage_path);
create unique index if not exists product_release_uploads_idempotency_uidx
  on public.product_release_uploads (release_id, auth_user_id, idempotency_key);
create unique index if not exists product_release_uploads_one_pending_per_release_uidx
  on public.product_release_uploads (release_id)
  where status = 'Pending';
create index if not exists product_release_uploads_expiry_idx
  on public.product_release_uploads (status, expires_at)
  where status = 'Pending';

create or replace function public.enforce_product_release_upload_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.release_id is distinct from old.release_id
    or new.admin_id is distinct from old.admin_id
    or new.auth_user_id is distinct from old.auth_user_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.original_filename is distinct from old.original_filename
    or new.expected_size_bytes is distinct from old.expected_size_bytes
    or new.expected_content_type is distinct from old.expected_content_type
    or new.expected_sha256 is distinct from old.expected_sha256
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'Release upload destination and expected metadata are immutable'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_product_release_upload_immutability()
  from public, anon, authenticated;

drop trigger if exists product_release_uploads_immutable on public.product_release_uploads;
create trigger product_release_uploads_immutable
  before update on public.product_release_uploads
  for each row execute function public.enforce_product_release_upload_immutability();

drop trigger if exists product_release_uploads_updated_at on public.product_release_uploads;
create trigger product_release_uploads_updated_at
  before update on public.product_release_uploads
  for each row execute function public.set_updated_at();

create table if not exists public.release_channels (
  platform text primary key,
  current_release_id uuid references public.product_releases(id) on delete restrict,
  promoted_by_auth_user_id uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  generation bigint not null default 0 check (generation >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_channels_platform_check check (platform in ('MT4', 'MT5'))
);

create index if not exists release_channels_current_release_idx
  on public.release_channels (current_release_id)
  where current_release_id is not null;

drop trigger if exists release_channels_updated_at on public.release_channels;
create trigger release_channels_updated_at
  before update on public.release_channels
  for each row execute function public.set_updated_at();

create table if not exists public.release_promotion_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  event_type text not null,
  platform text,
  release_id uuid not null references public.product_releases(id) on delete restrict,
  previous_release_id uuid references public.product_releases(id) on delete set null,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  publish_generation bigint not null check (publish_generation >= 0),
  notify_requested boolean not null default false,
  notified_clients integer not null default 0 check (notified_clients >= 0),
  created_at timestamptz not null default now(),
  constraint release_promotion_events_type_check
    check (event_type in ('Publish', 'Rollback', 'Archive')),
  constraint release_promotion_events_platform_check check (
    (event_type = 'Archive' and platform is null)
    or (event_type in ('Publish', 'Rollback') and platform in ('MT4', 'MT5'))
  )
);

create unique index if not exists release_promotion_events_generation_uidx
  on public.release_promotion_events (platform, release_id, publish_generation)
  where event_type in ('Publish', 'Rollback');
create index if not exists release_promotion_events_release_timeline_idx
  on public.release_promotion_events (release_id, created_at desc);
create index if not exists release_promotion_events_channel_timeline_idx
  on public.release_promotion_events (platform, created_at desc)
  where platform is not null;

alter table public.client_notifications
  add column if not exists release_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_notifications_release_fk'
      and conrelid = 'public.client_notifications'::regclass
  ) then
    alter table public.client_notifications
      add constraint client_notifications_release_fk
      foreign key (release_id) references public.product_releases(id) on delete set null;
  end if;
end;
$$;

create index if not exists client_notifications_release_timeline_idx
  on public.client_notifications (client_id, release_id, created_at desc)
  where release_id is not null;

insert into public.release_channels (platform)
values ('MT4'), ('MT5')
on conflict (platform) do nothing;

-- Seed each empty channel from the newest valid historical publication. A Both
-- release may become the starting current release for both channels.
with channel_candidates as (
  select channel.platform,
    (
      select release.id
      from public.product_releases as release
      where release.published = true
        and release.archived_at is null
        and release.platform in (channel.platform, 'Both')
      order by release.promoted_at desc nulls last,
        release.published_at desc nulls last,
        release.released_at desc,
        release.created_at desc,
        release.id desc
      limit 1
    ) as release_id
  from public.release_channels as channel
)
update public.release_channels as channel
set current_release_id = candidate.release_id,
    promoted_at = coalesce(release.promoted_at, release.published_at, release.released_at, release.created_at, now()),
    generation = greatest(channel.generation, 1),
    updated_at = now()
from channel_candidates as candidate
join public.product_releases as release on release.id = candidate.release_id
where channel.platform = candidate.platform
  and channel.current_release_id is null;

insert into public.release_promotion_events (
  event_type, platform, release_id, previous_release_id,
  actor_auth_user_id, publish_generation, notify_requested, notified_clients
)
select 'Publish', channel.platform, channel.current_release_id, null,
  null, release.publish_generation, false, 0
from public.release_channels as channel
join public.product_releases as release on release.id = channel.current_release_id
where channel.current_release_id is not null
on conflict do nothing;

alter table public.product_release_uploads enable row level security;
alter table public.release_channels enable row level security;
alter table public.release_promotion_events enable row level security;

-- Raw release sources and upload intents are server-only. The portal and admin
-- UI receive sanitized projections through service-role server routes.
drop policy if exists product_releases_authenticated_read on public.product_releases;
drop policy if exists product_releases_admin_read on public.product_releases;
revoke all on table public.product_releases from public, anon, authenticated;
revoke all on table public.product_release_uploads from public, anon, authenticated;
revoke all on table public.release_channels from public, anon, authenticated;
revoke all on table public.release_promotion_events from public, anon, authenticated;
grant all on table public.product_releases to service_role;
grant all on table public.product_release_uploads to service_role;
grant all on table public.release_channels to service_role;
grant all on table public.release_promotion_events to service_role;

create or replace function public.promote_product_release(
  p_release_id uuid,
  p_actor uuid,
  p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.product_releases%rowtype;
  target_platforms text[];
  changed_platforms text[] := array[]::text[];
  current_platform text;
  previous_release uuid;
  event_kind text;
  new_generation bigint;
  notification_count integer := 0;
  promotion_batch uuid := gen_random_uuid();
  all_current boolean;
  private_source_ready boolean;
  legacy_source_ready boolean;
begin
  if p_actor is null or not exists (
    select 1 from public.admins
    where user_id = p_actor and role = 'admin'
  ) then
    raise exception 'An approved administrator actor is required' using errcode = '42501';
  end if;

  select * into target
  from public.product_releases
  where id = p_release_id
  for update;

  if not found then
    raise exception 'Release not found' using errcode = 'P0002';
  end if;

  private_source_ready := coalesce(
    target.storage_bucket = 'orion-ea-releases'
      and target.storage_path is not null
      and target.original_filename is not null
      and target.file_verified_at is not null
      and target.file_size_bytes between 1 and 52428800
      and target.sha256 ~ '^[a-f0-9]{64}$'
      and target.content_type in (
        'application/octet-stream', 'application/zip', 'application/x-zip-compressed'
      )
      and (
        target.asset_status = 'ready'
        or (target.asset_status = 'withdrawn' and target.archived_at is not null)
      ),
    false
  );
  legacy_source_ready := coalesce(nullif(btrim(target.download_url), '') is not null, false);

  if not private_source_ready and not legacy_source_ready then
    raise exception 'Release source is not ready and verified' using errcode = '23514';
  end if;

  target_platforms := case target.platform
    when 'MT4' then array['MT4']::text[]
    when 'MT5' then array['MT5']::text[]
    when 'Both' then array['MT4', 'MT5']::text[]
    else null
  end;
  if target_platforms is null then
    raise exception 'Release platform is invalid' using errcode = '22023';
  end if;

  insert into public.release_channels (platform)
  select unnest(target_platforms)
  on conflict (platform) do nothing;

  perform 1
  from public.release_channels
  where platform = any(target_platforms)
  order by platform
  for update;

  select bool_and(coalesce(current_release_id = target.id, false))
    into all_current
  from public.release_channels
  where platform = any(target_platforms);

  if coalesce(all_current, false)
    and target.published = true
    and target.archived_at is null
  then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'eventType', null,
      'releaseId', target.id,
      'generation', target.publish_generation,
      'channels', to_jsonb(target_platforms),
      'notified', 0
    );
  end if;

  event_kind := case when target.published_at is null then 'Publish' else 'Rollback' end;
  new_generation := target.publish_generation + 1;

  update public.product_releases
  set published = true,
      asset_status = case when storage_path is not null then 'ready' else 'none' end,
      archived_at = null,
      published_at = coalesce(published_at, now()),
      promoted_at = now(),
      publish_generation = new_generation,
      updated_at = now()
  where id = target.id
  returning * into target;

  for current_platform in
    select platform
    from public.release_channels
    where platform = any(target_platforms)
    order by platform
  loop
    select current_release_id into previous_release
    from public.release_channels
    where platform = current_platform;

    if previous_release is distinct from target.id then
      update public.release_channels
      set current_release_id = target.id,
          promoted_by_auth_user_id = p_actor,
          promoted_at = now(),
          generation = generation + 1,
          updated_at = now()
      where platform = current_platform;

      changed_platforms := array_append(changed_platforms, current_platform);

      insert into public.release_promotion_events (
        batch_id, event_type, platform, release_id, previous_release_id,
        actor_auth_user_id, publish_generation, notify_requested, notified_clients
      ) values (
        promotion_batch, event_kind, current_platform, target.id, previous_release,
        p_actor, new_generation, coalesce(p_notify, true), 0
      );
    end if;
  end loop;

  if coalesce(p_notify, true) and cardinality(changed_platforms) > 0 then
    insert into public.client_notifications (
      client_id, release_id, kind, title, message, href, dedupe_key
    )
    select eligible.client_id,
      target.id,
      'Release',
      case event_kind
        when 'Rollback' then 'Approved Orion EA version restored'
        else 'New Orion EA release'
      end,
      'Orion ' || target.version || ' for ' || target.platform ||
        ' is now the current approved download.',
      '/portal#downloads',
      'release:' || target.id::text || ':g:' || new_generation::text ||
        ':client:' || eligible.client_id::text
    from (
      select distinct client.id as client_id
      from public.clients as client
      join public.licenses as license on license.client_id = client.id
      where client.status = 'Active'
        and license.status = 'Active'
        and license.plan = client.plan
        and (license.expires_at is null or license.expires_at::date >= current_date)
        and license.platform = any(changed_platforms)
    ) as eligible
    on conflict (dedupe_key) do nothing;

    get diagnostics notification_count = row_count;
  end if;

  update public.release_promotion_events
  set notified_clients = notification_count
  where batch_id = promotion_batch;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'eventType', event_kind,
    'releaseId', target.id,
    'generation', new_generation,
    'channels', to_jsonb(changed_platforms),
    'notified', notification_count
  );
end;
$$;

create or replace function public.archive_product_release(
  p_release_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.product_releases%rowtype;
begin
  if p_actor is null or not exists (
    select 1 from public.admins
    where user_id = p_actor and role = 'admin'
  ) then
    raise exception 'An approved administrator actor is required' using errcode = '42501';
  end if;

  select * into target
  from public.product_releases
  where id = p_release_id
  for update;

  if not found then
    raise exception 'Release not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.release_channels
    where current_release_id = target.id
  ) then
    raise exception 'The current release channel cannot be archived' using errcode = '23514';
  end if;

  if target.archived_at is not null then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'releaseId', target.id, 'archived', true
    );
  end if;

  update public.product_releases
  set published = false,
      asset_status = 'withdrawn',
      archived_at = now(),
      updated_at = now()
  where id = target.id;

  insert into public.release_promotion_events (
    event_type, platform, release_id, previous_release_id,
    actor_auth_user_id, publish_generation, notify_requested, notified_clients
  ) values (
    'Archive', null, target.id, null,
    p_actor, target.publish_generation, false, 0
  );

  return jsonb_build_object(
    'ok', true, 'changed', true, 'releaseId', target.id, 'archived', true
  );
end;
$$;

create or replace function public.get_release_delivery_metrics(
  p_release_id uuid default null
)
returns table (
  release_id uuid,
  download_count bigint,
  unique_clients bigint,
  last_downloaded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select release.id,
    count(download.id)::bigint,
    count(distinct download.client_id)::bigint,
    max(download.downloaded_at)
  from public.product_releases as release
  left join public.download_events as download on download.release_id = release.id
  where p_release_id is null or release.id = p_release_id
  group by release.id
  order by max(download.downloaded_at) desc nulls last, release.created_at desc;
$$;

revoke all on function public.promote_product_release(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.archive_product_release(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_release_delivery_metrics(uuid)
  from public, anon, authenticated;
grant execute on function public.promote_product_release(uuid, uuid, boolean)
  to service_role;
grant execute on function public.archive_product_release(uuid, uuid)
  to service_role;
grant execute on function public.get_release_delivery_metrics(uuid)
  to service_role;

comment on table public.product_release_uploads is
  'Server-only signed upload intents. Storage destinations and expected metadata are immutable.';
comment on table public.release_channels is
  'The currently approved release for each MT4 and MT5 delivery channel.';
comment on table public.release_promotion_events is
  'Immutable service-side audit trail for publish, rollback, restore, and archive actions.';
comment on column public.product_releases.storage_path is
  'Private Storage object path. Never expose this column directly to browser clients.';
