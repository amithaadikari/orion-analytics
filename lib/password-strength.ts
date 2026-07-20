export type PasswordStrength = {
  score: number;
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  percent: number;
  meetsLength: boolean;
};

export function passwordStrength(value: string): PasswordStrength {
  const meetsLength = value.length >= 10;
  const score = [
    meetsLength,
    /[a-z]/.test(value) && /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;

  const label = score >= 4 ? 'Strong' : score === 3 ? 'Good' : score === 2 ? 'Fair' : 'Weak';
  return { score, label, percent: value ? Math.max(16, score * 25) : 0, meetsLength };
}
