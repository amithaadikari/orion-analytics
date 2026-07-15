import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_CHANNEL_URL: z.string().url().refine((value) => value.startsWith('https://'), 'Telegram URL must use HTTPS'),
  META_PIXEL_ID: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  META_TEST_EVENT_CODE: z.string().optional().default(''),
  CONVERSION_INTERNAL_SECRET: z.string().min(16),
  TRACKING_ALLOWED_ORIGINS: z.string().min(1),
  IP_HASH_SALT: z.string().min(16),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  NEXT_PUBLIC_ANALYTICS_ENABLED: z.enum(['true', 'false']).default('true')
});

let cached: z.infer<typeof envSchema> | null = null;

export function getEnv() {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
  }
  cached = parsed.data;
  return cached;
}

export function publicEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  };
}
