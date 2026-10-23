import { MAP_ORNAMENTS_EDGE, MEMORY_MAP_ORNAMENTS, groupedMapOrnamentsAbove, mapOrnamentsAbove } from '../mapOrnaments';

describe('Mapbox ornament placement', () => {
  test('keeps genuine legal controls together at the exposed lower-left edge', () => {
    expect(MAP_ORNAMENTS_EDGE).toEqual({
      logoPosition: { bottom: 8, left: 8 },
      attributionPosition: { bottom: 8, left: 92 },
    });
    expect(mapOrnamentsAbove(246)).toEqual({
      logoPosition: { bottom: 246, left: 8 },
      attributionPosition: { bottom: 246, left: 92 },
    });
  });

  test('Route workspace groups the genuine logo and information control at lower-left', () => {
    expect(groupedMapOrnamentsAbove(246)).toEqual({
      logoPosition: { bottom: 246, left: 8 },
      attributionPosition: { bottom: 246, left: 92 },
    });
  });

  test('Memory keeps legal controls at opposite bottom edges and clear of map controls', () => {
    expect(MEMORY_MAP_ORNAMENTS).toEqual({
      logoPosition: { bottom: 8, left: 8 },
      attributionPosition: { bottom: 8, right: 8 },
    });
  });
});
