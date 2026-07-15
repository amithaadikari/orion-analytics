import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!request.nextUrl.pathname.startsWith('/dashboard')) return response;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.redirect(new URL('/login', request.url));
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll(values: { name: string; value: string; options: CookieOptions }[]) { values.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }); } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  return response;
}

export const config = { matcher: ['/dashboard/:path*'] };
