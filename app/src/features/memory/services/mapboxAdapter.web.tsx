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

import React, { useEffect, useRef } from 'react';
import { Map as MapGL, Source, Layer, Marker } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

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
  onMapIdle?: (feature: any) => void;
  onWillStartLoadingMap?: () => void;
  onDidFinishLoadingMap?: () => void;
  onDidFinishRenderingMapFully?: () => void;
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

export function MapView({
  style,
  styleURL,
  onMapIdle,
  onCameraChanged,
  onWillStartLoadingMap,
  onDidFinishLoadingMap,
  onDidFinishRenderingMapFully,
  children,
}: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const loadingStartedRef = useRef(false);

  useEffect(() => {
    if (loadingStartedRef.current) return;
    loadingStartedRef.current = true;
    onWillStartLoadingMap?.();
  }, [onWillStartLoadingMap]);

  // Translate mapbox:// style url to a public URL the JS SDK accepts.
  // mapbox-gl@2 actually accepts mapbox:// style URLs natively if a token
  // is set, so no rewrite needed.
  const styleUrl = styleURL ?? 'mapbox://styles/mapbox/outdoors-v12';

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
          mapStyle={styleUrl}
          onLoad={() => {
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
          }}
          onMove={(e) => {
            if (!onCameraChanged) return;
            const c = e.target.getCenter();
            const z = e.target.getZoom();
            onCameraChanged({ properties: { center: [c.lng, c.lat], zoom: z } });
          }}
          style={{ width: '100%', height: '100%' }}
        >
          {children}
        </MapGL>
      </div>
    </MapInstanceContext.Provider>
  );
}

// ── Camera (mostly a no-op wrapper for prop discovery) ────────────────
interface CameraProps {
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  defaultSettings?: { centerCoordinate?: [number, number]; zoomLevel?: number };
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
    animationDuration?: number;
  }) => void;
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
      const duration = config.animationDuration ?? 0;
      if (duration <= 0) {
        if (center) inner.jumpTo({ center, zoom: z ?? inner.getZoom() });
        else if (typeof z === 'number') inner.setZoom(z);
      } else {
        inner.easeTo({
          center: center ?? inner.getCenter(),
          zoom: z ?? inner.getZoom(),
          duration,
        });
      }
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
}

export function ShapeSource({ id, shape, children }: ShapeSourceProps) {
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
  return (
    <Source id={id} type="geojson" data={shape}>
      {enriched}
    </Source>
  );
}

// ── FillLayer ─────────────────────────────────────────────────────────
interface LayerProps {
  id: string;
  style?: Record<string, any>;
  __sourceId?: string;
}

export function FillLayer({ id, style, __sourceId }: LayerProps) {
  return (
    <Layer
      id={id}
      type="fill"
      source={__sourceId}
      paint={paintToKebab(style) as any}
    />
  );
}

// ── LineLayer ─────────────────────────────────────────────────────────
export function LineLayer({ id, style, __sourceId }: LayerProps) {
  return (
    <Layer
      id={id}
      type="line"
      source={__sourceId}
      paint={paintToKebab(style) as any}
    />
  );
}

// ── UserLocation — small blue dot at the map's geolocate position ────
// On web we can't pull the device GPS through Mapbox's UserLocation
// equivalent without permissions; for Playwright we just render a blue
// dot at a known location. Cairn's MemoryScreen passes the user coord
// in as the map center; we use that.
interface UserLocationProps {
  visible?: boolean;
}

export function UserLocation({ visible = true }: UserLocationProps) {
  const mapCtx = React.useContext(MapInstanceContext);
  if (!visible || !mapCtx) return null;
  // Render at the current map center — close enough to "user location"
  // for visual regression tests where we mock navigator.geolocation.
  const m = mapCtx.current;
  if (!m) return null;
  const c = m.getCenter();
  return (
    <Marker longitude={c.lng} latitude={c.lat}>
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: '#1f7be0',
        border: '2px solid #fff',
        boxShadow: '0 0 4px rgba(0,0,0,0.4)',
      }} />
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

// ── adapter export ────────────────────────────────────────────────────
// O1 (2026-07-26) fix: 老代码 CircleLayer/SymbolLayer/Images/Image/
// MarkerView 返回 null,但 MemoryMap.tsx 无条件 <CircleLayer .../> 渲染,
// React on web 会 createElement(null,...) 抛 "Element type is invalid"
// → Memory tab web 白屏。改成返回 no-op function 组件,JSX 渲染安全,
// UI 上看不到东西但不 crash。Consumer 若真需要判断 web 应查
// mapboxAdapter.ts 里的 sprite/circle 是否 web-supported。
const NoopComponent = () => null;

export function makeWebMapboxAdapter() {
  return {
    MapView,
    Camera,
    PointAnnotation,
    UserLocation,
    LineLayer,
    FillLayer,
    ShapeSource,
    // v383: web doesn't need sprite-rendering — Memory map web is
    // playwright-only and uses PointAnnotation. Stub as no-op React
    // components so <CircleLayer .../> etc. renders safely as null.
    CircleLayer: NoopComponent,
    SymbolLayer: NoopComponent,
    Images: NoopComponent,
    Image: NoopComponent,
    MarkerView: NoopComponent,
    available: true,
  };
}
