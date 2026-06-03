/**
 * Content Filter Service — keyword-based text filtering for marker notes.
 *
 * Phase 1: Simple keyword blacklist (zero cost, local execution)
 * Future: AI-based content moderation API upgrade
 *
 * Applied at: friend + community levels (personal markers skip filtering)
 *
 * Sprint 51 — STORY-00176 (E-003: AR插旗)
 */

// ── Blacklist (English + basic profanity) ───────────────────────────────────
// Intentionally minimal — covers obvious profanity/slurs/violence
// Not exhaustive: relies on community reporting for edge cases

const BLACKLIST_EN: string[] = [
  // Violence
  'kill', 'murder', 'bomb', 'terrorist', 'attack', 'shoot', 'stab',
  // Profanity (core)
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'cock', 'pussy',
  // Slurs (abbreviated to avoid reproduction)
  'nigger', 'faggot', 'retard', 'chink', 'spic',
  // Sexual
  'porn', 'sex', 'nude', 'naked',
  // Threats
  'threat', 'die', 'dead',
];

// Compile regex for word-boundary matching
const BLACKLIST_REGEX = new RegExp(
  `\\b(${BLACKLIST_EN.join('|')})\\b`,
  'gi',
);

// ── Types ───────────────────────────────────────────────────────────────────

export type FilterResult = {
  passed: boolean;
  original: string;
  filtered: string;       // text with violations replaced by ***
  violations: string[];   // matched words
};

export type ContentLevel = 'personal' | 'friend' | 'community';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Filter text content based on visibility level.
 * Personal markers are never filtered. Friend+ levels are filtered.
 *
 * @param text    The marker note text to check
 * @param level   Visibility level of the marker
 * @returns FilterResult with pass/fail and filtered text
 */
export function filterContent(text: string, level: ContentLevel): FilterResult {
  // Personal markers skip all filtering
  if (level === 'personal') {
    return { passed: true, original: text, filtered: text, violations: [] };
  }

  const violations: string[] = [];
  const filtered = text.replace(BLACKLIST_REGEX, (match) => {
    violations.push(match.toLowerCase());
    return '*'.repeat(match.length);
  });

  return {
    passed: violations.length === 0,
    original: text,
    filtered,
    violations: [...new Set(violations)], // dedupe
  };
}

/**
 * Quick check — does text contain any blocked content?
 * Faster than full filterContent when you just need pass/fail.
 */
export function isCleanContent(text: string, level: ContentLevel): boolean {
  if (level === 'personal') return true;
  return !BLACKLIST_REGEX.test(text);
}

/**
 * Add custom words to the blacklist (for runtime extension).
 * Useful for community-reported terms.
 */
export function addToBlacklist(words: string[]): void {
  BLACKLIST_EN.push(...words.map(w => w.toLowerCase()));
  // Recompile regex
  const newRegex = new RegExp(
    `\\b(${BLACKLIST_EN.join('|')})\\b`,
    'gi',
  );
  // TypeScript won't let us reassign const, so we use Object.defineProperty
  Object.defineProperty(module.exports, 'BLACKLIST_REGEX', { value: newRegex });
}

/**
 * Get the current blacklist size (for debugging/settings display).
 */
export function getBlacklistSize(): number {
  return BLACKLIST_EN.length;
}
