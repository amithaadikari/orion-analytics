import { z } from 'zod';

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
  visitor_id: id, session_id: id.optional().nullable(), event_name: z.enum(['PageView', 'ViewContent', 'TelegramClick', 'SupportClick', 'Lead', 'Purchase']),
  event_id: id, page_url: optionalText(2000), metadata: z.record(z.unknown()).optional().default({}),
  fbp: optionalText(250), fbc: optionalText(250)
});

export const sessionSchema = z.object({
  visitor_id: id, session_id: id, started_at: z.string().datetime().optional(), ended_at: z.string().datetime().optional().nullable(),
  pages_viewed: z.number().int().min(0).max(10000).optional(), duration_seconds: z.number().int().min(0).max(86400).optional()
});

export const metaSchema = z.object({
  event_name: z.enum(['PageView', 'ViewContent', 'Lead', 'Contact', 'Purchase']), event_id: id,
  event_source_url: optionalText(2000), visitor_id: id.optional(), fbp: optionalText(250), fbc: optionalText(250),
  metadata: z.record(z.unknown()).optional()
});
