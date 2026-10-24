/**
 * Locale-aware display formatting. Wire/storage values remain ISO/timestamps.
 */

import { getCairnLocale } from '../i18n/runtime';

/** Locale used only for display formatting; storage and protocol values stay stable. */
export function productLocale(): 'en-NZ' | 'ja-JP' {
  return getCairnLocale() === 'ja-JP' ? 'ja-JP' : 'en-NZ';
}

export function formatDate(input: Date | number): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat(productLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatProductTime(input: Date | number): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat(productLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * Stable hook-shaped API retained for existing consumers.
 */
export function useDateFormatter(): (input: Date | number) => string {
  return formatDate;
}
