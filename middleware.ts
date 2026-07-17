import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const isPortal = request.nextUrl.pathname.startsWith('/portal');
  const isCheckout = request.nextUrl.pathname.startsWith('/checkout');
  if (!request.nextUrl.pathname.startsWith('/dashboard') && !isPortal && !isCheckout) return response;
  const isClient = isPortal || isCheckout;
  const loginPath = isClient ? '/client-login' : '/login';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const loginUrl = new URL(loginPath, request.url);
  if (isClient) loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (!url || !key) return NextResponse.redirect(loginUrl);
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll(values: { name: string; value: string; options: CookieOptions }[]) { values.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }); } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(loginUrl);
  return response;
}

export const config = { matcher: ['/dashboard/:path*', '/portal/:path*', '/checkout/:path*'] };
