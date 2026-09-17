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

  test('a one-tap Cairn receives a useful date identity', () => {
    const label = cairnDisplayTitle('', '', Date.UTC(2026, 8, 13));
    expect(label).toMatch(/^Cairn · /);
    expect(label).not.toMatch(/untitled/i);
  });

  test('legacy body content remains rediscoverable as the display name', () => {
    expect(cairnDisplayTitle('', 'Water after the bridge\nSeasonal', 0)).toBe('Water after the bridge');
    expect(splitTitleBody('Water after the bridge\nSeasonal')).toEqual({
      title: '',
      body: 'Water after the bridge\nSeasonal',
    });
  });
});
