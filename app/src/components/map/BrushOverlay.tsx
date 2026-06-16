/**
 * BrushOverlay — captures pan gestures over the map when the user is in
 * brush or eraser mode and turns them into stroke geometry on the store.
 *
 * Sprint 67 v245.
 *
 * The overlay sits above MapView when activeTool !== 'pan'. It uses
 * react-native-gesture-handler Gesture.Pan() (UI thread) + a ref to the
 * Mapbox MapView so it can call `getCoordinateFromView({x, y})` on every
 * frame to convert screen → lng/lat.
 *
 * On gesture begin: store.beginStroke(coord) — refused if the first
 * point is more than 50m from the original GPS trace.
 * On move: store.appendStrokePoint(strokeId, coord) — auto-downsamples
 * to 5m spacing inside the store.
 * On end: store.endStroke(strokeId).
 *
 * In eraser mode: same gestures but call store.eraseAt(coord) for every
 * sampled point.
 */

import React, { useRef, useState } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { sendEditDiag } from '../../services/editDiagSender';
import { Colors, FontSize, Spacing } from '../tokens';

// v269: per-stroke raw-sample diagnostic buffer. Module-scope so the
// gesture handlers can write to it from the JS thread without React
// state churn. Batched into a single brush_raw_samples telemetry event
// at gesture end. Used to identify the source of the mid-stroke
// "lng-pinned-to-one-value" pattern observed in v268 brush_end data.
interface RawSample {
  enterSeq: number;     // order handleUpdate was entered (gesture frame order)
  pushSeq: number;      // order this sample's unproject resolved
  enterTs: number;      // ms epoch at handleUpdate entry
  pushTs: number;       // ms epoch when coord was pushed to store
  x: number;            // touch absoluteX
  y: number;            // touch absoluteY
  lng: number | null;   // raw native unproject result (null if dropped)
  lat: number | null;
  // v270: parallel "self-mercator" unproject from getCenter+getZoom — pure JS,
  // never touches the native projection matrix that quantizes lng to Z=19
  // tile X grid. If real-device measurements show selfLng has 0 f32-quant
  // matches AND selfLat is identical to native lat, we have a 100%-validated
  // bypass path for the SDK quantization bug.
  selfLng: number | null;
  selfLat: number | null;
  // The center+zoom captured for the self-mercator calc, so post-hoc we can
  // see exactly what state the camera was in when this sample was taken.
  cLng: number | null;
  cLat: number | null;
  zoom: number | null;
  droppedByGuard: boolean;  // updateInFlightRef gate dropped this frame
  unprojectFailed: boolean; // mapView.getCoordinateFromView returned bad
}
let _rawSamples: RawSample[] = [];
let _enterSeqCounter = 0;
let _pushSeqCounter = 0;
let _strokeStartZoom: number | null = null;
let _strokeStartTs: number = 0;
let _currentStrokeIdForBuffer: string | null = null;

interface Props {
  /** Ref to the Mapbox MapView so we can unproject screen→geo. */
  mapViewRef: React.MutableRefObject<any>;
}

export function BrushOverlay({ mapViewRef }: Props): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const activeTool = useRouteEditStore(s => s.activeTool);
  const beginStroke = useRouteEditStore(s => s.beginStroke);
  const appendStrokePoint = useRouteEditStore(s => s.appendStrokePoint);
  const endStroke = useRouteEditStore(s => s.endStroke);
  const eraseAt = useRouteEditStore(s => s.eraseAt);

  const currentStrokeIdRef = useRef<string | null>(null);
  // v247: prevent double endStroke when both onEnd and onFinalize fire.
  const endedRef = useRef(false);
  // v250: in-flight guard for handleUpdate. runOnJS(handleUpdate) fires
  // for every gesture frame (~60Hz). unproject is async (await on
  // getCoordinateFromView native bridge call). Without this guard, the
  // JS thread queues 60 promises/sec and falls behind as the queue
  // grows — visible as second-stroke jank that cumulates with stroke
  // count. We drop frames whose unproject would queue behind an
  // in-flight call. The dropped pixel-position is acceptable because
  // appendStrokePoint already 5m-downsamples — losing a frame here
  // either means the next frame will have moved >5m (and is sampled)
  // or <5m (and would have been dropped anyway).
  const updateInFlightRef = useRef(false);

  if (activeTool === 'pan') return null;
  if (Platform.OS === 'web') return null;

  // v248: gesture capture region must avoid both the back-button area
  // at the top (~insets.top + 50) AND the entire bottom card which now
  // hosts tool strip + status + slider + preview + save (~360px).
  const gestureTopInset = insets.top + 50;
  const gestureBottomInset = 360;

  // Convert screen point to map lng/lat via Mapbox API. Async; we keep it
  // off the worklet thread by calling on JS thread inside runOnJS handlers.
  async function unproject(x: number, y: number): Promise<{ lng: number; lat: number } | null> {
    try {
      const map = mapViewRef.current;
      if (!map || typeof map.getCoordinateFromView !== 'function') return null;
      const coord = await map.getCoordinateFromView([x, y]);
      if (!Array.isArray(coord) || coord.length < 2) return null;
      return { lng: coord[0], lat: coord[1] };
    } catch {
      return null;
    }
  }

  // v270: pure-JS self-mercator unproject (Spike B). Reads camera center +
  // zoom, then uses standard Web Mercator inverse to convert (screen x, y)
  // to (lng, lat) entirely in IEEE-754 double precision JavaScript.
  // Used PARALLEL to native unproject so we can post-hoc compare both
  // outputs frame-by-frame. We do NOT replace native here — that comes
  // only after on-device data confirms self-mercator is quantization-free
  // AND lat matches native within tolerance.
  //
  // Math: Mapbox uses 512-px tile size. World pixel coords are
  //   px = (lng + 180)/360 * 512 * 2^zoom
  //   py = (0.5 - asinh(tan(lat·π/180))/(2π)) * 512 * 2^zoom
  // Center maps to viewport center (view_w/2, view_h/2). Touch (x, y) is
  // an offset; world pixel = center pixel + offset. Then inverse mercator.
  //
  // mapView.getSize() returns the on-screen MapView pixel dimensions in
  // density-independent points (DP), matching the units used by
  // gesture handler's absoluteX/absoluteY. Both are points, not physical pixels.
  async function unprojectSelfMercator(
    x: number, y: number,
  ): Promise<{ lng: number; lat: number; cLng: number; cLat: number; zoom: number } | null> {
    try {
      const map = mapViewRef.current;
      if (!map) return null;
      if (typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') return null;
      const [center, zoom] = await Promise.all([map.getCenter(), map.getZoom()]);
      // getCenter returns [lng, lat] per rnmapbox docs.
      const cLng = Array.isArray(center) ? center[0] : (center?.lng ?? null);
      const cLat = Array.isArray(center) ? center[1] : (center?.lat ?? null);
      if (cLng == null || cLat == null || zoom == null) return null;
      // We need the viewport size in points to compute the offset from center.
      // mapView's container is StyleSheet.absoluteFillObject so we use
      // window dimensions. To stay independent of getSize quirks we read
      // both safe-area sized window via gesture absolute coords; gesture
      // absoluteX/absoluteY come from the same coordinate system MapView
      // is laid out in. We assume MapView is full-screen (Cairn does this)
      // — if it isn't, getCenter/getZoom mismatch will show up as a constant
      // offset that we can detect post-hoc. To be safe we also try map.getSize().
      let viewW = 0, viewH = 0;
      try {
        if (typeof map.getSize === 'function') {
          const s = await map.getSize();
          if (Array.isArray(s) && s.length >= 2) { viewW = s[0]; viewH = s[1]; }
          else if (s && typeof s.width === 'number') { viewW = s.width; viewH = s.height; }
        }
      } catch { /* ignore */ }
      if (!viewW || !viewH) {
        // Fallback to RN Dimensions — works only if MapView is full screen.
        // This is acceptable as a Spike B sanity check; we'll flag if needed.
        const { Dimensions } = require('react-native');
        const d = Dimensions.get('window');
        viewW = d.width;
        viewH = d.height;
      }
      const TILE = 512;
      const scale = Math.pow(2, zoom) * TILE;
      const cPx = (cLng + 180) / 360 * scale;
      const sinLat = Math.sin(cLat * Math.PI / 180);
      const cPy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
      const wPx = cPx + (x - viewW / 2);
      const wPy = cPy + (y - viewH / 2);
      const lng = wPx / scale * 360 - 180;
      const n = Math.PI - 2 * Math.PI * wPy / scale;
      const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      return { lng, lat, cLng, cLat, zoom };
    } catch {
      return null;
    }
  }

  async function handleBegin(x: number, y: number) {
    endedRef.current = false;
    updateInFlightRef.current = false; // v250: reset for new stroke
    // v269: reset diagnostic buffer for this stroke
    _rawSamples = [];
    _enterSeqCounter = 0;
    _pushSeqCounter = 0;
    _strokeStartTs = Date.now();
    _strokeStartZoom = null;
    _currentStrokeIdForBuffer = null;
    // Capture zoom level at gesture start (best-effort, doesn't block).
    try {
      const map = mapViewRef.current;
      if (map && typeof map.getZoom === 'function') {
        _strokeStartZoom = await map.getZoom();
      }
    } catch {
      _strokeStartZoom = null;
    }
    const coord = await unproject(x, y);
    if (!coord) return;
    if (activeTool === 'brush') {
      const id = beginStroke(coord);
      currentStrokeIdRef.current = id;
      _currentStrokeIdForBuffer = id;
    } else if (activeTool === 'eraser') {
      eraseAt(coord, 25);
    }
  }

  async function handleUpdate(x: number, y: number) {
    // v269: count EVERY entry, including ones dropped by the in-flight
    // guard. Without this we can't tell post-hoc whether 60Hz frames
    // were actually arriving — important for distinguishing
    // "gesture-handler under-sampled" from "all frames captured but
    // unproject corrupted some".
    const enterSeq = _enterSeqCounter++;
    const enterTs = Date.now();
    // v250: skip if a previous handleUpdate is still awaiting unproject.
    // Drops frames rather than queuing — keeps gesture responsive.
    if (updateInFlightRef.current) {
      _rawSamples.push({
        enterSeq, pushSeq: -1,
        enterTs, pushTs: enterTs,
        x, y,
        lng: null, lat: null,
        selfLng: null, selfLat: null,
        cLng: null, cLat: null, zoom: null,
        droppedByGuard: true, unprojectFailed: false,
      });
      return;
    }
    updateInFlightRef.current = true;
    try {
      // v270: run native unproject and self-mercator unproject in PARALLEL
      // so they capture the same camera state. Promise.all means both fire
      // before either resolves; even if rnmapbox getCenter+getZoom is async
      // and runs on a different RN frame than getCoordinateFromView, they
      // start from the same JS tick. Any drift is post-hoc visible.
      const [coord, selfRes] = await Promise.all([
        unproject(x, y),
        unprojectSelfMercator(x, y),
      ]);
      const pushSeq = _pushSeqCounter++;
      const pushTs = Date.now();
      if (!coord) {
        _rawSamples.push({
          enterSeq, pushSeq,
          enterTs, pushTs,
          x, y,
          lng: null, lat: null,
          selfLng: selfRes ? selfRes.lng : null,
          selfLat: selfRes ? selfRes.lat : null,
          cLng: selfRes ? selfRes.cLng : null,
          cLat: selfRes ? selfRes.cLat : null,
          zoom: selfRes ? selfRes.zoom : null,
          droppedByGuard: false, unprojectFailed: true,
        });
        return;
      }
      _rawSamples.push({
        enterSeq, pushSeq,
        enterTs, pushTs,
        x, y,
        lng: coord.lng, lat: coord.lat,
        selfLng: selfRes ? selfRes.lng : null,
        selfLat: selfRes ? selfRes.lat : null,
        cLng: selfRes ? selfRes.cLng : null,
        cLat: selfRes ? selfRes.cLat : null,
        zoom: selfRes ? selfRes.zoom : null,
        droppedByGuard: false, unprojectFailed: false,
      });
      if (activeTool === 'brush') {
        const id = currentStrokeIdRef.current;
        if (!id) return;
        appendStrokePoint(id, coord);
      } else if (activeTool === 'eraser') {
        eraseAt(coord, 25);
      }
    } finally {
      updateInFlightRef.current = false;
    }
  }

  async function handleEnd() {
    // v247: onEnd + onFinalize both fire on normal completion. Guard so
    // endStroke (and editCount telemetry) only triggers once per stroke.
    if (endedRef.current) return;
    endedRef.current = true;
    // v269: capture end-of-stroke zoom and ship the per-frame buffer
    // BEFORE endStroke runs, so the diagnostic data is independent of
    // any magnetism / store mutation. brush_raw_samples is a KEY_EVENT
    // → flushed immediately by editDiagSender.
    let endZoom: number | null = null;
    try {
      const map = mapViewRef.current;
      if (map && typeof map.getZoom === 'function') {
        endZoom = await map.getZoom();
      }
    } catch {
      endZoom = null;
    }
    if (_rawSamples.length > 0 && _currentStrokeIdForBuffer) {
      sendEditDiag('brush_raw_samples', {
        strokeId: _currentStrokeIdForBuffer,
        startZoom: _strokeStartZoom,
        endZoom,
        startTs: _strokeStartTs,
        endTs: Date.now(),
        frameCount: _rawSamples.length,
        droppedCount: _rawSamples.filter(s => s.droppedByGuard).length,
        unprojectFailedCount: _rawSamples.filter(s => s.unprojectFailed).length,
        samples: _rawSamples,
      });
    }
    if (activeTool === 'brush') {
      const id = currentStrokeIdRef.current;
      if (id) endStroke(id);
      currentStrokeIdRef.current = null;
    }
    // v269: clear after upload to free memory
    _rawSamples = [];
    _currentStrokeIdForBuffer = null;
  }

  const pan = Gesture.Pan()
    .minDistance(0)
    .activateAfterLongPress(0)
    .onBegin((e) => {
      'worklet';
      // v248: Gesture.Pan e.x/e.y are RELATIVE to the GestureDetector
      // inner view, which is inset from screen top by gestureTopInset.
      // Mapbox getCoordinateFromView expects coords relative to MapView,
      // which is absoluteFill (top:0). Use absoluteX/absoluteY (screen
      // coords) instead — MapView is at screen top:0 too, so absolute
      // = MapView-relative. Without this fix, every brush press was
      // unprojected ~100+insets.top pixels above the actual finger,
      // landing far off the route → "Brush must start on the route".
      runOnJS(handleBegin)(e.absoluteX, e.absoluteY);
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(handleUpdate)(e.absoluteX, e.absoluteY);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(handleEnd)();
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(handleEnd)();
    });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* v247: gesture-capture View is INSET from screen edges so taps
          on the floating top toolbar / bottom card never fire onBegin
          → never start an unwanted stroke. */}
      <View
        style={{
          position: 'absolute',
          top: gestureTopInset,
          left: 0,
          right: 0,
          bottom: gestureBottomInset,
        }}
        pointerEvents="box-none"
      >
        <GestureDetector gesture={pan}>
          <View style={StyleSheet.absoluteFill} collapsable={false} />
        </GestureDetector>
      </View>
      <View pointerEvents="none" style={[styles.modeHint, { top: insets.top + 56 }]}>
        <Text style={styles.modeHintText}>
          {activeTool === 'brush' ? 'Drawing — start on the route' : 'Eraser — drag over a stroke to remove'}
        </Text>
      </View>
      {/* v255: lastError pill removed from top. PO request — all error
          / warning text now consolidated to the bottom statusRow. */}
    </View>
  );
}

const styles = StyleSheet.create({
  modeHint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  modeHintText: {
    fontSize: FontSize.small,
    color: Colors.primary,
    fontWeight: '700',
  },
});
