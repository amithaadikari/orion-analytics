export function formatMoneyWithCode(value: number, currency: string) {
  const code = currency.trim().toUpperCase() || 'UNSPECIFIED';
  try {
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return `${amount} ${code}`;
  } catch {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
  }
}
