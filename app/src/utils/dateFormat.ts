/**
 * Locale-aware display formatting. Wire/storage values remain ISO/timestamps.
 */

/** Cairn V1 product copy is English regardless of the device locale. */
export const PRODUCT_LOCALE = 'en-NZ';

export function formatDate(input: Date | number): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat(PRODUCT_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatProductTime(input: Date | number): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat(PRODUCT_LOCALE, {
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
