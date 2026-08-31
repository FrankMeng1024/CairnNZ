/**
 * changelog.ts — user-facing "What's new" release notes.
 *
 * Bump rule: BEFORE running `npx eas update`, prepend a new entry with the
 * new OTA_VERSION and a short human-readable list of what changed. Settings →
 * About & Legal → What's new shows the top N entries.
 *
 * Keep entries short and in the user's language (English, product-oriented,
 * no technical jargon). Aim for 3-6 bullets per version.
 */

export interface ChangelogEntry {
  /** OTA version identifier, e.g. "O35" */
  version: string;
  /** Release date in YYYY-MM-DD */
  date: string;
  /** Short user-facing bullets */
  notes: string[];
}

/**
 * Newest first. Settings shows the top 3.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'O35',
    date: '2026-08-31',
    notes: [
      'Memory loads faster — the weak-signal notice now only appears if things really are slow.',
      "Adding a friend's map is instant, with a confirmation once their memory is overlaid.",
      'Settings shows accurate places-explored and cairns-planted counts on first open.',
      'Friend profile is cleaner — just their places and cairns.',
      'Sunset backgrounds updated with the new material palette.',
    ],
  },
];
