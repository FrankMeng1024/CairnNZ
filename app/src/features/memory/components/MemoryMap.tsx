/**
 * MemoryMap — Mapbox view + sepia fog overlay + cairn pins.
 *
 * Wires together:
 *   - Mapbox MapView/Camera (cross-platform via mapboxAdapter)
 *   - FogLayer (renders L1 world fog + L2 raster mask around user)
 *   - CairnPinsLayer (markers within the explored area)
 *   - UserLocation (the blue dot — user's current position anchor)
 *
 * recenterToken bump forces Camera remount → fresh flyTo to the current
 * `centerCoordinate`. Without remount, native @rnmapbox/maps' Camera
 * doesn't follow centerCoordinate prop updates after first mount.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, useWindowDimensions } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { markersForVisibleWorkspace } from '../../cairns/cairnWorkspace';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { MemoryColors } from '../config/memoryConfig';
import { FogLayer } from './FogLayer';
// O1: MemoryFogBurstOverlay deleted (v303 Skia burst overlay, replaced by
// v346 turf.buffer native fog corridor. Skia layer was pure visual sugar,
// removing it saves ~140 lines + one continuous animation loop.)
import { CairnPinsLayer } from './CairnPinsLayer';
import { useMemoryStore } from '../store/useMemoryStore';
import { log } from '../../../services/appLog';
import { flushNow as flushLogsNow } from '../../../services/appLog';
import { Icon } from '../../../components/Icon';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useMapTheme } from '../../../hooks/useMapTheme';
import { getMapStyleForTheme, themeToStandardPreset, buildStandardConfig } from '../../../config/mapbox';
import { mapOrnamentsAbove } from '../../../config/mapOrnaments';
import { MapLoadOverlay, type MapLoadState } from '../../../components/MapLoadOverlay';
import { useAppStore } from '../../../store/useAppStore';
import { AcquiredCairnClusterLayer } from './AcquiredCairnClusterLayer';
import { useCairnPresentationStore } from '../../cairns/cairnPresentationStore';
import { excludeAcquiredFriendMarkers } from '../services/cairnMapPresentation';
import { memoryCoverageViewport, type MemoryCoverageViewport } from '../services/memoryCoverageViewport';
import { memoryFogPaintEvidenceReady } from '../services/memoryFogReadiness';
import { memoryMinePreviewCanCapture } from '../services/memoryEntryPresentation';

let memoryMapHasRendered = false;
const MEMORY_MAP_ORNAMENTS = mapOrnamentsAbove(76);

interface Props {
  centerLat: number;
  centerLng: number;
  /** A durable Memory center may exist without a live device fix. The map and
   * fog still render, but the position puck must not imply current location. */
  showUserLocation?: boolean;
  /**
   * Bumping this number triggers Camera flyTo (recenter). Parent
   * uses it for the recenter button.
   */
  recenterToken?: number;
  /**
   * BUG-003 fix (Sprint 71 post-review): stranger Public marks within
   * visibility radius but outside fog — forwarded to CairnPinsLayer for
   * blurred-icon render (Sprint 70 STORY-00543). When MemoryScreen wires
   * the /api/markers/public?bbox= loader in F5, populating this prop
   * activates the visual layer end-to-end. Optional; defaults undefined =
   * no stranger icons rendered.
   */
  strangerMarks?: import('../../../store/useMarkerStore').Marker[];
  /**
   * v333: fired when the user actively pans/zooms the map (not when
   * code-driven Camera animation moves it). Parent gates the Recenter
   * button on this so the button only appears after the user has
   * moved the map (decision E).
   */
  onMapMoved?: () => void;
  /**
   * v427: fire on every camera change with the current center. Parent
   * uses this to know where the user is looking on the map (for hierarchy
   * panel init — user pans to Pudong then taps Layers, we want Pudong,
   * not their physical GPS).
   */
  onCameraCenter?: (lat: number, lng: number) => void;
  /**
   * v359: fired when Mapbox `onDidFinishRenderingMapFully` triggers —
   * the basemap is fully painted. Used by MemoryScreen as one of two
   * gates for hiding the loading overlay.
   */
  onMapFullyReady?: () => void;
  /** The map renderer is not present; the parent must retire its loading veil. */
  onMapUnavailable?: () => void;
  /**
   * v359: fired when FogLayer first computes a fog shape with holes
   * (corridor cutouts from GPS data). Used by MemoryScreen as the
   * second gate for hiding the loading overlay.
   */
  onFogReady?: () => void;
  onFogPreparing?: (readinessKey: string, retainsDisplayedScene: boolean) => void;
  onFogUnavailable?: () => void;
  /**
   * v424: fly camera to arbitrary center+zoom, driven by HierarchyPanel
   * region selection. Prop-based so parent controls timing. Bumping
   * the `key` (v424Token) triggers a fresh flyTo even if center didn't
   * change (rare). When null, no flyTo runs.
   */
  flyToTarget?: { center: [number, number]; zoom: number; token: number } | null;
  qaWorkspaceActive?: boolean;
  onOpenAcquiredCairn?: (markerId: string) => void;
  onOpenAcquiredGroup?: (markerIds: string[]) => void;
  /** Parent owns the one stable entry veil for both map and Fog readiness. */
  presentationOwnedByParent?: boolean;
  onPresentationState?: (state: MapLoadState) => void;
}

const INITIAL_ZOOM = 16.5;

export type MemoryMapHandle = {
  /**
   * v447: Return the map's current viewport center. Handles the
   * @rnmapbox/maps native API (async, returns [lng, lat]) and web
   * adapter (mapbox-gl-js sync, returns {lng, lat}) uniformly.
   * Returns null if map not ready.
   */
  getCurrentCenter: () => Promise<{ lat: number; lng: number } | null>;
  /** The exact settled viewport authority currently owned by Memory. */
  getCoverageViewport: () => MemoryCoverageViewport;
  /** Capture a fully rendered Mine-only map+Fog frame for one bounded warm-entry preview. */
  captureAuthorizedPreview: () => Promise<string | null>;
};

export const MemoryMap = forwardRef<MemoryMapHandle, Props>(function MemoryMap(
  { centerLat, centerLng, showUserLocation = true, recenterToken = 0, onMapMoved, onCameraCenter, onMapFullyReady, onMapUnavailable, onFogPreparing, onFogReady, onFogUnavailable, strangerMarks, flyToTarget, qaWorkspaceActive = false, onOpenAcquiredCairn, onOpenAcquiredGroup, presentationOwnedByParent = false, onPresentationState },
  ref,
) {
  const theme = useVisualTheme();
  const windowDimensions = useWindowDimensions();
  const memoryMapTheme = useMapTheme();
  const memoryResolvedMapStyle = getMapStyleForTheme('outdoors', memoryMapTheme);
  const memoryLightPreset = themeToStandardPreset(memoryMapTheme);
  const Mapbox = getMapbox();
  const storedOwnMarkers = useMarkerStore((s) => s.markers);
  const ownMarkers = useMemo(
    () => markersForVisibleWorkspace(storedOwnMarkers, qaWorkspaceActive),
    [qaWorkspaceActive, storedOwnMarkers],
  );
  const friendMarkers = useMarkerStore((s) => s.circleMarkers);
  const acquiredMarkers = useCairnPresentationStore((s) => s.acquiredMarkers);
  const memoryScope = useMemoryScopeStore((s) => s.scope);
  const memoryScopeRef = useRef(memoryScope);
  memoryScopeRef.current = memoryScope;
  const allMarkers = useMemo(() => {
    if (memoryScope === 'self') return ownMarkers;
    // Acquired Friend Cairns have one authoritative map presentation in
    // AcquiredCairnClusterLayer. /api/circle/markers carries the same
    // immutable acquisition revisions for legacy consumers, so omit those
    // stable ids here instead of rendering two overlapping features with
    // different press/archive semantics.
    const seen = new Set(ownMarkers.map(marker => String(marker.id)));
    return [...ownMarkers, ...excludeAcquiredFriendMarkers(
      friendMarkers.filter(marker => !seen.has(String(marker.id))),
      acquiredMarkers,
    )];
  }, [acquiredMarkers, friendMarkers, memoryScope, ownMarkers]);
  const mapViewRef = useRef<any>(null);
  const mapSizeRef = useRef({
    width: Math.max(1, windowDimensions.width),
    height: Math.max(1, windowDimensions.height),
  });
  const [coverageViewport, setCoverageViewport] = useState(() => memoryCoverageViewport(
    { lat: centerLat, lng: centerLng },
    INITIAL_ZOOM,
    Math.max(1, windowDimensions.width),
    Math.max(1, windowDimensions.height),
  ));
  const coverageViewportRef = useRef(coverageViewport);

  // v447: expose getCurrentCenter so parent can pull the true current
  // map center at panel-open time. This is the reliable source, unlike
  // onCameraChanged which never fired e.properties.center on native
  // during a plain pan (root cause of v445 KL→Shanghai stale ref bug).
  useImperativeHandle(ref, () => ({
    getCoverageViewport: () => coverageViewportRef.current,
    getCurrentCenter: async () => {
      try {
        const m = mapViewRef.current;
        if (!m) return null;
        // Native: async, returns [lng, lat]. Web: sync, returns {lng, lat}.
        const raw = m.getCenter ? m.getCenter() : null;
        const c = raw && typeof raw.then === 'function' ? await raw : raw;
        if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number') {
          return { lat: c[1], lng: c[0] };
        }
        if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
          return { lat: c.lat, lng: c.lng };
        }
        return null;
      } catch (err) {
        log('v447.map.get_center_err', { err: String(err) });
        return null;
      }
    },
    captureAuthorizedPreview: async () => {
      try {
        if (!memoryMinePreviewCanCapture({
          scope: memoryScopeRef.current,
          currentReadinessKey: fogReadinessKeyRef.current,
          paintedReadinessKey: fogPaintReadyKeyRef.current,
        })) return null;
        const m = mapViewRef.current;
        if (!m || typeof m.takeSnap !== 'function') return null;
        const raw = await m.takeSnap(false);
        if (typeof raw !== 'string' || raw.length < 32) return null;
        return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
      } catch (err) {
        log('memory.map.preview_capture_error', { err: String(err) });
        return null;
      }
    },
  }), []);

  // v302 N6: track whether the user has panned the map away from
  // the GPS-driven center. Hiking-style: don't auto-follow user
  // location; instead expose a recenter pill when the camera drifts
  // beyond ~50m of the GPS fix. Same UX as HikingScreen.
  const [hasPannedAway, setHasPannedAway] = useState(false);
  // v380: fog/map ready gate — pins should not appear until fog is
  // rendered. Pre-fix the user saw pins "popping in" before fog, and some
  // pins missed first paint entirely.
  //
  // FogLayer is the sole readiness authority. A wall-clock fallback used to
  // expose Cairns while the account-scoped fog geometry was still restoring.
  const [fogReady, setFogReady] = useState(false);
  const fogReadinessKeyRef = useRef('');
  const fogGeometryReadyKeyRef = useRef('');
  const fogPaintReadyKeyRef = useRef('');
  const fogRequiredSourceIdsRef = useRef<string[]>(['memory-fog-src']);
  const fogPreparingAtRef = useRef(0);
  const fogGeometryReadyAtRef = useRef(0);
  const fogRetainingSceneRef = useRef(false);
  const fogPaintProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localHydration = useMemoryStore((s) => s.localHydration) ?? {
    ownerUserId: null,
    status: 'detached' as const,
    requiresInitialReconcile: false,
    initialReconcile: 'not_required' as const,
    revision: 0,
  };
  const activeAccountId = useAppStore((s) => String(s.user?.id ?? 'signed-out'));
  const pinsAuthorityReady = qaWorkspaceActive || (
    localHydration.ownerUserId === activeAccountId
    &&
    localHydration.status === 'ready'
    && (!localHydration.requiresInitialReconcile
      || localHydration.initialReconcile === 'success')
  );
  // We anchor on the first known center (the GPS fix at mount time)
  // — not the live coord prop, which would let `centerCoord` updates
  // from the watcher quietly drag the "did the user pan?" baseline.
  const anchorRef = useRef({ lat: centerLat, lng: centerLng });
  const cameraRef = useRef<any>(null);

  /**
   * onMapIdle receives a synthesized event from the adapter with
   * properties.center and properties.zoom. We use these to detect
   * pan-away (anchor diff > 50m) for the internal recenter pill.
   */
  // v303 OTA 三修: onMapSettle 在初始化期间 Mapbox 会 fire 多次,
  // 用 throttle 100ms 合并连续 fire 防多次 setState 抖动。
  const idleFireCountRef = useRef(0);
  const lastIdleAtRef = useRef(0);
  const idleThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMapSettle = useCallback((feature: any) => {
    const center = feature?.properties?.center;
    const zoom = feature?.properties?.zoom;
    if (!Array.isArray(center) || center.length < 2 || typeof zoom !== 'number') return;
    // v386: propagate zoom to shared value so pin components can animate
    // transform:scale on the UI thread (reanimated). This is the
    // OTA-friendly zoom-responsive scaling for PointAnnotation, since
    // Mapbox SDK's GL-side iconSize works only for SymbolLayer (which
    // can't render react-native-svg per v383-exp diagnostic).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setMapZoom } = require('./useMapZoom');
    setMapZoom(zoom);
    idleFireCountRef.current += 1;
    const fireCount = idleFireCountRef.current;
    const tNow = Date.now();
    const msSinceLast = lastIdleAtRef.current === 0 ? -1 : tNow - lastIdleAtRef.current;
    lastIdleAtRef.current = tNow;
    log('memory.map_idle', {
      fire: fireCount,
      zoom: Number(zoom.toFixed(2)),
      ms_since_last: msSinceLast,
      center_lat: Number(center[1].toFixed(5)),
      center_lng: Number(center[0].toFixed(5)),
    });
    void flushLogsNow();
    if (idleThrottleTimerRef.current) clearTimeout(idleThrottleTimerRef.current);
    idleThrottleTimerRef.current = setTimeout(() => {
      idleThrottleTimerRef.current = null;
      const nextCoverageViewport = memoryCoverageViewport(
        { lat: Number(center[1]), lng: Number(center[0]) },
        zoom,
        mapSizeRef.current.width,
        mapSizeRef.current.height,
      );
      coverageViewportRef.current = nextCoverageViewport;
      setCoverageViewport(current => current.key === nextCoverageViewport.key
        ? current
        : nextCoverageViewport);
      // v425 fix: skip pan-detect during 1s post-recenter window.
      // Prior bug: onRegionIsChanging checked suppressPanDetectUntilRef
      // (line ~327) but onMapIdle didn't. Result: after user tapped
      // Recenter, camera flyTo settled → onMapIdle fired → if dist
      // > 50m (because anchorRef just moved to GPS coord but map
      // was still mid-transition or GPS coord had drifted), panned=true
      // → onMapMoved() → parent re-shows Recenter pill → user must
      // tap Recenter twice.
      if (Date.now() < suppressPanDetectUntilRef.current) return;
      const dist = haversineM(
        { lat: anchorRef.current.lat, lng: anchorRef.current.lng },
        { lat: center[1], lng: center[0] }
      );
      const panned = dist > 50;
      setHasPannedAway((prev) => (prev === panned ? prev : panned));
      // v336: bubble pan-away signal to parent (MemoryScreen) so the
      // Recenter pill shows up. Earlier versions relied on rnmapbox's
      // onRegionDidChange + isUserInteraction, but that event was not
      // firing reliably in our setup. onMapIdle fires every time the
      // camera settles, and we already compute the anchor-distance here
      // — just forward the same boolean upstream.
      if (panned && onMapMoved) {
        onMapMoved();
      }
    }, 100);
  }, [onMapMoved]);

  // v340: when Recenter pill is tapped, MemoryScreen bumps
  // recenterToken; we then run cameraRef.setCamera with 600ms flyTo.
  // During that animation rnmapbox sometimes labels intermediate
  // onRegionIsChanging events with isUserInteraction=true (depends on
  // SDK version + gesture state at the moment of flyTo). Use a
  // suppress-ref to ignore pan-detect events during the 1s window
  // after a programmatic recenter, otherwise the Recenter pill flashes
  // back on immediately after the user taps it.
  const suppressPanDetectUntilRef = useRef<number>(0);

  // v359: fire onMapFullyReady once on the first
  // onDidFinishRenderingMapFully event. Subsequent fires (zoom/pan
  // settle) are ignored — the loading overlay only cares about the
  // first paint.
  const mapFullyReadyFiredRef = useRef(false);
  const mapFullyRenderedLoggedRef = useRef(false);
  // O1 batch 28.3: gate blue dot 到 map basemap 加载完成后一起出。
  // 用户报 Bug 2: memory 里当前位置和地图出现时间不一样,有先后。
  // 现象是 UserLocation `visible={true}` 立即渲染,而 basemap tiles 稍
  // 后到位,视觉上蓝点先浮在灰底上 → 后地图出。加 mapReady state,
  // onDidFinishLoadingMap 里 setMapReady(true) → UserLocation 直到
  // mapReady 才 visible=true → basemap + blue dot 一起出。
  const [mapReady, setMapReady] = useState(false);
  // Tile-loading overlay: hides the blank canvas on slow CDN / fresh install.
  // Same pattern as HikingMap. Cleared on first onDidFinishRenderingMapFully
  // (or onDidFinishLoadingMap as backup — ref guard prevents duplicate).
  const [mapFirstRender, setMapFirstRender] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);

  useEffect(() => {
    if (mapFirstRender) return undefined;
    const timeout = setTimeout(() => setMapLoadState('slow'), 8000);
    return () => clearTimeout(timeout);
  }, [mapEpoch, mapFirstRender]);

  useEffect(() => {
    if (presentationOwnedByParent) onPresentationState?.(mapLoadState);
  }, [mapLoadState, onPresentationState, presentationOwnedByParent]);

  useEffect(() => {
    if (!Mapbox.available) onMapUnavailable?.();
  }, [Mapbox.available, onMapUnavailable]);

  const confirmCurrentFogPaint = useCallback((fullyRenderedFrame = false) => {
    const readinessKey = fogReadinessKeyRef.current;
    if (!readinessKey
      || fogGeometryReadyKeyRef.current !== readinessKey
      || fogPaintReadyKeyRef.current === readinessKey) return false;
    // Web Mapbox may commit a large GeoJSON source after the style's last
    // natural render event. Do not retire the veil while its worker is still
    // parsing. Native has no optional source probe and reaches this helper
    // from its genuine fully-rendered callback instead.
    const sourceProbe = mapViewRef.current?.isSourceLoaded;
    const sourcesLoaded = typeof sourceProbe !== 'function'
      || fogRequiredSourceIdsRef.current.every(sourceId => sourceProbe(sourceId));
    const layerIds = fogRequiredSourceIdsRef.current.flatMap(sourceId => {
      if (sourceId === 'memory-fog-src') return [
        'memory-fog',
        'memory-mine',
        'memory-friend-union',
        'memory-overlap',
      ];
      if (sourceId === 'memory-friend-union-src') return 'memory-friend-union';
      if (sourceId === 'memory-overlap-src') return 'memory-overlap';
      return sourceId;
    });
    // GL JS can transiently report a GeoJSON source as reloading after the
    // exact data is already present in a rendered frame (notably when three
    // correlated Fog sources commit together). A positive rendered-feature
    // probe is stronger evidence of user-visible completion than that worker
    // bookkeeping flag. Native has no optional probe and retains its genuine
    // fully-rendered callback path.
    const atomicSceneProbe = mapViewRef.current?.hasRenderedScene;
    const renderedProbe = mapViewRef.current?.areLayersRendered;
    const hasRenderedLayerProbe = typeof atomicSceneProbe === 'function'
      || typeof renderedProbe === 'function';
    const exactLayersRendered = typeof atomicSceneProbe === 'function'
      ? atomicSceneProbe(layerIds, readinessKey)
      : typeof renderedProbe === 'function' && renderedProbe(layerIds, readinessKey);
    if (!memoryFogPaintEvidenceReady({
      hasRenderedLayerProbe,
      exactLayersRendered,
      fullyRenderedFrame,
      sourcesLoaded,
    })) {
      mapViewRef.current?.requestRender?.();
      // A GeoJSON worker becoming ready does not itself guarantee another
      // react-map-gl `render` callback after a Standard-style load. Keep one
      // bounded probe in flight for this authority; it stops immediately once
      // every required source is ready or when a new preparation supersedes it.
      if (!fogPaintProbeTimerRef.current) {
        const expectedKey = readinessKey;
        fogPaintProbeTimerRef.current = setTimeout(() => {
          fogPaintProbeTimerRef.current = null;
          if (fogReadinessKeyRef.current === expectedKey
            && fogPaintReadyKeyRef.current !== expectedKey) {
            mapViewRef.current?.requestRender?.();
            // A timer is not paint evidence. It only asks Mapbox for another
            // frame; the ensuing render callback must prove that this exact
            // readiness key, rather than stale warm-source contents, is on
            // screen before the veil can be retired.
          }
        }, 120);
      }
      return false;
    }
    if (fogPaintProbeTimerRef.current) {
      clearTimeout(fogPaintProbeTimerRef.current);
      fogPaintProbeTimerRef.current = null;
    }
    fogPaintReadyKeyRef.current = readinessKey;
    setMapReady(true);
    memoryMapHasRendered = true;
    if (!mapFirstRender) setMapFirstRender(true);
    if (!mapFullyReadyFiredRef.current && onMapFullyReady) {
      mapFullyReadyFiredRef.current = true;
      onMapFullyReady();
    }
    log('o86.memory.mapbox_fog_visible', {
      geometry_to_paint_ms: fogGeometryReadyAtRef.current
        ? Date.now() - fogGeometryReadyAtRef.current
        : null,
      prepare_to_paint_ms: fogPreparingAtRef.current
        ? Date.now() - fogPreparingAtRef.current
        : null,
      scope: memoryScope,
    });
    setFogReady(true);
    onFogReady?.();
    return true;
  }, [mapFirstRender, memoryScope, onFogReady, onMapFullyReady]);

  useEffect(() => () => {
    if (fogPaintProbeTimerRef.current) clearTimeout(fogPaintProbeTimerRef.current);
  }, []);

  // v336: when recenterToken bumps, fly the camera back to the current
  // GPS coord WITHOUT remounting Camera (the old cameraKey strategy
  // caused a one-frame fog reset on every tap). setCamera on the same
  // Camera ref is animated and produces no remount flash. Reset the
  // anchor so the pan-detection (onMapSettle) doesn't immediately fire
  // panned=true again.
  useEffect(() => {
    if (recenterToken > 0) {
      anchorRef.current = { lat: centerLat, lng: centerLng };
      setHasPannedAway(false);
      suppressPanDetectUntilRef.current = Date.now() + 600;
      cameraRef.current?.setCamera?.({
        centerCoordinate: [centerLng, centerLat],
        zoomLevel: INITIAL_ZOOM,
        animationDuration: 280,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);

  // v424: HierarchyPanel-driven flyTo. Bump `token` to re-trigger flyTo
  // even if center didn't change. 800ms 动画略慢让用户感知空间过渡.
  const lastFlyTokenRef = useRef<number>(0);
  useEffect(() => {
    if (!flyToTarget) return;
    if (flyToTarget.token === lastFlyTokenRef.current) return;
    lastFlyTokenRef.current = flyToTarget.token;
    // 更新 anchor 到目标 center, 防止 flyTo 触发 pan-detected → 弹回 recenter pill
    anchorRef.current = { lat: flyToTarget.center[1], lng: flyToTarget.center[0] };
    setHasPannedAway(true);  // 已经不在自己 GPS 位置了, recenter pill 应该出现
    suppressPanDetectUntilRef.current = Date.now() + 600;
    cameraRef.current?.setCamera?.({
      centerCoordinate: flyToTarget.center,
      zoomLevel: flyToTarget.zoom,
      animationDuration: 800,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.token]);

  const onRecenter = useCallback(() => {
    log('memory.map_recenter_btn');
    anchorRef.current = { lat: centerLat, lng: centerLng };
    setHasPannedAway(false);
    cameraRef.current?.setCamera?.({
      centerCoordinate: [centerLng, centerLat],
      zoomLevel: INITIAL_ZOOM,
      animationDuration: 280,
    });
  }, [centerLat, centerLng]);

  // Camera key remount strategy — bumping recenterToken alone triggers
  // v336: Camera no longer remounts on recenter (was: bumping
  // cameraKey via recenterToken caused a 1-frame fog reset = flash).
  // We now drive recenter via cameraRef.setCamera in the recenterToken
  // useEffect above. The Camera stays mounted for the whole MemoryMap
  // lifetime.

  if (!Mapbox.available) {
    return (
      <View style={[styles.webStub, { backgroundColor: theme.background }]}>
        <Icon name="Map" size={24} color={theme.iconInactive} strokeWidth={1.8} />
        <Text style={[styles.webStubTitle, { color: theme.foreground }]}>Map unavailable</Text>
        <Text style={[styles.webStubText, { color: theme.foregroundSecondary }]}>Your saved Memory is still available.</Text>
      </View>
    );
  }
  const { MapView, Camera, UserLocation, CircleLayer, StyleImport } = Mapbox as any;

  return (
    <View
      style={styles.container}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) mapSizeRef.current = { width, height };
      }}
    >
      <MapView
        key={`memory-map-${mapEpoch}`}
        ref={mapViewRef}
        style={styles.map}
        {...(memoryResolvedMapStyle.kind === 'url'
          ? { styleURL: memoryResolvedMapStyle.url }
          : { styleJSON: memoryResolvedMapStyle.json })}
        compassEnabled={false}
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        logoPosition={MEMORY_MAP_ORNAMENTS.logoPosition}
        attributionPosition={MEMORY_MAP_ORNAMENTS.attributionPosition}
        onMapIdle={onMapSettle}
        onCameraChanged={(e: any) => {
          // v386: propagate live zoom to shared value every camera frame
          // so PointAnnotation pin transform:scale tracks smoothly during
          // pinch. onMapIdle alone fires only at end of pinch (sticky size).
          const z = e?.properties?.zoom ?? e?.zoom;
          if (typeof z === 'number') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { setMapZoom } = require('./useMapZoom');
            setMapZoom(z);
            // v386b: log every ~250ms-ish for telemetry verification
            if (Math.random() < 0.05) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../../../services/appLog');
              log('v386.camera_zoom', { zoom: Number(z.toFixed(2)) });
            }
          }
          // v427: propagate center to parent for hierarchy panel init
          if (onCameraCenter) {
            const c = e?.properties?.center ?? e?.geometry?.coordinates;
            if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number') {
              onCameraCenter(c[1], c[0]);
              // v443: log every ~20th to verify camera-center propagation
              if (Math.random() < 0.05) {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { log } = require('../../../services/appLog');
                log('v443.map.camera_center', {
                  lat: Number(Number(c[1]).toFixed(4)),
                  lng: Number(Number(c[0]).toFixed(4)),
                });
              }
            } else if (Math.random() < 0.02) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../../../services/appLog');
              log('v443.map.camera_center_missing', {
                keys: e ? Object.keys(e).join(',') : 'null',
                props_keys: e?.properties ? Object.keys(e.properties).join(',') : 'null',
              });
            }
          }
        }}
        // v357 diagnostic: three Mapbox native events.
        //   willStartLoadingMap — style + first tile fetch begins. This is
        //     the earliest frame where MapView is in DOM but renders no
        //     basemap yet (likely the "brown screen" stage user reports).
        //   didFinishLoadingMap — style + initial tile batch ready. Basemap
        //     becomes visible; fog may or may not be layered yet depending
        //     on FogLayer build_ms vs this event order.
        //   didFinishRenderingMapFully — all tiles in viewport rendered.
        //     This is when "fully painted" map exists; if fog is missing
        //     after this fires, the bug is in FogLayer, not Mapbox.
        // We log without ctx — these are points, not measurements.
        onWillStartLoadingMap={() => {
          mapFullyRenderedLoggedRef.current = false;
          log('v357.mapbox_willStartLoadingMap', {});
        }}
        onDidFinishLoadingMap={() => {
          log('v357.mapbox_didFinishLoadingMap', {});
          // O1 batch 28.3: gate blue dot 一起出
          setMapReady(true);
          memoryMapHasRendered = true;
          setMapLoadState('loading');
          if (!mapFirstRender) setMapFirstRender(true);
          // v361 fix: onDidFinishRenderingMapFully is unreliable —
          // v357 telemetry showed it never fired in a normal session
          // while onDidFinishLoadingMap did. The 8s timeout was being
          // hit even on good networks because we were waiting for the
          // wrong event. Fire onMapFullyReady on didFinishLoadingMap
          // instead (style + first tile batch ready → basemap visible),
          // matching what users perceive as "map loaded".
          if (!mapFullyReadyFiredRef.current && onMapFullyReady) {
            mapFullyReadyFiredRef.current = true;
            onMapFullyReady();
          }
          confirmCurrentFogPaint(false);
        }}
        onDidFinishRenderingMapFully={() => {
          // Mapbox may emit this event for every requested repaint while a
          // GeoJSON worker settles. One diagnostic per style load preserves
          // the useful lifecycle marker without turning that paint loop into
          // hundreds of telemetry requests on a slow/racy frame.
          if (!mapFullyRenderedLoggedRef.current) {
            mapFullyRenderedLoggedRef.current = true;
            log('v357.mapbox_didFinishRenderingMapFully', {});
          }
          // Backup: also fire here in case didFinishLoadingMap was
          // somehow missed (defensive — ref guard prevents duplicate).
          setMapReady(true);
          memoryMapHasRendered = true;
          setMapLoadState('loading');
          if (!mapFirstRender) setMapFirstRender(true);
          if (!mapFullyReadyFiredRef.current && onMapFullyReady) {
            mapFullyReadyFiredRef.current = true;
            onMapFullyReady();
          }
          // Mapbox `load` is a fully painted initial-style boundary and the
          // fallback for geometry committed after the prior Web render.
          confirmCurrentFogPaint(true);
        }}
        onDidFinishRenderingFrameFully={() => {
          // A correlated fully-rendered frame containing the exact Fog is a
          // stronger user-facing readiness signal than waiting for Mapbox's
          // all-style `load` event. Standard-style imports can keep `load`
          // pending for seconds after the current viewport and our sources
          // have already painted. Do not hold the blocking entry veil once
          // this exact-authority frame exists.
          confirmCurrentFogPaint(true);
        }}
        onMapLoadingError={(event: unknown) => {
          log('memory.map_loading_error', { event: (() => { try { return JSON.stringify(event).slice(0, 500); } catch { return String(event); } })() });
          setMapLoadState('error');
        }}
        onRegionIsChanging={(feature: any) => {
          // v340: suppress pan-detect for 1s after a programmatic
          // recenter — rnmapbox flyTo can emit isUserInteraction=true
          // mid-animation depending on SDK state, which would flash the
          // Recenter pill back on immediately after the user tapped it.
          if (Date.now() < suppressPanDetectUntilRef.current) return;
          const isUser = feature?.properties?.isUserInteraction;
          if (!isUser) return;
          const cc = feature?.geometry?.coordinates;
          if (!Array.isArray(cc) || cc.length < 2) return;
          const dist = haversineM(
            { lat: anchorRef.current.lat, lng: anchorRef.current.lng },
            { lat: cc[1], lng: cc[0] }
          );
          if (dist > 50) {
            setHasPannedAway((prev) => prev ? prev : true);
            if (onMapMoved) onMapMoved();
          }
        }}
      >
        {/* R21-v3 v2 (2026-08-30): Standard style lightPreset. */}
        {StyleImport ? (
          <StyleImport
            key={memoryLightPreset}
            id="basemap"
            existing
            config={buildStandardConfig(memoryMapTheme) as any}
          />
        ) : null}
        <Camera
          ref={cameraRef}
          // v302 N6: defaultSettings (instead of centerCoordinate prop)
          // so a centerLat/Lng prop change (e.g. watcher push) does NOT
          // auto-fly back to the user's current position. The user
          // explicitly drives recenter via the pill button.
          defaultSettings={{
            centerCoordinate: [centerLng, centerLat],
            zoomLevel: INITIAL_ZOOM,
            pitch: 0,
          }}
          animationMode={'flyTo'}
          animationDuration={280}
        />
        {/* v349: re-enable custom UserLocation puck — CircleLayer is now
            exported by mapboxAdapter (v348 fix), so the v347 crash root
            cause (CircleLayer === undefined) is gone. UserLocation.js:201
            confirms: children prop fully replaces normalIcon's 15px halo
            + 9px white + 6px blue stack. With renderMode default ('normal',
            line 44-48) the children path is the official API.

            Result: small white-ringed blue dot. No 15px translucent halo
            that users were mistaking for a "default fog reveal circle". */}
        {showUserLocation ? <UserLocation visible={mapReady} animated={true}>
          {/* BUG-C fix (v371 post-OTA): User-location ring + dot now scale
              with zoom. Mapbox `circleRadius` default is screen pixels —
              constant size regardless of zoom — which at low zoom levels
              made the blue dot visually huge relative to map features
              ("bigger than a house"). Now interpolated: small at world
              zoom (z=4), normal at hiking zoom (z=14+). Numbers chosen
              so the dot still reads as "you" at all zooms but doesn't
              dominate the map at low zoom.
              The 8px / 6px at z>=14 matches the prior 7px / 5px feel
              (slightly larger because the ring is now more sparse at low
              zoom). */}
          <CircleLayer
            id="memory-user-location-ring"
            style={{
              circleRadius: [
                'interpolate', ['linear'], ['zoom'],
                4, 2.5,    // world zoom — tiny
                10, 4.5,   // city zoom — small
                14, 7,     // hiking zoom — normal
                18, 9,     // street zoom — slightly larger
              ],
              circleColor: '#FFFFFF',
              circlePitchAlignment: 'map',
            }}
          />
          <CircleLayer
            id="memory-user-location-dot"
            aboveLayerID="memory-user-location-ring"
            style={{
              circleRadius: [
                'interpolate', ['linear'], ['zoom'],
                4, 1.6,    // tiny inner dot at world zoom
                10, 3,
                14, 5,
                18, 6.5,
              ],
              circleColor: 'rgba(51, 181, 229, 1)',
              circlePitchAlignment: 'map',
            }}
          />
        </UserLocation> : null}
        <FogLayer
          userCenter={{ lat: centerLat, lng: centerLng }}
          viewport={coverageViewport}
          onFogPreparing={(readinessKey, retainsDisplayedScene) => {
            if (fogPaintProbeTimerRef.current) {
              clearTimeout(fogPaintProbeTimerRef.current);
              fogPaintProbeTimerRef.current = null;
            }
            fogReadinessKeyRef.current = readinessKey;
            fogGeometryReadyKeyRef.current = '';
            fogPaintReadyKeyRef.current = '';
            fogPreparingAtRef.current = Date.now();
            fogGeometryReadyAtRef.current = 0;
            fogRetainingSceneRef.current = retainsDisplayedScene;
            fogRequiredSourceIdsRef.current = ['memory-fog-src'];
            if (!retainsDisplayedScene) setFogReady(false);
            onFogPreparing?.(readinessKey, retainsDisplayedScene);
          }}
          onFogReady={(readinessKey, requiredSourceIds) => {
            if (fogReadinessKeyRef.current !== readinessKey) return;
            // Geometry has committed in JS. Cairns remain gated until Mapbox
            // reports a fully rendered frame for this same readiness key.
            fogGeometryReadyKeyRef.current = readinessKey;
            fogRetainingSceneRef.current = false;
            fogRequiredSourceIdsRef.current = requiredSourceIds;
            fogGeometryReadyAtRef.current = Date.now();
            log('o86.memory.fog_geometry_committed', {
              prepare_to_geometry_ms: fogGeometryReadyAtRef.current - fogPreparingAtRef.current,
              scope: memoryScope,
            });
            // A source update normally schedules a frame. Under a cold,
            // imported Mapbox style it can instead land immediately after
            // the last style frame, leaving otherwise rendered Fog behind
            // the entry veil. Requesting one frame is idempotent and keeps
            // readiness correlated with this exact geometry authority.
            mapViewRef.current?.requestRender?.();
          }}
          onFogUnavailable={(readinessKey) => {
            if (fogReadinessKeyRef.current !== readinessKey) return;
            fogGeometryReadyKeyRef.current = '';
            fogPaintReadyKeyRef.current = '';
            if (!fogRetainingSceneRef.current) setFogReady(false);
            onFogUnavailable?.();
          }}
        />
        {/* Memory is territory and accumulated place history, not another
            activity-detail route viewer. The explored fog cut-outs carry the
            journey evidence; a literal polyline here duplicated Trails and
            over-weighted the most recent activity. */}
        {/* v380: render pins only AFTER fog is ready, so they appear
            on top of the fog mask layer.
            v387: additionally gate on initialRevealDone so server-hydrated
            memory_points have arrived — otherwise user sees Mystery pins
            on first entry, then Revealed on second (Mystery flash). */}
        {/* v389: pin layer gated on fogReady AND pinsCanShow.
            pinsCanShow flips true as soon as memory points have arrived
            (or 2.5s fallback for users with 0 points). This prevents the
            Mystery flash without breaking the case where the flag never
            sets (existing users). */}
        {fogReady && pinsAuthorityReady && (
          <>
            <AcquiredCairnClusterLayer
              onOpenSingle={markerId => onOpenAcquiredCairn?.(markerId)}
              onOpenGroup={markerIds => onOpenAcquiredGroup?.(markerIds)}
            />
            <CairnPinsLayer markers={allMarkers} centerLat={centerLat} centerLng={centerLng} strangerMarks={strangerMarks} />
          </>
        )}
      </MapView>
      {/* O1: MemoryFogBurstOverlay removed — v303 Skia burst is dead layer
          after v346 native fog. Users don't miss it. Deletes ~140 lines. */}
      {/* v334: removed MemoryMap's internal Recenter pill — MemoryScreen
          now owns this UI (decision E: "icon like Hiking, only after I
          move the map, taps it to go back"). MemoryMap stays as a pure
          map renderer; pan/zoom signals bubble up via onMapMoved prop. */}
      {/* Tile-loading overlay: same as HikingMap. Hides blank canvas on
          slow CDN / fresh install until Mapbox first-render fires. */}
      {!presentationOwnedByParent && !mapFirstRender && (
        <MapLoadOverlay
          state={mapLoadState}
          delayMs={memoryMapHasRendered ? 280 : 0}
          onRetry={() => {
            setMapReady(false);
            setMapFirstRender(false);
            setMapLoadState('loading');
            setMapEpoch((epoch) => epoch + 1);
          }}
          testID="memory-map-load-overlay"
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  webStub: { flex: 1, backgroundColor: MemoryColors.cream, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  webStubTitle: { marginTop: 10, fontSize: 18, fontWeight: '700' },
  webStubText: { marginTop: 6, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  mapLoadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 216, 209, 0.85)',
  },
  mapLoadingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 10,
    elevation: 4,
  },
  mapLoadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
});
