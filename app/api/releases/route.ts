import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/security';

const releaseSchema = z.object({
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(2).max(140),
  release_notes: z.string().trim().max(4000).optional(),
  platform: z.enum(['MT4', 'MT5', 'Both']),
  download_url: z.preprocess(
    (value) => value === '' ? null : value,
    z.string().url().refine((value) => value.startsWith('https://'), 'Download URL must use HTTPS').nullable().optional()
  ),
  published: z.boolean()
});

async function session(write = false) {
  const auth = await requireAdminApi();
  if (!auth.user || !auth.admin) return null;
  if (write && auth.admin.role !== 'admin') return null;
  return auth;
}

export async function GET() {
  if (!await session()) return jsonError('Unauthorized', 401);
  const { data, error } = await createSupabaseAdminClient()
    .from('product_releases')
    .select('*')
    .order('released_at', { ascending: false });
  if (error) return jsonError(error.message.includes('does not exist') ? 'Client portal migration has not been applied.' : 'Unable to load releases', 500);
  return Response.json(data || [], { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!await session(true)) return jsonError('Admin access required', 403);
  const parsed = releaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || 'Invalid release');
  const { data, error } = await createSupabaseAdminClient().from('product_releases').insert(parsed.data).select('*').single();
  if (error) return jsonError(error.code === '23505' ? 'This version already exists.' : error.message, 400);
  return Response.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!await session(true)) return jsonError('Admin access required', 403);
  const body = await request.json().catch(() => null);
  const id = z.string().uuid().safeParse(body?.id);
  const parsed = releaseSchema.partial().safeParse(body?.data);
  if (!id.success || !parsed.success) return jsonError(parsed.success ? 'Invalid release ID' : parsed.error.issues[0]?.message || 'Invalid release');
  const { data, error } = await createSupabaseAdminClient().from('product_releases').update(parsed.data).eq('id', id.data).select('*').single();
  if (error) return jsonError(error.code === '23505' ? 'This version already exists.' : error.message, 400);
  return Response.json(data);
}

export async function DELETE(request: Request) {
  if (!await session(true)) return jsonError('Admin access required', 403);
  const body = await request.json().catch(() => null);
  const id = z.string().uuid().safeParse(body?.id);
  if (!id.success) return jsonError('Invalid release ID');
  const { error } = await createSupabaseAdminClient().from('product_releases').delete().eq('id', id.data);
  if (error) return jsonError(error.message, 400);
  return Response.json({ ok: true });
}
