import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
export default async function Home(){const host=(await headers()).get('host')||'';redirect(host.startsWith('app.')?'/portal':'/dashboard')}
