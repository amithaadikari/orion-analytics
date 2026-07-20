import { requireAdmin } from '@/lib/auth';
import Dashboard from '@/components/analytics-dashboard';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { admin } = await requireAdmin();
  const themeCookie = (await cookies()).get('orion-admin-theme')?.value;
  const initialTheme = themeCookie === 'black' ? 'black' : 'royal';
  return <Dashboard admin={admin} initialTheme={initialTheme} />;
}
