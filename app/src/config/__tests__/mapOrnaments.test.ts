import { MAP_ORNAMENTS_EDGE, MEMORY_MAP_ORNAMENTS, groupedMapOrnamentsAbove, mapOrnamentsAbove } from '../mapOrnaments';

describe('Mapbox ornament placement', () => {
  test('splits genuine legal controls across the exposed lower edge', () => {
    expect(MAP_ORNAMENTS_EDGE).toEqual({
      logoPosition: { bottom: 8, left: 8 },
      attributionPosition: { bottom: 8, right: 8 },
    });
    expect(mapOrnamentsAbove(246)).toEqual({
      logoPosition: { bottom: 246, left: 8 },
      attributionPosition: { bottom: 246, right: 8 },
    });
  });

  test('Route workspace keeps the information control at lower-right', () => {
    expect(groupedMapOrnamentsAbove(246)).toEqual({
      logoPosition: { bottom: 246, left: 8 },
      attributionPosition: { bottom: 246, right: 8 },
    });
  });

  test('Memory keeps the interactive information control at lower-right', () => {
    expect(MEMORY_MAP_ORNAMENTS).toEqual({
      logoPosition: { bottom: 8, left: 8 },
      attributionPosition: { bottom: 8, right: 8 },
    });
  });
});
