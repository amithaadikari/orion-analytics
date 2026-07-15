import { requireAdminApi } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/security';

const resources = { clients: 'clients', licenses: 'licenses', payments: 'client_payments' } as const;
export async function GET(request: Request) {
  const { user, admin } = await requireAdminApi(); if (!user || !admin) return jsonError('Unauthorized', 401);
  const type = new URL(request.url).searchParams.get('type') as keyof typeof resources; if (!resources[type]) return jsonError('Invalid export type');
  const { data, error } = await createSupabaseAdminClient().from(resources[type]).select('*').order('created_at', { ascending: false }).limit(10000); if (error) return jsonError('Unable to export records', 500);
  const rows = data || []; const headers = rows.length ? Object.keys(rows[0]) : ['id']; const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => quote(row[key])).join(','))].join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="orion-${type}-${new Date().toISOString().slice(0,10)}.csv"`, 'cache-control': 'private, no-store' } });
}
function quote(value: unknown) { const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return `"${text.replace(/"/g, '""')}"`; }
