import { requireAdmin } from '@/lib/auth';
import Dashboard from '@/components/analytics-dashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { admin } = await requireAdmin();
  return <Dashboard admin={admin} />;
}
