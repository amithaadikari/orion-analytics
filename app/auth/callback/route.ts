import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeAuthNext } from '@/lib/plans';

export async function GET(request:NextRequest){const url=new URL(request.url);const code=url.searchParams.get('code');const next=safeAuthNext(url.searchParams.get('next'),'/portal');if(code){const supabase=await createSupabaseServerClient();const{error}=await supabase.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(next,request.url))}return NextResponse.redirect(new URL('/forgot-password?error=invalid-link',request.url))}
