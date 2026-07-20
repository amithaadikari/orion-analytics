import { z } from 'zod';
import { clientAvatarKeys, clientProfileLimits } from '@/lib/client-profile';

const id = z.string().regex(/^[a-zA-Z0-9._:-]{8,180}$/);
const optionalText = (max = 500) => z.string().max(max).optional().nullable();

export const visitorSchema = z.object({
  visitor_id: id,
  session_id: id.optional(),
  landing_page: optionalText(2000),
  referrer: optionalText(2000),
  utm_source: optionalText(120), utm_medium: optionalText(120), utm_campaign: optionalText(180),
  utm_content: optionalText(180), utm_term: optionalText(180), fbclid: optionalText(250),
  fbp: optionalText(250), fbc: optionalText(250), device_type: optionalText(30),
  browser: optionalText(80), operating_system: optionalText(80)
});

export const eventSchema = z.object({
  visitor_id: id, session_id: id.optional().nullable(), event_name: z.enum(['PageView', 'ViewContent', 'TelegramClick', 'SupportClick', 'Lead', 'Purchase', 'PlanSelected', 'RegistrationStarted', 'RegistrationCompleted', 'CheckoutStarted']),
  event_id: id, page_url: optionalText(2000), metadata: z.record(z.unknown()).optional().default({}),
  fbp: optionalText(250), fbc: optionalText(250)
});

export const funnelEventSchema = z.object({
  visitor_id: id,
  session_id: id.optional().nullable(),
  event_id: id,
  event_name: z.enum(['PlanSelected', 'RegistrationStarted', 'RegistrationCompleted', 'CheckoutStarted']),
  page_url: optionalText(2000),
  plan: z.enum(['basic', 'premium', 'lifetime']).optional().nullable(),
  metadata: z.record(z.unknown()).optional().default({}),
  fbp: optionalText(250),
  fbc: optionalText(250)
});

export const sessionSchema = z.object({
  visitor_id: id, session_id: id, started_at: z.string().datetime().optional(), ended_at: z.string().datetime().optional().nullable(),
  pages_viewed: z.number().int().min(0).max(10000).optional(), duration_seconds: z.number().int().min(0).max(86400).optional()
});

export const metaSchema = z.object({
  event_name: z.enum(['PageView', 'ViewContent', 'Lead', 'Contact', 'InitiateCheckout', 'CompleteRegistration', 'Purchase']), event_id: id,
  event_source_url: optionalText(2000), visitor_id: id.optional(), fbp: optionalText(250), fbc: optionalText(250),
  metadata: z.record(z.unknown()).optional()
});

const telegramUsername = z.string().trim().max(80)
  .transform((value) => value.replace(/^@/, ''));

const phoneNumber = z.string().trim().max(40);

const uniqueList = (maxItems: number, maxLength: number, uppercase = false) => z.array(z.string().trim().min(2).max(maxLength))
  .max(maxItems)
  .transform((values) => {
    const seen = new Set<string>();
    return values.reduce<string[]>((result, value) => {
      const next = uppercase ? value.toUpperCase() : value;
      const identity = next.toLowerCase();
      if (!seen.has(identity)) {
        seen.add(identity);
        result.push(next);
      }
      return result;
    }, []);
  });

export const clientProfileSchema = z.object({
  nickname: z.string().trim().max(clientProfileLimits.nickname),
  telegramUsername,
  phoneNumber,
  bio: z.string().trim().max(clientProfileLimits.bio),
  brokers: uniqueList(clientProfileLimits.brokers, 40),
  tradingPairs: uniqueList(clientProfileLimits.tradingPairs, 20, true)
    .refine((values) => values.every((value) => /^[A-Z0-9./_-]{2,20}$/.test(value)), 'Use valid market symbols such as XAUUSD or BTCUSD.'),
  avatarKey: z.enum(clientAvatarKeys),
}).strict();
