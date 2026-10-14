import {
  buildStandardConfig,
  getMapStyleForTheme,
  themeToStandardPreset,
} from '../mapbox';

describe('native Mapbox Standard theme contract', () => {
  test.each([
    ['day', 'day'],
    ['sunset', 'dusk'],
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
});
