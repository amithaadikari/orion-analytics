import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthAssurance } from '@/lib/auth-assurance';
import { safeMfaNext } from '@/lib/plans';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const isPortal = request.nextUrl.pathname.startsWith('/portal');
  const isCheckout = request.nextUrl.pathname.startsWith('/checkout');
  const isDocument = request.nextUrl.pathname.startsWith('/invoice/') || request.nextUrl.pathname.startsWith('/receipt/');
  if (!request.nextUrl.pathname.startsWith('/dashboard') && !isPortal && !isCheckout && !isDocument) return response;
  const isClient = isPortal || isCheckout || isDocument;
  const loginPath = isClient ? '/client-login' : '/login';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const loginUrl = new URL(loginPath, request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (!url || !key) return NextResponse.redirect(loginUrl);
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll(values: { name: string; value: string; options: CookieOptions }[]) {
    values.forEach(({ name, value }) => request.cookies.set(name, value));
    response = NextResponse.next({ request });
    values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirectWithCookies(loginUrl, response);
  const assurance = await getAuthAssurance(supabase, user);
  if (assurance.requiresChallenge) {
    const next = safeMfaNext(`${request.nextUrl.pathname}${request.nextUrl.search}`, isClient ? '/portal' : '/dashboard');
    const mfaUrl = new URL('/mfa', request.url);
    mfaUrl.searchParams.set('next', next);
    return redirectWithCookies(mfaUrl, response);
  }
  return response;
}

function redirectWithCookies(url: URL, source: NextResponse) {
  const target = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export const config = { matcher: ['/dashboard/:path*', '/portal/:path*', '/checkout/:path*', '/invoice/:path*', '/receipt/:path*'] };
