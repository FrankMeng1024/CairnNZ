/**
 * mapboxAdapter.web — web-only shim that maps the @rnmapbox/maps API
 * surface used by Cairn (MapView/Camera/ShapeSource/FillLayer/LineLayer/
 * UserLocation) onto react-map-gl's mapbox-gl bindings.
 *
 * Why this exists:
 *   - We need Playwright to render real Mapbox tiles so that fog-donut,
 *     pin-clamp, and zoom-vs-pan bugs can be reproduced and verified
 *     automatically in a web browser BEFORE the user takes the build to
 *     a real device. (See feedback_playwright_before_realdevice.md.)
 *   - @rnmapbox/maps is a native-only binding; on web it's stubbed in
 *     mapboxAdapter.ts to `available:false` which makes MemoryMap and
 *     PinAdjustStep fall through to blank/placeholder UIs.
 *   - react-map-gl + mapbox-gl already in package.json — this file
 *     bridges the two component shapes so the production component
 *     code (MemoryMap.tsx, PinAdjustStep.tsx) doesn't need any
 *     Platform.OS=='web' branches.
 *
 * API contract — these components are NOT pixel-identical to native,
 * but they ARE structurally equivalent:
 *   - <MapView> → react-map-gl <Map>
 *   - <Camera centerCoordinate={[lng,lat]} zoomLevel={z}
 *     defaultSettings={{...}}/> → <Map initialViewState={{lng,lat,zoom}}>
 *     (Camera key remount triggers state update via internal map ref)
 *   - <ShapeSource id shape={geoJson}> + <FillLayer/LineLayer
 *     style={{...}}/> → react-map-gl <Source> + <Layer>
 *   - <UserLocation visible> → small <Marker> using the shared device-location style
 *   - onMapIdle(feature) → react-map-gl onIdle (we synth a feature
 *     payload with properties.center + properties.zoom to match the
 *     native event shape that PinAdjustStep onMapSettle reads)
 *
 * Style cost translation:
 *   - native uses object-literal style props (fillColor, lineColor…)
 *     which match Mapbox GL paint property names with camelCase.
 *   - react-map-gl Layer.paint is the same Mapbox GL JSON style, but
 *     keys are kebab-case ('fill-color', 'line-color'). We do the
 *     conversion in the layer components below.
 */

import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Image as ReactNativeImage } from 'react-native';
import { Map as MapGL, Source, Layer, Marker, AttributionControl } from 'react-map-gl/mapbox-legacy';
import type { MapRef } from 'react-map-gl/mapbox-legacy';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { guardMapboxGl2RetiredDispatcher } from './mapboxGl2LifecycleGuard';
import { queryWebShapeSourcePressFeatures } from './mapboxAdapterWebPress';
import { hasRenderedHostedMapboxBasemap } from './mapboxWebReadiness';
import { reconcileWebLayerPosition } from './mapboxLayerPosition';
import {
  CURRENT_LOCATION_DOT_STYLE,
  CURRENT_LOCATION_RING_STYLE,
} from '../../../components/map/currentLocationMarkerStyle';

const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const POINT_MOTION_RASTER_SOURCE_ID = 'cairn-point-motion-basemap-source';
const POINT_MOTION_RASTER_LAYER_ID = 'cairn-point-motion-basemap-layer';
// Non-secret sentinel used only with the source-free development QA style.
// Its session request is intercepted by the visual harness; it is never used
// to access Mapbox tiles or emitted by production builds.
const LOCAL_QA_MAPBOX_TOKEN = 'pk.cairn-local-qa-no-network';
const WEB_SUNSET_STYLE = require('../../../../assets/map-styles/sunset-2d.json');
const WEB_MAPBOX_AVAILABLE = MAPBOX_ACCESS_TOKEN.trim().startsWith('pk.')
  && MAPBOX_ACCESS_TOKEN.trim().length >= 40;

// Cairn Web is a single-page app with several Mapbox surfaces. Keeping the
// documented shared worker pool warm prevents a completed style request from
// racing the last Map's worker termination while navigation constructs the
// next Map. `prewarm()` is synchronous and idempotent in GL JS v2.
if (typeof window !== 'undefined') mapboxgl.prewarm();
const LOCAL_QA_STYLE = {
  version: 8 as const,
  name: 'Cairn local QA canvas',
  // Keep the SDK's genuine compact attribution control measurable without
  // contacting a tile provider. This source is empty; its attribution is
  // consumed by Mapbox GL's own control rather than rendered by Cairn.
  sources: {
    'qa-attribution': {
      type: 'geojson' as const,
      data: { type: 'FeatureCollection' as const, features: [] },
      attribution: '<a href="https://www.mapbox.com/about/maps/">© Mapbox</a>',
    },
  },
  layers: [
    { id: 'qa-background', type: 'background' as const, paint: { 'background-color': '#dce5d4' } },
    { id: 'qa-attribution-anchor', type: 'circle' as const, source: 'qa-attribution', paint: { 'circle-opacity': 0 } },
  ],
};

// ── camelCase → kebab-case for Mapbox GL paint properties ─────────────
function paintToKebab(style: Record<string, any> | undefined): Record<string, any> {
  if (!style) return {};
  const out: Record<string, any> = {};
  for (const k of Object.keys(style)) {
    const kebab = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    out[kebab] = style[k];
  }
  return out;
}

// ── Context for child sources/layers to grab the parent map ref ────────
const MapInstanceContext = React.createContext<React.MutableRefObject<MapRef | null> | null>(null);

// ── MapView ────────────────────────────────────────────────────────────
interface MapViewProps {
  style?: any;
  styleURL?: string;
  /**
   * R21-v3 (2026-08-30) — inline Mapbox GL style JSON as string, matches
   * rnmapbox `styleJSON` prop. Used by the sunset theme path.
   */
  styleJSON?: string;
  onMapIdle?: (feature: any) => void;
  onWillStartLoadingMap?: () => void;
  onDidFinishLoadingStyle?: () => void;
  onDidFinishLoadingMap?: () => void;
  onDidFinishRenderingMapFully?: () => void;
  onDidFinishRenderingFrameFully?: () => void;
  onMapLoadingError?: (event: unknown) => void;
  // v297 — high-frequency camera change events used by PinAdjustStep
  // to keep a "latest pan position" ref in sync with map state, so
  // the confirm-tap handler can read the true map center without the
  // onIdle latency window (subagent review B2). Maps to mapbox-gl
  // `onMove` (fires continuously during drag/zoom).
  onCameraChanged?: (feature: any) => void;
  compassEnabled?: boolean;
  scaleBarEnabled?: boolean;
  attributionEnabled?: boolean;
  logoEnabled?: boolean;
  logoPosition?: { top?: number; bottom?: number; left?: number; right?: number };
  attributionPosition?: { top?: number; bottom?: number; left?: number; right?: number };
  // Native-only props. Listed here so TypeScript / consumers
  // (PinAdjustStep, MemoryMap) can pass them on both targets
  // without `Platform.OS=='web'` branches; the web shim ignores
  // them because the equivalent behavior is achieved via the
  // mapbox-gl handler API in the mapRef onRef callback (see
  // touchZoomRotate.enable({around:'center'}) below).
  gestureSettings?: {
    pinchPanEnabled?: boolean;
    rotateEnabled?: boolean;
    pitchEnabled?: boolean;
    panEnabled?: boolean;
    pinchZoomEnabled?: boolean;
  };
  children?: React.ReactNode;
}

type WebControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export function webControlPosition(
  position: MapViewProps['logoPosition'],
  fallback: WebControlPosition,
): WebControlPosition {
  if (!position) return fallback;
  const vertical = position.top != null ? 'top' : 'bottom';
  const horizontal = position.left != null ? 'left' : 'right';
  return `${vertical}-${horizontal}` as WebControlPosition;
}

function controlOffsetStyle(position: MapViewProps['logoPosition']): React.CSSProperties {
  if (!position) return {};
  return {
    position: 'relative',
    ...(position.top != null ? { top: position.top } : {}),
    ...(position.bottom != null ? { bottom: position.bottom } : {}),
    ...(position.left != null ? { left: position.left } : {}),
    ...(position.right != null ? { right: position.right } : {}),
  };
}

function applyLogoOffset(map: any, position: MapViewProps['logoPosition']) {
  const container = map?.getContainer?.() as HTMLElement | undefined;
  const logo = container?.querySelector?.('.mapboxgl-ctrl-logo') as HTMLElement | null;
  if (!logo || !position) return;
  // Offset the genuine logo control itself, not its shared Mapbox corner.
  // Moving the corner would also move AttributionControl and double-apply its
  // own numeric inset whenever both legal controls intentionally share it.
  logo.style.position = 'relative';
  logo.style.top = position.top != null ? `${position.top}px` : '';
  logo.style.bottom = position.bottom != null ? `${position.bottom}px` : '';
  logo.style.left = position.left != null ? `${position.left}px` : '';
  logo.style.right = position.right != null ? `${position.right}px` : '';
}

export const MapView = React.forwardRef<any, MapViewProps>(function MapView({
  style,
  styleURL,
  styleJSON,
  onMapIdle,
  onCameraChanged,
  onWillStartLoadingMap,
  onDidFinishLoadingStyle,
  onDidFinishLoadingMap,
  onDidFinishRenderingMapFully,
  onDidFinishRenderingFrameFully,
  onMapLoadingError,
  attributionEnabled = true,
  logoEnabled = true,
  logoPosition,
  attributionPosition,
  children,
}: MapViewProps, ref) {
  const mapRef = useRef<MapRef | null>(null);
  const loadingStartedRef = useRef(false);
  const styleReadyEmittedRef = useRef(false);
  const mapReadyEmittedRef = useRef(false);
  const lastProgrammaticCameraEventAtRef = useRef(0);
  const pointMotionVisibilityRef = useRef(new Map<string, unknown>());
  const pointMotionGenerationRef = useRef(0);

  React.useImperativeHandle(ref, () => ({
    requestRender: () => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      inner?.triggerRepaint?.();
    },
    refreshLayout: () => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      inner?.resize?.();
      inner?.triggerRepaint?.();
    },
    isSourceLoaded: (sourceId: string) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      if (!inner?.getSource?.(sourceId)) return false;
      return typeof inner.isSourceLoaded === 'function'
        ? Boolean(inner.isSourceLoaded(sourceId))
        : true;
    },
    areLayersRendered: (layerIds: string[], readinessKey?: string) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      if (!inner?.queryRenderedFeatures || !Array.isArray(layerIds) || layerIds.length === 0) return false;
      try {
        return layerIds.every(layerId => inner.getLayer?.(layerId)
          && inner.queryRenderedFeatures(undefined, { layers: [layerId] }).some((feature: any) => (
            !readinessKey || feature?.properties?.cairnReadinessKey === readinessKey
          )));
      } catch {
        return false;
      }
    },
    hasRenderedScene: (layerIds: string[], readinessKey?: string) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      if (!inner?.queryRenderedFeatures || !Array.isArray(layerIds) || layerIds.length === 0) return false;
      try {
        // Fog/Mine/Friends/Overlap are filtered views of one atomic GeoJSON
        // source. A feature carrying the exact readiness key in any visible
        // semantic layer proves that correlated setData reached the worker.
        // Requiring Fog specifically deadlocked a fully explored viewport,
        // where the Fog complement legitimately has no rendered pixels.
        return layerIds.some(layerId => inner.getLayer?.(layerId)
          && inner.queryRenderedFeatures(undefined, { layers: [layerId] }).some((feature: any) => (
            !readinessKey || feature?.properties?.cairnReadinessKey === readinessKey
          )));
      } catch {
        return false;
      }
    },
    getPointInView: async (coordinate: [number, number]) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      const point = inner?.project?.(coordinate);
      return point ? [point.x, point.y] : null;
    },
    getCoordinateFromView: async (screenPoint: [number, number]) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      const coordinate = inner?.unproject?.(screenPoint);
      return coordinate ? [coordinate.lng, coordinate.lat] : null;
    },
    getVisibleBounds: async () => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      const bounds = inner?.getBounds?.();
      const northEast = bounds?.getNorthEast?.();
      const southWest = bounds?.getSouthWest?.();
      if (!northEast || !southWest) return null;
      // Match RNMapbox MapView#getVisibleBounds: north-east, south-west.
      return [
        [northEast.lng, northEast.lat],
        [southWest.lng, southWest.lat],
      ];
    },
    queryRenderedFeaturesInRect: async (
      screenRect: [number, number, number, number],
      filter: unknown[] = [],
      layerIDs: string[] | null = null,
    ) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      if (!inner?.queryRenderedFeatures || !Array.isArray(screenRect) || screenRect.length !== 4) {
        return { features: [] };
      }
      // RNMapbox rectangles use [top, left, bottom, right]; Mapbox GL JS
      // expects [[left, top], [right, bottom]].
      const [top, left, bottom, right] = screenRect;
      const options: { layers?: string[]; filter?: unknown[] } = {};
      if (Array.isArray(layerIDs) && layerIDs.length > 0) options.layers = layerIDs;
      if (Array.isArray(filter) && filter.length > 0) options.filter = filter;
      const features = inner.queryRenderedFeatures(
        [[left, top], [right, bottom]],
        options,
      );
      return {
        features: features.map((feature: any) => (
          typeof feature?.toJSON === 'function' ? feature.toJSON() : feature
        )),
      };
    },
    setPointMotionBasemapActive: async (active: boolean) => {
      const inner = mapRef.current?.getMap?.() ?? mapRef.current;
      if (!inner) return;
      const generation = ++pointMotionGenerationRef.current;
      const remembered = pointMotionVisibilityRef.current;
      if (active) {
        let rasterReady = false;
        try {
          if (WEB_MAPBOX_AVAILABLE && !inner.getSource?.(POINT_MOTION_RASTER_SOURCE_ID)) {
            inner.addSource(POINT_MOTION_RASTER_SOURCE_ID, {
              type: 'raster',
              tiles: [`https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}?access_token=${encodeURIComponent(MAPBOX_ACCESS_TOKEN)}`],
              tileSize: 512,
              // Overscale zoom-14 imagery during the short follow. One tile
              // covers the complete representative Point corridor at phone
              // scale, avoiding mid-animation raster decode churn while the
              // live route/endpoint layers remain full-resolution vectors.
              maxzoom: 14,
            });
          }
          if (inner.getSource?.(POINT_MOTION_RASTER_SOURCE_ID)
            && !inner.getLayer?.(POINT_MOTION_RASTER_LAYER_ID)) {
            const beforeId = inner.getLayer?.('memory-fog')
              ? 'memory-fog'
              : inner.getLayer?.('ordered-route-casing') ? 'ordered-route-casing' : undefined;
            inner.addLayer({
              id: POINT_MOTION_RASTER_LAYER_ID,
              type: 'raster',
              source: POINT_MOTION_RASTER_SOURCE_ID,
              paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
            }, beforeId);
          }
          rasterReady = Boolean(inner.getLayer?.(POINT_MOTION_RASTER_LAYER_ID));
          if (rasterReady) {
            await new Promise<void>(resolve => {
              let timeoutId: ReturnType<typeof setTimeout> | null = null;
              const finish = () => {
                if (timeoutId != null) clearTimeout(timeoutId);
                inner.off?.('idle', finish);
                resolve();
              };
              inner.once?.('idle', finish);
              timeoutId = setTimeout(finish, 900);
            });
          }
        } catch { rasterReady = false; }
        if (generation !== pointMotionGenerationRef.current) return;
        let layers: any[] = [];
        try { layers = inner.getStyle?.()?.layers ?? []; } catch { return; }
        for (const layer of layers) {
          const sourceLayer = layer['source-layer'];
          const keepWalkingContext = sourceLayer === 'water' || sourceLayer === 'waterway'
            || /^(tunnel|road|bridge)-(path-trail|path-cycleway-piste|path|steps|pedestrian|minor|street|secondary-tertiary|primary|motorway-trunk)$/.test(layer.id)
            || layer.id === 'ferry';
          const suppress = (layer.type === 'symbol' && sourceLayer != null)
            || (sourceLayer != null && (rasterReady || !keepWalkingContext))
            || /hillshade|terrain/.test(layer.id);
          if (!suppress) continue;
          if (!remembered.has(layer.id)) {
            remembered.set(layer.id, inner.getLayoutProperty?.(layer.id, 'visibility'));
          }
          try { inner.setLayoutProperty(layer.id, 'visibility', 'none'); } catch { /* style replacement */ }
        }
        await new Promise<void>(resolve => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (timeoutId != null) clearTimeout(timeoutId);
            inner.off?.('idle', finish);
            resolve();
          };
          inner.once?.('idle', finish);
          timeoutId = setTimeout(finish, 350);
        });
        return;
      }
      for (const [layerId, visibility] of remembered) {
        if (!inner.getLayer?.(layerId)) continue;
        try { inner.setLayoutProperty(layerId, 'visibility', visibility ?? 'visible'); } catch { /* style replacement */ }
      }
      remembered.clear();
      await new Promise<void>(resolve => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
          if (timeoutId != null) clearTimeout(timeoutId);
          inner.off?.('idle', finish);
          resolve();
        };
        inner.once?.('idle', finish);
        timeoutId = setTimeout(finish, 500);
      });
      if (generation !== pointMotionGenerationRef.current) return;
      try {
        if (inner.getLayer?.(POINT_MOTION_RASTER_LAYER_ID)) inner.removeLayer(POINT_MOTION_RASTER_LAYER_ID);
        if (inner.getSource?.(POINT_MOTION_RASTER_SOURCE_ID)) inner.removeSource(POINT_MOTION_RASTER_SOURCE_ID);
      } catch { /* style may be unmounting */ }
    },
  }), []);

  useEffect(() => () => {
    const inner = mapRef.current?.getMap?.() ?? mapRef.current;
    if (typeof window !== 'undefined' && (window as any).__cairnMap === inner) {
      delete (window as any).__cairnMap;
    }
  }, []);

  useEffect(() => {
    const inner = mapRef.current?.getMap?.() ?? mapRef.current;
    if (inner && logoEnabled) applyLogoOffset(inner, logoPosition);
  }, [logoEnabled, logoPosition?.top, logoPosition?.bottom, logoPosition?.left, logoPosition?.right]);

  useEffect(() => {
    if (loadingStartedRef.current) return;
    loadingStartedRef.current = true;
    onWillStartLoadingMap?.();
  }, [onWillStartLoadingMap]);

  // Translate mapbox:// style url to a public URL the JS SDK accepts.
  // mapbox-gl@2 actually accepts mapbox:// style URLs natively if a token
  // is set, so no rewrite needed.
  // R21-v3 (2026-08-30): styleJSON takes precedence over styleURL when
  // provided (matches rnmapbox precedence). We parse it once and pass the
  // object to react-map-gl's `mapStyle` prop.
  const parsedStyleJSON = useMemo(() => {
    if (!styleJSON) return null;
    try { return JSON.parse(styleJSON); } catch { return null; }
  }, [styleJSON]);
  const standardLightPreset = React.Children.toArray(children).reduce<string | null>((preset, child) => {
    if (preset || !React.isValidElement(child)) return preset;
    const candidate = (child.props as any)?.config?.lightPreset;
    return candidate === 'day' || candidate === 'dusk' || candidate === 'night'
      ? candidate
      : null;
  }, null);
  // GL JS v2 cannot consume Standard imports. Keep Web on genuine supported
  // Mapbox/vector styles while preserving the app's actual three-state
  // contract: outdoors for Day, the packaged Mapbox-vector Sunset style for
  // Dusk, and Mapbox Navigation Night for Night. Native continues to receive
  // Standard plus its real lightPreset unchanged.
  const webStandardFallback = standardLightPreset === 'night'
    ? 'mapbox://styles/mapbox/navigation-night-v1'
    : standardLightPreset === 'dusk'
      ? WEB_SUNSET_STYLE
      : 'mapbox://styles/mapbox/outdoors-v12';
  const rewrittenStyleURL = (styleURL === 'mapbox://styles/mapbox/standard')
    ? webStandardFallback
    : styleURL;
  const styleUrl = rewrittenStyleURL ?? 'mapbox://styles/mapbox/outdoors-v12';
  const localQaStyleEnabled = process.env.NODE_ENV !== 'production'
    && typeof window !== 'undefined'
    && Boolean((window as any).__cairnMapQaLocalStyle);
  const localQaTestMode = localQaStyleEnabled
    && (window as any).__cairnMapQaTestMode !== false;
  // Explicit visual-harness-only framebuffer retention. Production never
  // sets this global; ordinary Web rendering keeps Mapbox's default. The
  // retained buffer lets the harness distinguish a blank Mapbox draw from a
  // compositor/page-screenshot capture failure on older macOS/Intel hosts.
  const localQaPreserveDrawingBuffer = localQaStyleEnabled
    && Boolean((window as any).__cairnMapQaPreserveDrawingBuffer);
  const effectiveStyleIdentity = localQaStyleEnabled
    ? 'local-qa-style'
    : styleJSON ?? styleUrl;
  useEffect(() => {
    styleReadyEmittedRef.current = false;
    mapReadyEmittedRef.current = false;
  }, [effectiveStyleIdentity]);
  const emitWebMapReadiness = React.useCallback((target: any, requireHostedFeature: boolean) => {
    if (requireHostedFeature && !hasRenderedHostedMapboxBasemap(target)) return false;
    if (!styleReadyEmittedRef.current) {
      styleReadyEmittedRef.current = true;
      onDidFinishLoadingStyle?.();
    }
    if (!mapReadyEmittedRef.current) {
      mapReadyEmittedRef.current = true;
      onDidFinishLoadingMap?.();
    }
    return true;
  }, [onDidFinishLoadingMap, onDidFinishLoadingStyle]);

  // react-map-gl needs an initialViewState. We pull it from the first
  // <Camera> child if present. Otherwise default to a sensible center.
  const firstCamera = React.Children.toArray(children).find(
    (c) => React.isValidElement(c) && (c.type as any)?.__cairnMapboxComponent === 'Camera',
  ) as React.ReactElement<CameraProps> | undefined;
  const defaults = firstCamera?.props.defaultSettings;
  const initialCenter = defaults?.centerCoordinate ?? firstCamera?.props.centerCoordinate;
  const initialZoom = defaults?.zoomLevel ?? firstCamera?.props.zoomLevel ?? 12;

  return (
    <MapInstanceContext.Provider value={mapRef}>
      <div style={{
        ...(style ?? {}),
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        width: '100%', height: '100%',
        minHeight: 200,
      }}>
        <MapGL
          {...(localQaTestMode ? ({ testMode: true } as any) : {})}
          preserveDrawingBuffer={localQaPreserveDrawingBuffer}
          ref={(r) => {
            const previous = mapRef.current?.getMap?.() ?? mapRef.current;
            mapRef.current = r;
            if (!r) {
              if (typeof window !== 'undefined' && (window as any).__cairnMap === previous) {
                delete (window as any).__cairnMap;
              }
              return;
            }
            // Expose underlying mapbox-gl Map on `window.__cairnMap` for
            // Playwright introspection (see feedback_playwright_before_realdevice.md).
            // No-op for end users — there is no UI that depends on it.
            if (typeof window !== 'undefined') {
              const inner = r.getMap?.() ?? r;
              (window as any).__cairnMap = inner;

              // GL JS v2 schedules IndexedDB tile-cache trimming by sending
              // through the map's dispatcher from an asynchronous tile
              // response. If navigation removes that dispatcher first, v2
              // dereferences an empty actor (`undefined.send`). Browser quota
              // eviction already bounds this optional cache; disable only the
              // racy worker-side trim cadence for Cairn's Web SPA. Native
              // RNMapbox and tile rendering/caching are unchanged.
              inner._setCacheLimits?.(500, Number.POSITIVE_INFINITY);
              guardMapboxGl2RetiredDispatcher(inner);

              // Pin-as-zoom-anchor: tell mapbox-gl to anchor every pinch
              // and wheel zoom on the viewport center (which is where
              // the absolute pin div sits). Without this, pinch uses
              // the finger midpoint as the zoom focal — the pin's GPS
              // coord drifts off the screen-center pin marker as the
              // user zooms. See subagent_b investigation: mapbox-gl
              // src/ui/handler/touch_zoom_rotate.js:78-81 (around=center).
              try {
                inner.touchZoomRotate?.enable?.({ around: 'center' });
                inner.scrollZoom?.enable?.({ around: 'center' });
              } catch (e) {
                // Older mapbox-gl versions may not accept the {around}
                // option object — fall back silently rather than break
                // the map for users on stale clients.
              }

              // Zoom / pan mutual exclusion: when two fingers go down
              // (pinch), disable touchPan; restore on touchend. Per
              // user feedback: "一边 zoom 一边就在滑动位置了 这个应该
              // 被禁止 两个动作同时只能做一个".
              try {
                const touchPanHandler = inner.handlers?._handlersById?.touchPan;
                if (touchPanHandler) {
                  const onTouchStart = (e: TouchEvent) => {
                    if (e.touches && e.touches.length >= 2 && touchPanHandler.disable) {
                      touchPanHandler.disable();
                    }
                  };
                  const onTouchEnd = (e: TouchEvent) => {
                    if ((!e.touches || e.touches.length < 2) && touchPanHandler.enable) {
                      touchPanHandler.enable();
                    }
                  };
                  const canvas = inner.getCanvasContainer?.();
                  if (canvas) {
                    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
                    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
                    canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });
                  }
                }
              } catch (e) {
                // Internal handler API is undocumented (subagent_b
                // risk #1). If shape changes, we degrade to default
                // mapbox behavior, not crash.
              }
            }
          }}
          mapboxAccessToken={localQaStyleEnabled ? LOCAL_QA_MAPBOX_TOKEN : MAPBOX_ACCESS_TOKEN}
          mapStyle={localQaStyleEnabled ? LOCAL_QA_STYLE : (parsedStyleJSON ?? styleUrl)}
          fadeDuration={0}
          attributionControl={false}
          logoPosition={webControlPosition(logoPosition, 'bottom-left')}
          onLoad={(event) => {
            const bounds = firstCamera?.props.defaultSettings?.bounds ?? firstCamera?.props.bounds;
            if (bounds) {
              event.target.fitBounds([bounds.sw, bounds.ne], {
                padding: {
                  top: bounds.paddingTop ?? 0,
                  bottom: bounds.paddingBottom ?? 0,
                  left: bounds.paddingLeft ?? 0,
                  right: bounds.paddingRight ?? 0,
                },
                duration: 0,
              });
            }
            if (logoEnabled) applyLogoOffset(event.target, logoPosition);
            emitWebMapReadiness(event.target, false);
          }}
          initialViewState={
            initialCenter && Array.isArray(initialCenter)
              ? { longitude: initialCenter[0], latitude: initialCenter[1], zoom: initialZoom }
              : { longitude: 0, latitude: 0, zoom: initialZoom }
          }
          onIdle={(e) => {
            const c = e.target.getCenter();
            const z = e.target.getZoom();
            // Synthesize a feature payload matching the @rnmapbox/maps
            // onCameraChanged / onMapIdle shape so component code reads
            // properties.center + properties.zoom identically.
            onMapIdle?.({ properties: { center: [c.lng, c.lat], zoom: z } });
            onDidFinishRenderingMapFully?.();
            onDidFinishRenderingFrameFully?.();
          }}
          onRender={(event) => {
            // GL JS v2 can keep already-rendered tiles in `expired` while it
            // refreshes them, preventing its strict load/idle events forever.
            // Release Cairn's loading cover only after a feature from a
            // hosted source in the active style is genuinely rendered.
            emitWebMapReadiness(event.target, true);
            // Native supplies a fully-rendered-frame callback independently of
            // the later all-map completion event. Forward Web render frames as
            // well; MemoryMap only accepts one after its exact Fog authority
            // has committed, so early blank/style frames cannot release UI.
            onDidFinishRenderingFrameFully?.();
          }}
          onError={(event) => {
            // Register the SDK's supported error boundary. Without a listener,
            // GL JS prints every ErrorEvent directly to console; during SPA
            // teardown that turns a contained stale-style callback into an
            // unhandled runtime error. Production consumers can now surface
            // their existing map-unavailable state, while adapters without an
            // explicit boundary preserve Mapbox's console behavior.
            if (onMapLoadingError) onMapLoadingError(event);
            else console.error((event as any)?.error ?? event);
          }}
          onMove={(e) => {
            if (!onCameraChanged) return;
            const userEvent = Boolean(e.originalEvent);
            const now = performance.now();
            // Programmatic Mapbox movement can emit at render cadence. The
            // app only needs sampled camera telemetry; forwarding every event
            // duplicates the animation clock's work. User events remain
            // immediate so a pan/pinch always cancels Point follow at once.
            if (!userEvent && now - lastProgrammaticCameraEventAtRef.current < 100) return;
            lastProgrammaticCameraEventAtRef.current = now;
            const c = e.target.getCenter();
            const z = e.target.getZoom();
            onCameraChanged({
              properties: {
                center: [c.lng, c.lat],
                zoom: z,
                heading: e.target.getBearing?.() ?? 0,
                pitch: e.target.getPitch?.() ?? 0,
                // react-map-gl supplies originalEvent for pointer/wheel/touch
                // moves, while programmatic easeTo/jumpTo updates omit it.
                isUserInteraction: userEvent,
              },
            });
          }}
          onDragStart={(e) => {
            const c = e.target.getCenter();
            onCameraChanged?.({ properties: {
              center: [c.lng, c.lat], zoom: e.target.getZoom(),
              heading: e.target.getBearing?.() ?? 0, pitch: e.target.getPitch?.() ?? 0,
              isUserInteraction: true,
            } });
          }}
          onMouseDown={(e) => {
            if (!e.originalEvent) return;
            const c = e.target.getCenter();
            onCameraChanged?.({ properties: {
              center: [c.lng, c.lat], zoom: e.target.getZoom(),
              heading: e.target.getBearing?.() ?? 0, pitch: e.target.getPitch?.() ?? 0,
              isUserInteraction: true,
            } });
          }}
          onZoomStart={(e) => {
            if (!e.originalEvent) return;
            const c = e.target.getCenter();
            onCameraChanged?.({ properties: {
              center: [c.lng, c.lat], zoom: e.target.getZoom(),
              heading: e.target.getBearing?.() ?? 0, pitch: e.target.getPitch?.() ?? 0,
              isUserInteraction: true,
            } });
          }}
          onRotateStart={(e) => {
            if (!e.originalEvent) return;
            const c = e.target.getCenter();
            onCameraChanged?.({ properties: {
              center: [c.lng, c.lat], zoom: e.target.getZoom(),
              heading: e.target.getBearing?.() ?? 0, pitch: e.target.getPitch?.() ?? 0,
              isUserInteraction: true,
            } });
          }}
          style={{ width: '100%', height: '100%' }}
        >
          {attributionEnabled ? (
            <AttributionControl
              position={webControlPosition(attributionPosition, 'bottom-right')}
              style={controlOffsetStyle(attributionPosition)}
            />
          ) : null}
          {children}
        </MapGL>
      </div>
    </MapInstanceContext.Provider>
  );
});

// ── Camera (mostly a no-op wrapper for prop discovery) ────────────────
interface WebCameraBounds {
  ne: [number, number];
  sw: [number, number];
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
}

interface CameraProps {
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  defaultSettings?: { centerCoordinate?: [number, number]; zoomLevel?: number; bounds?: WebCameraBounds; animationDuration?: number };
  bounds?: WebCameraBounds;
  animationMode?: string;
  animationDuration?: number;
  minZoomLevel?: number;
  maxZoomLevel?: number;
}

/**
 * Imperative camera handle the parent obtains via ref.
 * Matches the subset of @rnmapbox/maps' CameraRef we actually call.
 */
interface WebCameraStop {
    centerCoordinate?: [number, number];
    padding?: { paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number };
    zoomLevel?: number;
    heading?: number;
    pitch?: number;
    animationMode?: 'flyTo' | 'easeTo' | 'linearTo' | 'moveTo' | 'none';
    animationDuration?: number;
}

interface CameraRef {
  setCamera: (config: WebCameraStop | { stops: WebCameraStop[] }) => void;
  cancelAnimation: () => void;
  fitBounds: (
    northEast: [number, number],
    southWest: [number, number],
    padding?: number | [number, number, number, number],
    animationDuration?: number,
  ) => void;
}

export const Camera = React.forwardRef<CameraRef, CameraProps>(function Camera(props, ref) {
  const mapCtx = React.useContext(MapInstanceContext);
  const { centerCoordinate, zoomLevel, minZoomLevel, maxZoomLevel } = props;
  const sequenceGenerationRef = React.useRef(0);

  // Apply zoom range limits whenever they change.
  useEffect(() => {
    const m = mapCtx?.current;
    if (!m) return;
    const inner = (m as any).getMap?.() ?? m;
    if (!inner) return;
    if (typeof minZoomLevel === 'number') inner.setMinZoom(minZoomLevel);
    if (typeof maxZoomLevel === 'number') inner.setMaxZoom(maxZoomLevel);
  }, [minZoomLevel, maxZoomLevel, mapCtx]);

  // Imperative setCamera — used by parent to recenter on the pin
  // after a zoom (Didi-style anchor) or to clamp-back the map after
  // an over-50m pan.
  React.useImperativeHandle(ref, () => ({
    setCamera: (config) => {
      const m = mapCtx?.current;
      if (!m) return;
      const inner = (m as any).getMap?.() ?? m;
      if (!inner) return;
      const sequenceGeneration = ++sequenceGenerationRef.current;
      const applyStop = (stop: WebCameraStop, durationOverride?: number) => {
        const center = stop.centerCoordinate;
        const z = stop.zoomLevel;
        const bearing = stop.heading;
        const pitch = stop.pitch;
        const duration = durationOverride ?? stop.animationDuration ?? 0;
        // Never pass an undefined padding value: production Mapbox GL compares the
        // padding object while animating and can throw before the camera move.
        const padding = stop.padding ? {
          top: stop.padding.paddingTop ?? 0,
          right: stop.padding.paddingRight ?? 0,
          bottom: stop.padding.paddingBottom ?? 0,
          left: stop.padding.paddingLeft ?? 0,
        } : null;
        if (duration <= 0) {
          if (center) inner.jumpTo({
            center,
            zoom: z ?? inner.getZoom(),
            ...(typeof bearing === 'number' ? { bearing } : {}),
            ...(typeof pitch === 'number' ? { pitch } : {}),
            ...(padding ? { padding, retainPadding: true } : {}),
          });
          else if (typeof z === 'number') inner.setZoom(z);
          return;
        }
        inner.easeTo({
            center: center ?? inner.getCenter(),
            zoom: z ?? inner.getZoom(),
            bearing: bearing ?? inner.getBearing?.(),
            pitch: pitch ?? inner.getPitch?.(),
            duration,
            ...(padding ? { padding, retainPadding: true } : {}),
            ...(stop.animationMode === 'linearTo' ? { easing: (value: number) => value } : {}),
        });
      };
      if ('stops' in config) {
        // A Point follow uses one stable unobscured viewport for every bend.
        // Establish that padding once, then animate only geographic centers;
        // asking Mapbox to re-interpolate identical padding at every stop
        // needlessly reflows symbols and makes the moving head trail.
        const sequencePadding = config.stops.find(stop => stop.padding)?.padding;
        if (sequencePadding) {
          applyStop({ centerCoordinate: [inner.getCenter().lng, inner.getCenter().lat], padding: sequencePadding });
        }
        const sequenceStartedAt = performance.now();
        let startOffsetMs = 0;
        let previousCenter: [number, number] = [inner.getCenter().lng, inner.getCenter().lat];
        for (const stop of config.stops) {
          const plannedStartMs = startOffsetMs;
          const plannedEndMs = plannedStartMs + Math.max(0, stop.animationDuration ?? 0);
          const segmentStartCenter = previousCenter;
          if (stop.centerCoordinate) previousCenter = stop.centerCoordinate;
          const run = () => {
            if (sequenceGenerationRef.current !== sequenceGeneration) return;
            const elapsedMs = performance.now() - sequenceStartedAt;
            const { padding: ignoredPadding, ...centerOnlyStop } = stop;
            void ignoredPadding;
            const segmentDurationMs = plannedEndMs - plannedStartMs;
            const lateByMs = elapsedMs - plannedStartMs;
            if (centerOnlyStop.centerCoordinate
              && segmentDurationMs > 0
              && lateByMs > 4
              && elapsedMs < plannedEndMs) {
              // A busy Web frame can deliver the bend timer after the reveal
              // clock has already advanced. Jump to the matching point on the
              // missed chord before easing the remainder; otherwise the
              // camera spends the next frames visibly chasing the route head.
              const progress = Math.max(0, Math.min(1, lateByMs / segmentDurationMs));
              const target = centerOnlyStop.centerCoordinate;
              inner.jumpTo({
                center: [
                  segmentStartCenter[0] + (target[0] - segmentStartCenter[0]) * progress,
                  segmentStartCenter[1] + (target[1] - segmentStartCenter[1]) * progress,
                ],
                zoom: centerOnlyStop.zoomLevel ?? inner.getZoom(),
                bearing: centerOnlyStop.heading ?? inner.getBearing?.(),
                pitch: centerOnlyStop.pitch ?? inner.getPitch?.(),
              });
            }
            applyStop(centerOnlyStop, Math.max(0, plannedEndMs - elapsedMs));
          };
          if (plannedStartMs <= 0) run();
          else {
            // Wake the JS timer one frame early, but do not hand Mapbox the
            // next bend until the shared arc-length boundary is actually due.
            // This avoids both timer-late pauses and the former early easeTo
            // that cut corners ahead of the visible route head.
            const waitForBoundary = () => {
              if (sequenceGenerationRef.current !== sequenceGeneration) return;
              if (performance.now() - sequenceStartedAt + 0.5 < plannedStartMs) {
                requestAnimationFrame(waitForBoundary);
                return;
              }
              run();
            };
            setTimeout(waitForBoundary, Math.max(0, plannedStartMs - 16));
          }
          startOffsetMs = plannedEndMs;
        }
        return;
      }
      void applyStop(config);
    },
    cancelAnimation: () => {
      sequenceGenerationRef.current += 1;
      const m = mapCtx?.current;
      const inner = (m as any)?.getMap?.() ?? m;
      inner?.stop?.();
    },
    fitBounds: (northEast, southWest, padding = 0, animationDuration = 0) => {
      const m = mapCtx?.current;
      if (!m) return;
      const inner = (m as any).getMap?.() ?? m;
      if (!inner?.fitBounds) return;
      const [top, right, bottom, left] = Array.isArray(padding)
        ? padding
        : [padding, padding, padding, padding];
      inner.fitBounds([southWest, northEast], {
        padding: { top, right, bottom, left },
        duration: animationDuration,
      });
    },
  }), [mapCtx]);

  // Declarative centerCoordinate prop (rarely used now that callers
  // prefer ref.setCamera, but kept for compatibility with the native
  // Camera surface).
  useEffect(() => {
    if (!mapCtx?.current || !centerCoordinate) return;
    mapCtx.current.flyTo({
      center: { lng: centerCoordinate[0], lat: centerCoordinate[1] } as any,
      zoom: zoomLevel ?? mapCtx.current.getZoom(),
      duration: props.animationDuration ?? 600,
    });
  }, [centerCoordinate?.[0], centerCoordinate?.[1], zoomLevel]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
});
(Camera as any).__cairnMapboxComponent = 'Camera';

// ── ShapeSource ───────────────────────────────────────────────────────
interface ShapeSourceProps {
  id: string;
  shape: any;
  children?: React.ReactNode;
  onPress?: (event: { features: any[]; coordinates?: [number, number]; point?: { x: number; y: number } }) => void;
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoomLevel?: number;
  clusterProperties?: Record<string, any>;
  lineMetrics?: boolean;
}

export const ShapeSource = React.forwardRef<any, ShapeSourceProps>(function ShapeSource({
  id,
  shape,
  children,
  onPress,
  cluster,
  clusterRadius,
  clusterMaxZoomLevel,
  clusterProperties,
  lineMetrics,
}: ShapeSourceProps, ref) {
  const mapCtx = React.useContext(MapInstanceContext);
  const onPressRef = useRef(onPress);
  useEffect(() => { onPressRef.current = onPress; }, [onPress]);
  const interactiveLayerIds = useMemo(() => React.Children.toArray(children)
    .filter(React.isValidElement)
    .map(child => String((child as React.ReactElement<{ id?: string }>).props.id ?? ''))
    .filter(Boolean), [children]);
  const interactiveLayerKey = interactiveLayerIds.join('|');
  useEffect(() => {
    if (!onPressRef.current || !interactiveLayerKey) return undefined;
    let disposed = false;
    let frame: number | null = null;
    let map: any = null;
    const layerIds = interactiveLayerKey.split('|');
    const handleClick = (event: any) => {
      if (!onPressRef.current) return;
      const features = queryWebShapeSourcePressFeatures(map, event.point, layerIds, id);
      if (features.length === 0) return;
      onPressRef.current({
        features,
        coordinates: event.lngLat ? [event.lngLat.lng, event.lngLat.lat] : undefined,
        point: event.point ? { x: event.point.x, y: event.point.y } : undefined,
      });
    };
    const attach = () => {
      if (disposed) return;
      map = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      if (!map) {
        frame = requestAnimationFrame(attach);
        return;
      }
      map.on?.('click', handleClick);
    };
    attach();
    return () => {
      disposed = true;
      if (frame != null) cancelAnimationFrame(frame);
      map?.off?.('click', handleClick);
    };
  }, [id, interactiveLayerKey, mapCtx]);
  React.useImperativeHandle(ref, () => ({
    setNativeProps: (props: { shape?: unknown }) => {
      if (props.shape == null) return;
      const inner = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      const source = inner?.getSource?.(id);
      if (!source?.setData) return;
      try {
        source.setData(typeof props.shape === 'string' ? JSON.parse(props.shape) : props.shape);
      } catch {
        // A malformed development payload must not tear down the map.
      }
    },
    getClusterLeaves: (feature: any, limit: number, offset: number) => new Promise((resolve, reject) => {
      const inner = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      const source = inner?.getSource?.(id);
      const clusterId = Number(feature?.properties?.cluster_id);
      if (!source?.getClusterLeaves || !Number.isFinite(clusterId)) {
        reject(new Error('cluster_leaves_unavailable'));
        return;
      }
      source.getClusterLeaves(clusterId, limit, offset, (error: unknown, features: any[]) => {
        if (error) reject(error);
        else resolve(features ?? []);
      });
    }),
    getClusterExpansionZoom: (feature: any) => new Promise((resolve, reject) => {
      const inner = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      const source = inner?.getSource?.(id);
      const clusterId = Number(feature?.properties?.cluster_id);
      if (!source?.getClusterExpansionZoom || !Number.isFinite(clusterId)) {
        reject(new Error('cluster_expansion_unavailable'));
        return;
      }
      source.getClusterExpansionZoom(clusterId, (error: unknown, zoom: number) => {
        if (error) reject(error);
        else resolve(zoom);
      });
    }),
  }), [id, mapCtx]);
  // react-map-gl handles `data` prop diffing internally and calls
  // mapbox-gl's source.setData when the prop changes. We do NOT manually
  // call setData here — doing so causes the source to enter a permanent
  // 'reloading' tile state when the polygon is large (e.g. 571-hole fog),
  // because every render creates a new shape reference, which kicks
  // a fresh worker pass before the previous one finishes.
  //
  // Upstream consumers (FogLayer) should memoize `shape` so this prop
  // is referentially stable when geometry hasn't actually changed.
  const enriched = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    return React.cloneElement(child as any, { __sourceId: id });
  });
  const clusteringProps = {
    ...(typeof cluster === 'boolean' ? { cluster } : {}),
    ...(typeof clusterRadius === 'number' ? { clusterRadius } : {}),
    ...(typeof clusterMaxZoomLevel === 'number' ? { clusterMaxZoom: clusterMaxZoomLevel } : {}),
    ...(clusterProperties ? { clusterProperties } : {}),
  };
  return (
    <Source
      id={id}
      type="geojson"
      data={shape}
      {...(typeof lineMetrics === 'boolean' ? { lineMetrics } : {})}
      {...clusteringProps}
    >
      {enriched}
    </Source>
  );
});

// ── FillLayer ─────────────────────────────────────────────────────────
interface LayerProps {
  id: string;
  style?: Record<string, any>;
  __sourceId?: string;
  filter?: any[];
  /** RNMapbox-compatible ordering hint for late optional layers. */
  aboveLayerID?: string;
  belowLayerID?: string;
  /**
   * Native Mapbox Standard slot. Mapbox GL JS v2 does not implement Standard
   * slots, so Web intentionally records relative order only and does not pass
   * this through to the v2 style specification.
   */
  slot?: 'bottom' | 'middle' | 'top';
}

function useWebLayerPosition(id: string, aboveLayerID?: string, belowLayerID?: string): void {
  const mapCtx = React.useContext(MapInstanceContext);
  useEffect(() => {
    const anchorID = belowLayerID ?? aboveLayerID;
    if (!anchorID) return undefined;
    let disposed = false;
    let frame: number | null = null;
    let map: any = null;
    const apply = () => {
      if (disposed) return;
      // moveLayer itself emits styledata. The reconciler is idempotent and
      // moves only when the relation is wrong, preventing a render loop.
      try { reconcileWebLayerPosition(map, id, aboveLayerID, belowLayerID); } catch { /* style replacement */ }
    };
    const attach = () => {
      if (disposed) return;
      map = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      if (!map) {
        frame = requestAnimationFrame(attach);
        return;
      }
      map.on?.('styledata', apply);
      apply();
    };
    attach();
    return () => {
      disposed = true;
      if (frame != null) cancelAnimationFrame(frame);
      map?.off?.('styledata', apply);
    };
  }, [aboveLayerID, belowLayerID, id, mapCtx]);
}

export function FillLayer({ id, style, __sourceId, filter, aboveLayerID, belowLayerID }: LayerProps) {
  useWebLayerPosition(id, aboveLayerID, belowLayerID);
  const filterProps = filter ? { filter: filter as any } : {};
  return (
    <Layer
      id={id}
      type="fill"
      source={__sourceId}
      {...filterProps}
      paint={paintToKebab(style) as any}
    />
  );
}

// ── LineLayer ─────────────────────────────────────────────────────────
export const LineLayer = React.forwardRef<any, LayerProps>(function LineLayer({ id, style, __sourceId, filter, aboveLayerID, belowLayerID }, ref) {
  const mapCtx = React.useContext(MapInstanceContext);
  useWebLayerPosition(id, aboveLayerID, belowLayerID);
  React.useImperativeHandle(ref, () => ({
    setNativeProps: (props: { style?: Record<string, any> }) => {
      const inner = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      if (!inner?.getLayer?.(id) || !props.style) return;
      for (const [key, value] of Object.entries(props.style)) {
        const property = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
        // These values were already validated by the RN style surface. Skip
        // GL JS's style-spec validation in the animation hot path.
        try { inner.setPaintProperty(id, property, value, { validate: false }); } catch { /* unsupported development paint */ }
      }
    },
  }), [id, mapCtx]);
  const lineLayoutKeys = new Set([
    'lineCap',
    'lineJoin',
    'lineMiterLimit',
    'lineRoundLimit',
    'lineSortKey',
    'visibility',
  ]);
  const layoutStyle: Record<string, any> = {};
  const paintStyle: Record<string, any> = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    // Mapbox GL JS v2 (the current Web QA renderer) predates the Standard
    // style's emissive paint properties. Native RNMapbox v11 still receives
    // them through its own adapter; omitting them here avoids rejecting an
    // otherwise valid line layer during browser evidence capture.
    if (key === 'lineEmissiveStrength') continue;
    (lineLayoutKeys.has(key) ? layoutStyle : paintStyle)[key] = value;
  }
  const filterProps = filter ? { filter: filter as any } : {};
  return (
    <Layer
      id={id}
      type="line"
      source={__sourceId}
      {...filterProps}
      layout={paintToKebab(layoutStyle) as any}
      paint={paintToKebab(paintStyle) as any}
    />
  );
});

export function CircleLayer({ id, style, __sourceId, filter, aboveLayerID, belowLayerID }: LayerProps) {
  useWebLayerPosition(id, aboveLayerID, belowLayerID);
  const supportedStyle: Record<string, any> = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    // Native Standard uses this valid v11 paint property. GL JS v2 rejects
    // it, so omit it only at the Web adapter boundary.
    if (key === 'circleEmissiveStrength') continue;
    supportedStyle[key] = value;
  }
  const filterProps = filter ? { filter: filter as any } : {};
  return <Layer id={id} type="circle" source={__sourceId} {...filterProps} paint={paintToKebab(supportedStyle) as any} />;
}

export function SymbolLayer({ id, style, __sourceId, filter, aboveLayerID, belowLayerID }: LayerProps) {
  useWebLayerPosition(id, aboveLayerID, belowLayerID);
  // The opt-in local QA style intentionally has no remote glyph endpoint. A
  // text symbol would therefore be rejected by Mapbox GL before the screen's
  // structural assertions run. Native and normal Web maps keep the real
  // style/glyph path; only the explicit development-only fixture omits text.
  if (
    !WEB_MAPBOX_AVAILABLE
    &&
    process.env.NODE_ENV !== 'production'
    && typeof window !== 'undefined'
    && Boolean((window as any).__cairnMapQaLocalStyle)
    && style?.textField
  ) {
    return null;
  }
  const paintStyle: Record<string, any> = {};
  const layoutStyle: Record<string, any> = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    const isPaint = /^(icon|text)(Color|Halo|Opacity|Translate)/.test(key);
    (isPaint ? paintStyle : layoutStyle)[key] = value;
  }
  const filterProps = filter ? { filter: filter as any } : {};
  return (
    <Layer
      id={id}
      type="symbol"
      source={__sourceId}
      {...filterProps}
      layout={paintToKebab(layoutStyle) as any}
      paint={paintToKebab(paintStyle) as any}
    />
  );
}

// ── UserLocation — shared device-location puck at browser geolocation ─
// This must remain independent of the camera. The former QA shim rendered
// the dot at map.getCenter(), so it followed every manual pan and could
// falsely make a broken Recenter journey look correct in screenshots.
interface UserLocationProps {
  visible?: boolean;
}

export function UserLocation({ visible = true }: UserLocationProps) {
  const mapCtx = React.useContext(MapInstanceContext);
  const [coordinate, setCoordinate] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!visible || typeof navigator === 'undefined' || !navigator.geolocation) {
      setCoordinate(null);
      return undefined;
    }
    const watchId = navigator.geolocation.watchPosition(position => {
      const longitude = Number(position.coords.longitude);
      const latitude = Number(position.coords.latitude);
      if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
        setCoordinate([longitude, latitude]);
      }
    }, () => setCoordinate(null), {
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: 20_000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [visible]);
  if (!visible || !mapCtx || !coordinate) return null;
  return (
    <Marker longitude={coordinate[0]} latitude={coordinate[1]}>
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: CURRENT_LOCATION_DOT_STYLE.circleColor,
        border: `2px solid ${CURRENT_LOCATION_RING_STYLE.circleColor}`,
      }} data-testid="web-user-location-puck" />
    </Marker>
  );
}

// ── PointAnnotation — minimal marker wrapper ─────────────────────────
interface PointAnnotationProps {
  id: string;
  coordinate: [number, number];
  children?: React.ReactNode;
}

export function PointAnnotation({ coordinate, children }: PointAnnotationProps) {
  return (
    <Marker longitude={coordinate[0]} latitude={coordinate[1]}>
      <>{children}</>
    </Marker>
  );
}

interface MarkerViewProps extends PointAnnotationProps {
  anchor?: { x: number; y: number };
  allowOverlap?: boolean;
}

// RNMapbox MarkerView is a native view annotation. react-map-gl's Marker is
// the equivalent real Web Mapbox primitive, so Cairn pins remain observable
// in browser QA instead of silently disappearing behind a no-op component.
export function MarkerView({ coordinate, children }: MarkerViewProps) {
  return (
    <Marker longitude={coordinate[0]} latitude={coordinate[1]} anchor="center">
      <>{children}</>
    </Marker>
  );
}

// ── adapter export ────────────────────────────────────────────────────
// O1 (2026-07-26) fix: 老代码 CircleLayer/SymbolLayer/Images/Image/
// MarkerView 返回 null,但 MemoryMap.tsx 无条件 <CircleLayer .../> 渲染,
// React on web 会 createElement(null,...) 抛 "Element type is invalid"
// → Memory tab web 白屏。改成返回 no-op function 组件,JSX 渲染安全,
// UI 上看不到东西但不 crash。Consumer 若真需要判断 web 应查
// mapboxAdapter.ts 里的 sprite/circle 是否 web-supported。
const NoopComponent = () => null;

function resolveWebImageUri(source: unknown): string | null {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object' && typeof (source as any).uri === 'string') {
    return (source as any).uri;
  }
  return ReactNativeImage.resolveAssetSource(source as any)?.uri ?? null;
}

function WebImages({ images = {} }: { images?: Record<string, unknown>; children?: React.ReactNode }) {
  const mapCtx = React.useContext(MapInstanceContext);
  const entries = Object.entries(images)
    .map(([name, source]) => [name, resolveWebImageUri(source)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  const signature = entries.map(([name, uri]) => `${name}:${uri}`).join('|');
  useEffect(() => {
    const map = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
    if (!map || entries.length === 0) return undefined;
    let disposed = false;
    const register = () => {
      for (const [name, uri] of entries) {
        if (map.hasImage?.(name)) continue;
        map.loadImage?.(uri, (error: unknown, image: unknown) => {
          if (disposed || error || !image || map.hasImage?.(name)) return;
          try { map.addImage(name, image); } catch { /* style replaced mid-load */ }
        });
      }
    };
    map.on?.('style.load', register);
    if (map.isStyleLoaded?.()) register();
    return () => {
      disposed = true;
      map.off?.('style.load', register);
    };
    // The normalized signature is the image authority; callers commonly
    // create a new object literal every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCtx, signature]);
  return null;
}

interface WebStyleImportProps {
  config?: Record<string, string | boolean>;
}

/**
 * Mapbox GL JS v2 cannot render Standard style imports, but the Web fallback
 * still needs to honour Standard's label visibility contract. In particular,
 * Activity/Route maps can disable label categories; Point temporarily hides
 * basemap symbols while its camera is continuously moving so Mapbox does not
 * spend the reveal frame budget repeatedly placing labels. Road, path, land
 * and water geometry remain visible, and Cairn's own endpoint labels use a
 * source-less layer that is intentionally left untouched.
 */
function WebStyleImport({ config = {} }: WebStyleImportProps) {
  const mapCtx = React.useContext(MapInstanceContext);
  useEffect(() => {
    let map: any = null;
    let attachFrame: number | null = null;
    let disposed = false;
    const originalVisibility = new Map<string, unknown>();
    const suppressedSourceLayers = new Set<string>();
    const suppressAllBasemapSymbols = config.showPointOfInterestLabels === false
      && config.showTransitLabels === false
      && config.showPlaceLabels === false
      && config.showRoadLabels === false;
    if (config.showPointOfInterestLabels === false) {
      suppressedSourceLayers.add('poi_label');
      suppressedSourceLayers.add('airport_label');
      suppressedSourceLayers.add('housenum_label');
    }
    if (config.showTransitLabels === false) suppressedSourceLayers.add('transit_stop_label');
    const apply = () => {
      // Mapbox GL JS may expose the Map instance before the imported style is
      // serializable. Calling getStyle() in that window throws inside the v2
      // serializer (the import has no resolved `version` yet), so wait for the
      // real style-ready boundary instead of crashing the whole map screen.
      if (!map || !map.isStyleLoaded?.()) return;
      for (const layer of map.getStyle?.()?.layers ?? []) {
        if (layer.type !== 'symbol'
          || layer['source-layer'] == null
          || (!suppressAllBasemapSymbols && !suppressedSourceLayers.has(layer['source-layer']))) continue;
        if (!originalVisibility.has(layer.id)) {
          originalVisibility.set(layer.id, map.getLayoutProperty?.(layer.id, 'visibility'));
        }
        try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch { /* style may be replacing */ }
      }
    };
    const applyWhenReady = () => {
      if (disposed || !map) return;
      if (map.isStyleLoaded?.()) {
        attachFrame = null;
        apply();
        return;
      }
      attachFrame = requestAnimationFrame(applyWhenReady);
    };
    const attach = () => {
      if (disposed) return;
      map = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
      if (!map) {
        attachFrame = requestAnimationFrame(attach);
        return;
      }
      map.on?.('style.load', apply);
      applyWhenReady();
    };
    attach();
    return () => {
      disposed = true;
      if (attachFrame != null) cancelAnimationFrame(attachFrame);
      if (!map) return;
      map.off?.('style.load', apply);
      // React disposes child effects before react-map-gl clears the parent
      // ref. Mutating layers synchronously in that window can enqueue a GL JS
      // v2 worker message after Map.remove(), producing the recurring
      // `undefined.send` error during Activity/theme navigation. Defer one
      // frame and restore only when this exact map is still mounted. A config
      // change on a live map retains the restoration behavior; a map teardown
      // skips it entirely.
      requestAnimationFrame(() => {
        const currentMap = mapCtx?.current?.getMap?.() ?? mapCtx?.current;
        if (currentMap !== map || !map.isStyleLoaded?.()) return;
        for (const [layerId, visibility] of originalVisibility) {
          try {
            if (!map.getLayer?.(layerId)) continue;
            map.setLayoutProperty(layerId, 'visibility', visibility ?? 'visible');
          } catch { /* replaced style */ }
        }
      });
    };
  }, [
    config.showPlaceLabels,
    config.showPointOfInterestLabels,
    config.showRoadLabels,
    config.showTransitLabels,
    mapCtx,
  ]);
  return null;
}

export function makeWebMapboxAdapter() {
  const localQaAvailable = process.env.NODE_ENV !== 'production'
    && typeof window !== 'undefined'
    && Boolean((window as any).__cairnMapQaLocalStyle);
  return {
    MapView,
    Camera,
    PointAnnotation,
    UserLocation,
    LineLayer,
    FillLayer,
    ShapeSource,
    CircleLayer,
    SymbolLayer,
    Images: WebImages,
    Image: NoopComponent,
    MarkerView,
    // Native Mapbox v11 owns real imports. The v2 Web fallback applies the
    // supported label-visibility subset to its equivalent hosted style.
    StyleImport: WebStyleImport,
    // A mounted canvas without a usable token is not a working map. Let
    // callers show their explicit unavailable state instead of treating a
    // blank Web rectangle as evidence that Mapbox rendered successfully.
    available: WEB_MAPBOX_AVAILABLE || localQaAvailable,
  };
}
