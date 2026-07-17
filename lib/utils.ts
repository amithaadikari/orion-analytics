export const EVENT_LABELS: Record<string, string> = {
  PageView: 'Page views', ViewContent: 'ViewContent', TelegramClick: 'Telegram clicks', SupportClick: 'Support clicks', Lead: 'Leads', Purchase: 'Purchases',
  PlanSelected: 'Plan selected', RegistrationStarted: 'Registration started', RegistrationCompleted: 'Registration completed', CheckoutStarted: 'Checkout started'
};

export function rangeStart(range: string) {
  const now = new Date();
  if (range === 'yesterday') { now.setUTCDate(now.getUTCDate() - 1); now.setUTCHours(0, 0, 0, 0); return now; }
  const days = range === '7d' ? 6 : range === '30d' ? 29 : 0;
  now.setUTCDate(now.getUTCDate() - days); now.setUTCHours(0, 0, 0, 0); return now;
}

export function rangeEnd(range: string) {
  const now = new Date();
  if (range === 'yesterday') { now.setUTCDate(now.getUTCDate() - 1); now.setUTCHours(23, 59, 59, 999); }
  return now;
}

export function formatDate(value: string | Date) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)); }
