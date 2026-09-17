/**
 * Locale-aware display formatting. Wire/storage values remain ISO/timestamps.
 */

/**
 * Use the device locale rather than exposing a partially adopted app setting.
 */
export function formatDate(input: Date | number): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Stable hook-shaped API retained for existing consumers.
 */
export function useDateFormatter(): (input: Date | number) => string {
  return formatDate;
}
