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
 *   - <UserLocation visible> → small <Marker> with a blue dot
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
import { Map as MapGL, Source, Layer, Marker, AttributionControl } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const WEB_MAPBOX_AVAILABLE = MAPBOX_ACCESS_TOKEN.trim().startsWith('pk.')
  && MAPBOX_ACCESS_TOKEN.trim().length >= 40;
const LOCAL_QA_STYLE = {
  version: 8 as const,
  name: 'Cairn local QA canvas',
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
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
  onDidFinishLoadingMap?: () => void;
  onDidFinishRenderingMapFully?: () => void;
  onDidFinishRenderingFrameFully?: () => void;
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
  onDidFinishLoadingMap,
  onDidFinishRenderingMapFully,
  onDidFinishRenderingFrameFully,
  attributionEnabled = true,
  logoEnabled = true,
  logoPosition,
  attributionPosition,
  children,
}: MapViewProps, ref) {
  const mapRef = useRef<MapRef | null>(null);
  const loadingStartedRef = useRef(false);

  React.useImperativeHandle(ref, () => ({
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
  // R21-v3 v2 (2026-08-30): mapbox-gl-js v2.15.0 does NOT support Mapbox
  // Standard style (v3+ feature). Substitute outdoors-v12 on web so the
  // Playwright smoke test surface still renders. Real theme (day/dusk/night)
  // will not show on web — this is a documented compromise until we upgrade
  // mapbox-gl to v3.x.
  const rewrittenStyleURL = (styleURL === 'mapbox://styles/mapbox/standard')
    ? 'mapbox://styles/mapbox/outdoors-v12'
    : styleURL;
  const styleUrl = rewrittenStyleURL ?? 'mapbox://styles/mapbox/outdoors-v12';
  const localQaStyleEnabled = process.env.NODE_ENV !== 'production'
    && typeof window !== 'undefined'
    && Boolean((window as any).__cairnMapQaLocalStyle);

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
          {...(localQaStyleEnabled ? ({ testMode: true } as any) : {})}
          ref={(r) => {
            mapRef.current = r;
            // Expose underlying mapbox-gl Map on `window.__cairnMap` for
            // Playwright introspection (see feedback_playwright_before_realdevice.md).
            // No-op for end users — there is no UI that depends on it.
            if (typeof window !== 'undefined' && r) {
              const inner = r.getMap?.() ?? r;
              (window as any).__cairnMap = inner;

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
          mapboxAccessToken={MAPBOX_ACCESS_TOKEN}
          mapStyle={localQaStyleEnabled ? LOCAL_QA_STYLE : (parsedStyleJSON ?? styleUrl)}
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
            onDidFinishLoadingMap?.();
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
          onMove={(e) => {
            if (!onCameraChanged) return;
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
                isUserInteraction: Boolean(e.originalEvent),
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
              compact
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
interface CameraRef {
  setCamera: (config: {
    centerCoordinate?: [number, number];
    zoomLevel?: number;
    heading?: number;
    pitch?: number;
    animationDuration?: number;
  }) => void;
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
      const center = config.centerCoordinate;
      const z = config.zoomLevel;
      const bearing = config.heading;
      const pitch = config.pitch;
      const duration = config.animationDuration ?? 0;
      if (duration <= 0) {
        if (center) inner.jumpTo({ center, zoom: z ?? inner.getZoom(), bearing, pitch });
        else if (typeof z === 'number') inner.setZoom(z);
      } else {
        inner.easeTo({
          center: center ?? inner.getCenter(),
          zoom: z ?? inner.getZoom(),
          bearing: bearing ?? inner.getBearing?.(),
          pitch: pitch ?? inner.getPitch?.(),
          duration,
        });
      }
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
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoomLevel?: number;
  clusterProperties?: Record<string, any>;
}

export const ShapeSource = React.forwardRef<any, ShapeSourceProps>(function ShapeSource({
  id,
  shape,
  children,
  cluster,
  clusterRadius,
  clusterMaxZoomLevel,
  clusterProperties,
}: ShapeSourceProps, ref) {
  const mapCtx = React.useContext(MapInstanceContext);
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
}

export function FillLayer({ id, style, __sourceId, filter }: LayerProps) {
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
export function LineLayer({ id, style, __sourceId, filter }: LayerProps) {
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
}

export function CircleLayer({ id, style, __sourceId, filter }: LayerProps) {
  const filterProps = filter ? { filter: filter as any } : {};
  return <Layer id={id} type="circle" source={__sourceId} {...filterProps} paint={paintToKebab(style) as any} />;
}

export function SymbolLayer({ id, style, __sourceId, filter }: LayerProps) {
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

// ── UserLocation — small blue dot at the browser's geolocate position ─
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
        backgroundColor: '#1f7be0',
        border: '2px solid #fff',
        boxShadow: '0 0 4px rgba(0,0,0,0.4)',
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
    Images: NoopComponent,
    Image: NoopComponent,
    MarkerView,
    // R21-v3 (2026-08-30): StyleImport is native-only (Mapbox v11 API);
    // web shim renders nothing so callers can still `<Mapbox.StyleImport>`
    // unconditionally.
    StyleImport: NoopComponent,
    // A mounted canvas without a usable token is not a working map. Let
    // callers show their explicit unavailable state instead of treating a
    // blank Web rectangle as evidence that Mapbox rendered successfully.
    available: WEB_MAPBOX_AVAILABLE || localQaAvailable,
  };
}
