import {
  hasRenderedHostedMapboxBasemap,
  sourceUsesHostedMapbox,
} from '../mapboxWebReadiness';

describe('Mapbox Web rendered-basemap readiness', () => {
  test('recognizes Mapbox style and tile authorities', () => {
    expect(sourceUsesHostedMapbox({ url: 'mapbox://mapbox.mapbox-streets-v8' })).toBe(true);
    expect(sourceUsesHostedMapbox({ tiles: ['https://api.mapbox.com/v4/example/{z}/{x}/{y}.pbf'] })).toBe(true);
    expect(sourceUsesHostedMapbox({ url: 'https://example.invalid/style' })).toBe(false);
    expect(sourceUsesHostedMapbox({})).toBe(false);
  });

  test('accepts a rendered feature only from a hosted source in the active style', () => {
    const map = {
      getStyle: () => ({
        sources: {
          composite: { url: 'mapbox://mapbox.mapbox-streets-v8' },
          'activity-track': { url: 'https://example.invalid/local-track' },
        },
      }),
      queryRenderedFeatures: () => [
        { source: 'activity-track' },
        { source: 'composite' },
      ],
    };
    expect(hasRenderedHostedMapboxBasemap(map)).toBe(true);
  });

  test('rejects app overlays, empty scenes, and probe failures', () => {
    expect(hasRenderedHostedMapboxBasemap({
      getStyle: () => ({
        sources: {
          composite: { url: 'mapbox://mapbox.mapbox-streets-v8' },
          'activity-track': {},
        },
      }),
      queryRenderedFeatures: () => [{ source: 'activity-track' }],
    })).toBe(false);
    expect(hasRenderedHostedMapboxBasemap({
      getStyle: () => ({ sources: { composite: { url: 'mapbox://mapbox.mapbox-streets-v8' } } }),
      queryRenderedFeatures: () => [],
    })).toBe(false);
    expect(hasRenderedHostedMapboxBasemap({
      getStyle: () => { throw new Error('style unavailable'); },
      queryRenderedFeatures: () => [{ source: 'composite' }],
    })).toBe(false);
  });
});
