import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260729_secure_ea_release_center.sql';
const migration = readFileSync(migrationPath, 'utf8');
const sql = normalizeSql(migration);

describe('secure EA release center migration', () => {
  it('stores bounded private-source metadata without opening Supabase Storage to browser roles', () => {
    for (const column of [
      'asset_status',
      'storage_bucket',
      'storage_path',
      'original_filename',
      'file_size_bytes',
      'sha256',
      'content_type',
      'file_verified_at',
      'published_at',
      'promoted_at',
      'archived_at',
      'publish_generation',
    ]) {
      expect(sql).toContain(`add column if not exists ${column}`);
    }

    expect(sql).toContain("storage_bucket is null or storage_bucket = 'orion-ea-releases'");
    expect(sql).toContain('file_size_bytes between 1 and 52428800');
    expect(sql).toContain("sha256 ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain('product_releases_published_source_ready_check');
    expect(sql).toMatch(/product_releases_published_source_ready_check[\s\S]*?original_filename is not null[\s\S]*?file_size_bytes between 1 and 52428800[\s\S]*?sha256 ~ '\^\[a-f0-9\]\{64\}\$'[\s\S]*?file_verified_at is not null/);
    expect(sql).toContain('product_releases_source_exclusive_check');
    expect(sql).toContain('product_releases_storage_path_check');
    expect(sql).toContain('split_part(storage_path, \'/\', 2) = id::text');

    expect(sql).toContain('alter table public.product_release_uploads enable row level security');
    expect(sql).toContain('drop policy if exists product_releases_authenticated_read on public.product_releases');
    for (const table of ['product_releases', 'product_release_uploads', 'release_channels', 'release_promotion_events']) {
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
      expect(sql).toContain(`grant all on table public.${table} to service_role`);
    }
    expect(sql).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+storage\.(?:buckets|objects)/);
    expect(sql).not.toMatch(/create\s+policy[\s\S]{0,240}\s+on\s+storage\.objects/);
  });

  it('keeps release RPCs security-definer, fixed-search-path, and service-role-only', () => {
    const functions = [
      { name: 'promote_product_release', signature: 'uuid, uuid, boolean' },
      { name: 'archive_product_release', signature: 'uuid, uuid' },
      { name: 'get_release_delivery_metrics', signature: 'uuid' },
    ];

    for (const definition of functions) {
      const body = functionDefinition(definition.name);
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
      expect(sql).toContain(`revoke all on function public.${definition.name}(${definition.signature}) from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${definition.name}(${definition.signature}) to service_role`);
      expect(sql).not.toContain(`grant execute on function public.${definition.name}(${definition.signature}) to authenticated`);
    }

    expect(functionDefinition('promote_product_release')).toContain("where user_id = p_actor and role = 'admin'");
    expect(functionDefinition('archive_product_release')).toContain("where user_id = p_actor and role = 'admin'");
  });

  it('maintains one locked current release per MT4 and MT5 channel, including Both promotion', () => {
    expect(sql).toContain('create table if not exists public.release_channels');
    expect(sql).toContain('platform text primary key');
    expect(sql).toContain('current_release_id uuid references public.product_releases(id) on delete restrict');
    expect(sql).toContain("check (platform in ('mt4', 'mt5'))");
    expect(sql).toContain("insert into public.release_channels (platform) values ('mt4'), ('mt5') on conflict (platform) do nothing");

    const promote = functionDefinition('promote_product_release');
    expect(promote).toContain("when 'both' then array['mt4', 'mt5']::text[]");
    expect(promote).toContain('where platform = any(target_platforms) order by platform for update');
    expect(promote).toContain('bool_and(coalesce(current_release_id = target.id, false))');
    expect(promote).toContain('set current_release_id = target.id');
    expect(promote).toContain('generation = generation + 1');
    expect(promote).toContain("'changed', false");
    expect(sql).toContain("where status = 'pending'");
  });

  it('deduplicates each promotion notification and limits recipients to currently eligible clients', () => {
    expect(sql).toContain('alter table public.client_notifications add column if not exists release_id uuid');
    expect(sql).toContain('client_notifications_release_fk');

    const promote = functionDefinition('promote_product_release');
    expect(promote).toContain("'release:' || target.id::text || ':g:' || new_generation::text || ':client:' || eligible.client_id::text");
    expect(promote).toContain('on conflict (dedupe_key) do nothing');
    expect(promote).toContain("where client.status = 'active'");
    expect(promote).toContain("and license.status = 'active'");
    expect(promote).toContain('and license.plan = client.plan');
    expect(promote).toContain('license.expires_at::date >= current_date');
    expect(promote).toContain('license.platform = any(changed_platforms)');
    expect(promote).toContain('get diagnostics notification_count = row_count');
  });

  it('refuses to archive a current channel and preserves immutable release history', () => {
    const archive = functionDefinition('archive_product_release');
    expect(archive).toContain('select 1 from public.release_channels where current_release_id = target.id');
    expect(archive).toContain("raise exception 'the current release channel cannot be archived'");
    expect(archive).toContain('set published = false');
    expect(archive).toContain("asset_status = 'withdrawn'");
    expect(archive).toContain("'archive', null, target.id");

    expect(sql).toContain('release_id uuid not null references public.product_releases(id) on delete restrict');
    expect(sql).toContain('previous_release_id uuid references public.product_releases(id) on delete set null');
  });
});

function normalizeSql(value: string) {
  return value.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}

function functionDefinition(name: string) {
  const marker = `create or replace function public.${name}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`Missing SQL function ${name}`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`Unterminated SQL function ${name}`);
  return sql.slice(start, end + 3);
}
