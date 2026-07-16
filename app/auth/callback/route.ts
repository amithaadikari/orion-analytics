import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request:NextRequest){const url=new URL(request.url);const code=url.searchParams.get('code');const requested=url.searchParams.get('next')||'/portal';const next=requested.startsWith('/')&&!requested.startsWith('//')?requested:'/portal';if(code){const supabase=await createSupabaseServerClient();const{error}=await supabase.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(next,request.url))}return NextResponse.redirect(new URL('/forgot-password?error=invalid-link',request.url))}
