import { z } from 'zod';
import { installationIdPattern, normalizeInstallationId } from '@/lib/license-runtime';

export const TELEMETRY_BODY_MAX_BYTES = 64 * 1024;
export const TELEMETRY_MAX_OPEN_POSITIONS = 100;
export const TELEMETRY_MAX_CLOSED_DEALS = 40;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const unsignedDecimal = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/);
const positivePgBigInt = z.string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, 'Value is outside the supported range');
const unixSeconds = z.string()
  .regex(/^(?:0|[1-9][0-9]{0,11})$/)
  .refine((value) => BigInt(value) <= 253_402_300_799n, 'Invalid Unix timestamp');
const unixMilliseconds = z.string()
  .regex(/^(?:0|[1-9][0-9]{0,16})$/)
  .refine((value) => BigInt(value) <= 253_402_300_799_999n, 'Invalid Unix millisecond timestamp');
const finiteMetric = z.number().finite().min(-1_000_000_000_000_000).max(1_000_000_000_000_000);
const nonNegativeMetric = z.number().finite().min(0).max(1_000_000_000_000_000);
const normalizedText = (min: number, max: number) => z.string().trim().min(min).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are not allowed');

const authSchema = z.object({
  licenseKey: z.string().trim().min(8).max(120),
  accountNumber: z.string().trim().regex(/^[0-9]{4,24}$/),
  brokerServer: normalizedText(2, 160),
  platform: z.literal('MT5'),
  accountType: z.enum(['Demo', 'Real']),
  installationId: z.string().transform(normalizeInstallationId).pipe(z.string().regex(installationIdPattern)),
  bindingVersion: z.number().int().min(0).max(2_147_483_647),
}).strict();

const heartbeatSchema = z.object({
  eaVersion: z.literal('5.2.0'),
  terminalBuild: z.number().int().min(1).max(2_147_483_647),
  terminalConnected: z.boolean(),
  terminalTradeAllowed: z.boolean(),
  mqlTradeAllowed: z.boolean(),
  chartSymbol: normalizedText(1, 64),
  chartPeriodMinutes: z.number().int().min(1).max(525_600),
  licenseState: normalizedText(1, 64),
}).strict();

const accountSnapshotSchema = z.object({
  observedAt: unixSeconds,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,8}$/),
  leverage: z.number().int().min(0).max(10_000_000),
  balance: finiteMetric,
  equity: finiteMetric,
  credit: finiteMetric,
  margin: finiteMetric,
  freeMargin: finiteMetric,
  marginLevel: finiteMetric,
  floatingProfit: finiteMetric,
}).strict();

const openPositionSchema = z.object({
  positionTicket: unsignedDecimal,
  positionId: unsignedDecimal,
  symbol: normalizedText(1, 64),
  side: z.enum(['Buy', 'Sell']),
  magic: z.string().regex(/^-?(?:0|[1-9][0-9]{0,18})$/),
  openedAtMsc: unixMilliseconds,
  volume: nonNegativeMetric.refine((value) => value > 0, 'Volume must be positive'),
  openPrice: nonNegativeMetric,
  currentPrice: nonNegativeMetric,
  stopLoss: nonNegativeMetric,
  takeProfit: nonNegativeMetric,
  swap: finiteMetric,
  profit: finiteMetric,
}).strict();

const openPositionsSchema = z.object({
  snapshotId: hex64,
  observedAt: unixSeconds,
  complete: z.literal(true),
  items: z.array(openPositionSchema).max(TELEMETRY_MAX_OPEN_POSITIONS),
}).strict().superRefine((value, context) => {
  reportDuplicates(value.items.map((item) => item.positionTicket), 'position ticket', context);
});

const closedDealSchema = z.object({
  dealTicket: unsignedDecimal,
  orderTicket: unsignedDecimal,
  positionId: unsignedDecimal,
  timeMsc: unixMilliseconds,
  symbol: normalizedText(1, 64),
  side: z.enum(['Buy', 'Sell']),
  entry: z.enum(['In', 'Out', 'InOut', 'OutBy']),
  reason: normalizedText(1, 64),
  magic: z.string().regex(/^-?(?:0|[1-9][0-9]{0,18})$/),
  volume: nonNegativeMetric,
  price: nonNegativeMetric,
  stopLoss: nonNegativeMetric,
  takeProfit: nonNegativeMetric,
  commission: finiteMetric,
  swap: finiteMetric,
  fee: finiteMetric,
  profit: finiteMetric,
}).strict();

const closedDealsSchema = z.object({
  cursor: z.object({
    timeMsc: unixMilliseconds,
    dealTicket: unsignedDecimal,
  }).strict(),
  items: z.array(closedDealSchema).max(TELEMETRY_MAX_CLOSED_DEALS),
}).strict().superRefine((value, context) => {
  reportDuplicates(value.items.map((item) => item.dealTicket), 'deal ticket', context);
});

export const tradingTelemetrySchema = z.object({
  schemaVersion: z.literal(1),
  requestId: hex64,
  sequence: positivePgBigInt,
  sentAt: unixSeconds,
  auth: authSchema,
  heartbeat: heartbeatSchema,
  accountSnapshot: accountSnapshotSchema,
  openPositions: openPositionsSchema,
  closedDeals: closedDealsSchema,
}).strict();

export type TradingTelemetryPayload = z.infer<typeof tradingTelemetrySchema>;

export type TradingTelemetryAck = {
  accepted: boolean;
  code: string;
  serverTime: string;
  ackDealTimeMsc: string;
  ackDealTicket: string;
  sendAfterSeconds: number;
};

function reportDuplicates(values: string[], label: string, context: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${label}` });
      return;
    }
    seen.add(value);
  }
}
