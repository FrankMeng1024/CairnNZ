/**
 * i18n.ts — Cairn bilingual (English / Te Reo Māori) string registry.
 *
 * PRD3 E-014: Te Reo first wave.
 *
 * Phase 1 scope (this file):
 *   - Greetings (Kia ora, Nau mai haere mai, Ngā mihi)
 *   - All 11 Great Walks dual names
 *   - Major place names (Aoraki / Mount Cook etc.)
 *
 * IMPORTANT: All Te Reo strings here must be reviewed by a registered
 * translator from Te Taura Whiri i te Reo Māori before production release.
 * Macrons are mandatory — never strip them.
 */

export type Lang = 'en' | 'mi' | 'auto';

// ── Great Walks (DOC official + Te Reo where available) ────────────────────
export const GREAT_WALKS: Array<{ en: string; mi?: string; key: string }> = [
  { key: 'lake_waikaremoana',    en: 'Lake Waikaremoana Track',     mi: 'Te Ara o Waikaremoana' },
  { key: 'tongariro_circuit',    en: 'Tongariro Northern Circuit',  mi: 'Te Ara Tonga o Tongariro' },
  { key: 'whanganui_journey',    en: 'Whanganui Journey',           mi: 'Te Awa Tupua o Whanganui' },
  { key: 'abel_tasman',          en: 'Abel Tasman Coast Track',     mi: 'Te Ara Takutai o Abel Tasman' },
  { key: 'heaphy',               en: 'Heaphy Track',                mi: 'Te Ara o Heaphy' },
  { key: 'paparoa',              en: 'Paparoa Track',               mi: 'Te Ara o Paparoa' },
  { key: 'routeburn',            en: 'Routeburn Track',             mi: 'Te Ara o Routeburn' },
  { key: 'kepler',               en: 'Kepler Track',                mi: 'Te Ara o Kepler' },
  { key: 'milford',              en: 'Milford Track',               mi: 'Te Ara o Piopiotahi' },
  { key: 'rakiura',              en: 'Rakiura Track',               mi: 'Te Ara o Rakiura' },
  { key: 'hump_ridge',           en: 'Hump Ridge Track',            mi: 'Te Ara o Te Wae-roa' },
];

// ── Place names (Māori first when officially gazetted as dual) ─────────────
export const PLACE_NAMES: Record<string, { en: string; mi?: string; dual?: string }> = {
  aoraki:        { en: 'Mount Cook',     mi: 'Aoraki',           dual: 'Aoraki / Mount Cook' },
  taranaki:      { en: 'Mount Taranaki', mi: 'Taranaki',         dual: 'Taranaki Maunga' },
  auckland:      { en: 'Auckland',       mi: 'Tāmaki Makaurau',  dual: 'Tāmaki Makaurau / Auckland' },
  wellington:    { en: 'Wellington',     mi: 'Te Whanganui-a-Tara', dual: 'Te Whanganui-a-Tara / Wellington' },
  christchurch:  { en: 'Christchurch',   mi: 'Ōtautahi',         dual: 'Ōtautahi / Christchurch' },
  south_island:  { en: 'South Island',   mi: 'Te Wai Pounamu',   dual: 'Te Wai Pounamu / South Island' },
  north_island:  { en: 'North Island',   mi: 'Te Ika-a-Māui',    dual: 'Te Ika-a-Māui / North Island' },
  white_island:  { en: 'White Island',   mi: 'Whakaari',         dual: 'Whakaari / White Island' },
};

// ── UI greetings + accents ─────────────────────────────────────────────────
export const GREETINGS = {
  kia_ora: 'Kia ora',                    // hello / cheers
  nau_mai_haere_mai: 'Nau mai, haere mai',  // welcome
  nga_mihi: 'Ngā mihi',                  // thanks / regards
  haere_ra: 'Haere rā',                  // goodbye (to person leaving)
  ka_kite: 'Ka kite',                    // see you later
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format a place name for display.
 * Defaults to dual format when both languages exist.
 */
export function formatPlaceName(
  key: string,
  mode: 'dual' | 'mi-only' | 'en-only' = 'dual',
): string {
  const p = PLACE_NAMES[key];
  if (!p) return key;
  if (mode === 'dual' && p.dual) return p.dual;
  if (mode === 'mi-only' && p.mi) return p.mi;
  return p.en;
}

/**
 * Pick a contextual greeting for a given hour-of-day.
 * Adds a Te Reo prefix occasionally for variety.
 */
export function timeBasedGreeting(hour: number, useTeReo = true): string {
  if (hour < 5 || hour >= 22) return useTeReo ? `${GREETINGS.kia_ora}, night owl` : 'Hey, night owl';
  if (hour < 12) return useTeReo ? `${GREETINGS.kia_ora}, good morning` : 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Sanity check: every string in this file must contain proper macrons
 * where the source uses them. This is a developer-side helper, not enforced
 * at runtime (a future ESLint rule could enforce in CI).
 */
export const MACRON_CHARS = ['ā', 'ē', 'ī', 'ō', 'ū', 'Ā', 'Ē', 'Ī', 'Ō', 'Ū'];
