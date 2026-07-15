import { createHash } from 'node:crypto';
import { getEnv } from '@/lib/env';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function hashIp(ip: string) {
  return createHash('sha256').update(`${getEnv().IP_HASH_SALT}:${ip}`).digest('hex');
}

export function getClientIp(request: Request) {
  return request.headers.get('x-real-ip')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export function rateLimit(request: Request, scope: string) {
  const env = getEnv();
  const key = `${scope}:${hashIp(getClientIp(request))}`;
  const now = Date.now();
  if (buckets.size > 5000) for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_SECONDS * 1000 });
    return { allowed: true, remaining: env.RATE_LIMIT_MAX - 1 };
  }
  current.count += 1;
  return { allowed: current.count <= env.RATE_LIMIT_MAX, remaining: Math.max(0, env.RATE_LIMIT_MAX - current.count) };
}
