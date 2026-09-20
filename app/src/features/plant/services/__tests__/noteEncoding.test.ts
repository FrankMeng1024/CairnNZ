import {
  cairnDisplayTitle,
  encodeTitleBody,
  splitTitleBody,
} from '../noteEncoding';

describe('Cairn note presentation', () => {
  test('keeps title and multiline note round-trippable', () => {
    const encoded = encodeTitleBody('Wind shelf', 'Shelter behind the rock\nDry at noon');
    expect(splitTitleBody(encoded)).toEqual({
      title: 'Wind shelf',
      body: 'Shelter behind the rock\nDry at noon',
    });
  });

  test('a one-tap Cairn receives the shared non-persisted fallback', () => {
    const label = cairnDisplayTitle('', '', Date.UTC(2026, 8, 13));
    expect(label).toBe('A moment here');
  });

  test('legacy body content is preserved but never promoted into the title', () => {
    expect(cairnDisplayTitle('', 'Water after the bridge\nSeasonal', 0)).toBe('A moment here');
    expect(splitTitleBody('Water after the bridge\nSeasonal')).toEqual({
      title: '',
      body: 'Water after the bridge\nSeasonal',
    });
  });

  test('authored names are returned verbatim apart from blank detection', () => {
    expect(cairnDisplayTitle('  Wind shelf  ', 'ignored', 0)).toBe('  Wind shelf  ');
  });
});
