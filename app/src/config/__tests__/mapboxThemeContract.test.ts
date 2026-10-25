import {
  buildStandardConfig,
  getMapStyleForTheme,
  themeToStandardPreset,
} from '../mapbox';

describe('native Mapbox Standard theme contract', () => {
  test.each([
    ['day', 'day'],
    ['sunset', 'dawn'],
    ['night', 'night'],
  ] as const)('%s resolves Standard with the %s light preset', (theme, preset) => {
    expect(getMapStyleForTheme('outdoors', theme)).toEqual({
      kind: 'url',
      url: 'mapbox://styles/mapbox/standard',
    });
    expect(themeToStandardPreset(theme)).toBe(preset);
    expect(buildStandardConfig(theme)).toMatchObject({
      lightPreset: preset,
      show3dObjects: false,
      showPedestrianRoads: true,
      showPlaceLabels: true,
      showRoadLabels: true,
    });
  });

  test('Sunset and Night apply distinct semantic cartography colours', () => {
    expect(buildStandardConfig('sunset')).toMatchObject({
      colorLand: '#D8CDBF',
      colorWater: '#7F9DA5',
      colorRoads: '#F4EBDD',
    });
    expect(buildStandardConfig('night')).toMatchObject({
      colorLand: '#263440',
      colorWater: '#17364A',
      colorRoads: '#68766F',
    });
  });
});
