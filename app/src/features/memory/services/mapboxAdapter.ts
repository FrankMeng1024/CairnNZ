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
    cached = makeUnavailable();
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
