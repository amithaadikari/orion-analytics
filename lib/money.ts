export function formatMoneyWithCode(value: number, currency: string) {
  const code = currency.trim().toUpperCase() || 'UNSPECIFIED';
  const roundedValue = Math.round(value * 100) / 100;
  const fractionDigits = Number.isInteger(roundedValue) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2,
    }).format(roundedValue);
  } catch {
    return `${roundedValue.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })} ${code}`;
  }
}
