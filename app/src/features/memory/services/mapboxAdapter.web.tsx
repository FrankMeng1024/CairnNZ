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
import { Map as MapGL, Source, Layer, Marker, useMap } from 'react-map-gl/mapbox';
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
  compassEnabled?: boolean;
  scaleBarEnabled?: boolean;
  attributionEnabled?: boolean;
  logoEnabled?: boolean;
  children?: React.ReactNode;
}

export function MapView({ style, styleURL, onMapIdle, children }: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);

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
      <div style={style ?? { flex: 1, position: 'relative', minHeight: 200 }}>
        <MapGL
          ref={(r) => { mapRef.current = r; }}
          mapboxAccessToken={MAPBOX_ACCESS_TOKEN}
          mapStyle={styleUrl}
          initialViewState={
            initialCenter && Array.isArray(initialCenter)
              ? { longitude: initialCenter[0], latitude: initialCenter[1], zoom: initialZoom }
              : { longitude: 0, latitude: 0, zoom: initialZoom }
          }
          onIdle={(e) => {
            if (!onMapIdle) return;
            const c = e.target.getCenter();
            const z = e.target.getZoom();
            // Synthesize a feature payload matching the @rnmapbox/maps
            // onCameraChanged / onMapIdle shape so component code reads
            // properties.center + properties.zoom identically.
            onMapIdle({ properties: { center: [c.lng, c.lat], zoom: z } });
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
}

export function Camera(props: CameraProps) {
  const mapCtx = React.useContext(MapInstanceContext);
  const { centerCoordinate, zoomLevel } = props;
  useEffect(() => {
    if (!mapCtx?.current || !centerCoordinate) return;
    mapCtx.current.flyTo({
      center: { lng: centerCoordinate[0], lat: centerCoordinate[1] } as any,
      zoom: zoomLevel ?? mapCtx.current.getZoom(),
      duration: props.animationDuration ?? 600,
    });
  }, [centerCoordinate?.[0], centerCoordinate?.[1], zoomLevel]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
(Camera as any).__cairnMapboxComponent = 'Camera';

// ── ShapeSource ───────────────────────────────────────────────────────
interface ShapeSourceProps {
  id: string;
  shape: any;
  children?: React.ReactNode;
}

export function ShapeSource({ id, shape, children }: ShapeSourceProps) {
  // Children are FillLayer/LineLayer with id + style. Forward source id
  // so they can register against this Source.
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
export function makeWebMapboxAdapter() {
  return {
    MapView,
    Camera,
    PointAnnotation,
    UserLocation,
    LineLayer,
    FillLayer,
    ShapeSource,
    available: true,
  };
}
