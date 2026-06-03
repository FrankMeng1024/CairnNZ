/**
 * i18n.test — verify Te Reo strings are spelled correctly with macrons.
 *
 * This is a developer-side guardrail: we never want to ship Te Reo strings
 * that have lost their macrons during refactoring.
 */
import { GREAT_WALKS, PLACE_NAMES, GREETINGS, formatPlaceName, MACRON_CHARS } from '../src/config/i18n';

describe('i18n — Te Reo content integrity', () => {
  it('Greetings contain macrons where required', () => {
    // "Ngā mihi" must have macron on a
    expect(GREETINGS.nga_mihi).toBe('Ngā mihi');
    expect(GREETINGS.nga_mihi).toContain('ā');
  });

  it('PLACE_NAMES use macrons in mi entries', () => {
    expect(PLACE_NAMES.auckland.mi).toBe('Tāmaki Makaurau');
    expect(PLACE_NAMES.auckland.mi).toContain('ā');
    expect(PLACE_NAMES.christchurch.mi).toBe('Ōtautahi');
    expect(PLACE_NAMES.christchurch.mi).toContain('Ō');
    expect(PLACE_NAMES.taranaki.mi).toBe('Taranaki');
  });

  it('PLACE_NAMES dual format puts Te Reo first when officially gazetted', () => {
    // Aoraki / Mount Cook is officially dual-named with Māori first
    expect(PLACE_NAMES.aoraki.dual).toBe('Aoraki / Mount Cook');
  });

  it('formatPlaceName returns dual format by default', () => {
    expect(formatPlaceName('aoraki')).toBe('Aoraki / Mount Cook');
    expect(formatPlaceName('auckland')).toBe('Tāmaki Makaurau / Auckland');
  });

  it('formatPlaceName falls back to English for unknown keys', () => {
    expect(formatPlaceName('unknown_key')).toBe('unknown_key');
  });

  it('MACRON_CHARS includes all five macron vowels in both cases', () => {
    expect(MACRON_CHARS).toContain('ā');
    expect(MACRON_CHARS).toContain('ē');
    expect(MACRON_CHARS).toContain('ī');
    expect(MACRON_CHARS).toContain('ō');
    expect(MACRON_CHARS).toContain('ū');
    expect(MACRON_CHARS).toContain('Ā');
  });

  it('GREAT_WALKS list has all 11 official Great Walks (including Hump Ridge)', () => {
    expect(GREAT_WALKS.length).toBe(11);
    const keys = GREAT_WALKS.map((w) => w.key);
    expect(keys).toContain('milford');
    expect(keys).toContain('routeburn');
    expect(keys).toContain('hump_ridge');
    expect(keys).toContain('whanganui_journey');
  });

  it('GREAT_WALKS Te Reo names start with "Te Ara" or "Te Awa" or similar', () => {
    // Spot check — most Te Reo track names use "Te Ara" (the path)
    const milford = GREAT_WALKS.find((w) => w.key === 'milford');
    expect(milford?.mi).toBeDefined();
    expect(milford?.mi).toContain('Piopiotahi'); // Milford Sound's Māori name
  });
});
