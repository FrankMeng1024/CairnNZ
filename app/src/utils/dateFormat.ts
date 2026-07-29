/**
 * dateFormat — user-preference-aware date formatting.
 *
 * User picks a format in Settings (default 'dmy' = NZ/UK). Every date
 * shown to user goes through formatDate() so US users see MM/DD and ISO
 * users see YYYY-MM-DD without changing storage or wire format.
 *
 * Storage stays as ISO Date / number timestamps — this only affects display.
 */
import { useSettingsStore, DateFormatPref } from '../store/useSettingsStore';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format a Date or timestamp per the user's dateFormat preference.
 * Pass an explicit `pref` to override the current setting (useful for
 * default-name generation at hike-save where the store may not yet be
 * hydrated).
 */
export function formatDate(input: Date | number, pref?: DateFormatPref): string {
  const d = typeof input === 'number' ? new Date(input) : input;
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const format = pref ?? useSettingsStore.getState().dateFormat;
  switch (format) {
    case 'mdy': return `${mm}/${dd}/${yyyy}`;
    case 'ymd': return `${yyyy}-${mm}-${dd}`;
    case 'dmy':
    default:    return `${dd}/${mm}/${yyyy}`;
  }
}

/**
 * React hook: re-renders when the user changes the date format.
 * Use this in components that display dates.
 */
export function useDateFormatter(): (input: Date | number) => string {
  const pref = useSettingsStore((s) => s.dateFormat);
  return (input) => formatDate(input, pref);
}
