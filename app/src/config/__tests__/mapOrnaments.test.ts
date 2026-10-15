import { MAP_ORNAMENTS_EDGE, groupedMapOrnamentsAbove, mapOrnamentsAbove } from '../mapOrnaments';

describe('Mapbox ornament placement', () => {
  test('keeps legal controls in separate corners with one shared clearance', () => {
    expect(MAP_ORNAMENTS_EDGE).toEqual({
      logoPosition: { bottom: 8, left: 8 },
      attributionPosition: { bottom: 8, right: 8 },
    });
    expect(mapOrnamentsAbove(246)).toEqual({
      logoPosition: { bottom: 246, left: 8 },
      attributionPosition: { bottom: 246, right: 8 },
    });
  });

  test('Route workspace groups the genuine logo and information control at lower-left', () => {
    expect(groupedMapOrnamentsAbove(246)).toEqual({
      logoPosition: { bottom: 246, left: 8 },
      attributionPosition: { bottom: 246, left: 92 },
    });
  });
});
