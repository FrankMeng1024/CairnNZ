import { MAP_ORNAMENTS_EDGE, mapOrnamentsAbove } from '../mapOrnaments';

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
});
