export const PASSWORD_RULES = [
  { key: 'length', label: 'At least 8 characters' },
  { key: 'uppercase', label: 'One uppercase letter' },
  { key: 'number', label: 'One number' },
] as const;

export type PasswordRuleKey = typeof PASSWORD_RULES[number]['key'];

export function passwordRuleState(value: string): Record<PasswordRuleKey, boolean> {
  return {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
  };
}

export function passwordPolicyError(value: string): string {
  const rules = passwordRuleState(value);
  if (!value) return 'Password is required';
  if (!rules.length) return 'Password must be at least 8 characters';
  if (!rules.uppercase) return 'Password must contain an uppercase letter';
  if (!rules.number) return 'Password must contain a number';
  return '';
}

export function passwordMeetsPolicy(value: string): boolean {
  return passwordPolicyError(value) === '';
}
