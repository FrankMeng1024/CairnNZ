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
  CircleLayer: any;
  // v383: SymbolLayer + Images + Image needed for sprite-driven pin rendering
  // with zoom-responsive iconSize. Images supports children (Mapbox.Image
  // wrapping a RN View tree) so sprites render via OTA-only JS — no native
  // PNG asset shipped, no eas build required.
  SymbolLayer: any;
  Images: any;
  Image: any;
  // v393: MarkerView — viewAnnotations-based, NO rasterise, NO async-commit
  // race with react-native-svg. PointAnnotation's bitmap rasterise misses
  // react-native-svg CAShapeLayer (commits on next CATransaction, ~16ms after
  // PointAnnotation's 10μs delay). MarkerView attaches actual UIView to map.
  MarkerView: any;
  /**
   * R21-v3 (2026-08-30) — Standard style config injector. Used by Plant
   * PinAdjust to set lightPreset (day/dusk/night). Only defined on native
   * (Mapbox v11+); web shim leaves it null.
   */
  StyleImport: any;
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
      if (__DEV__) console.log('[mapboxAdapter] web shim loaded', { available: cached?.available });
    } catch (e) {
      console.warn('[mapboxAdapter] web shim load failed', e);
      cached = makeUnavailable();
    }
    return cached!;
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
      CircleLayer: m.CircleLayer,
      SymbolLayer: m.SymbolLayer,
      Images: m.Images,
      Image: m.Image,
      MarkerView: m.MarkerView,
      StyleImport: m.StyleImport,
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
    CircleLayer: null,
    SymbolLayer: null,
    Images: null,
    Image: null,
    MarkerView: null,
    StyleImport: null,
    available: false,
  };
}
