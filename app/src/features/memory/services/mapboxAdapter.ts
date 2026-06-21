/**
 * Mapbox runtime adapter — single place that conditionally requires
 * @rnmapbox/maps and re-exports its components. Avoids duplicating
 * the Platform.OS=='web' fallback in every map-using component.
 *
 * If a future migration to MapLibre or another tiles provider happens,
 * the swap is contained to this file.
 */

import { Platform } from 'react-native';

interface MapboxAdapter {
  MapView: any;
  Camera: any;
  PointAnnotation: any;
  UserLocation: any;
  LineLayer: any;
  FillLayer: any;
  ShapeSource: any;
  available: boolean;
}

let cached: MapboxAdapter | null = null;

export function getMapbox(): MapboxAdapter {
  if (cached) return cached;
  if (Platform.OS === 'web') {
    // R-round Phase 2: on web, use the react-map-gl shim so Playwright
    // can drive a real Mapbox render. Falls back to unavailable if the
    // shim module can't load (e.g. in jsdom-based unit tests).
    try {
      // Metro resolves `mapboxAdapter.web` to mapboxAdapter.web.tsx on
      // web target; we add the explicit '.web' extension so node-side
      // jest does NOT accidentally try to load it.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const shim = require('./mapboxAdapter.web.tsx');
      cached = shim.makeWebMapboxAdapter();
      console.log('[mapboxAdapter] web shim loaded', { available: cached?.available });
    } catch (e) {
      console.warn('[mapboxAdapter] web shim load failed', e);
      cached = makeUnavailable();
    }
    return cached;
  }
  try {
    const m = require('@rnmapbox/maps');
    cached = {
      MapView: m.MapView,
      Camera: m.Camera,
      PointAnnotation: m.PointAnnotation,
      UserLocation: m.UserLocation,
      LineLayer: m.LineLayer,
      FillLayer: m.FillLayer,
      ShapeSource: m.ShapeSource,
      available: true,
    };
  } catch {
    cached = makeUnavailable();
  }
  return cached;
}

function makeUnavailable(): MapboxAdapter {
  return {
    MapView: null,
    Camera: null,
    PointAnnotation: null,
    UserLocation: null,
    LineLayer: null,
    FillLayer: null,
    ShapeSource: null,
    available: false,
  };
}
