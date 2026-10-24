
import { cairnText } from '../i18n/runtime';export const PASSWORD_RULES = [
  { key: 'length', get label() { return cairnText('password-policy.at-least-8-characters'); } },
  { key: 'uppercase', get label() { return cairnText('password-policy.one-uppercase-letter'); } },
  { key: 'number', get label() { return cairnText('password-policy.one-number'); } },
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
  if (!value) return cairnText('password-policy.password-is-required');
  if (!rules.length) return cairnText('password-policy.password-must-be-at-least-8-characters');
  if (!rules.uppercase) return cairnText('password-policy.password-must-contain-an-uppercase-letter');
  if (!rules.number) return cairnText('password-policy.password-must-contain-a-number');
  return '';
}

export function passwordMeetsPolicy(value: string): boolean {
  return passwordPolicyError(value) === '';
}
