/**
 * RouteEditorScreen — Create/edit routes by placing waypoints on a map.
 *
 * Features:
 * - Full-screen Mapbox map (native) or fallback (web)
 * - Tap map to add waypoint
 * - Search destination (Mapbox Geocoding API)
 * - Name input + Save button
 * - Clear / Undo actions
 * - Calculates total distance from waypoints
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Platform, FlatList, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useRouteStore } from '../store/useRouteStore';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { snapToRoadAndTrim } from '../services/routeMatcher';
import { haversineM, formatDistance } from '../utils/geo';
import { getCurrentRegion } from '../config/regions';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

// Conditional Mapbox import — same pattern as RoutesScreen so the editor
// works on Expo Go (no native @rnmapbox) and degrades to the existing
// fallback panel.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
let PointAnnotation: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
    PointAnnotation = Mapbox.PointAnnotation;
  } catch {
    // @rnmapbox/maps not in this build — fallback panel will render.
  }
}

interface WaypointDraft {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export function RouteEditorScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  // Subscribe to lastCoordinate (don't just read it once via .getState())
  // so the camera + search both re-evaluate when the GPS prime resolves
  // a few seconds after mount.
  const userCoord = useTrackingStore(s => s.lastCoordinate);
  const route = useRoute<any>();
  const routeId = route.params?.routeId as string | undefined;
  const fromSessionId = route.params?.fromSessionId as string | undefined;
  const addRoute = useRouteStore(s => s.addRoute);
  const updateRoute = useRouteStore(s => s.updateRoute);
  const deleteRoute = useRouteStore(s => s.deleteRoute);
  const loadRouteDetail = useRouteStore(s => s.loadRouteDetail);
  const existingRoute = useRouteStore(s => s.routes.find(r => r.id === routeId));
  const session = useSessionStore(s => fromSessionId ? s.sessions.find(x => x.id === fromSessionId) : null);
  const [name, setName] = useState('');
  const [waypoints, setWaypoints] = useState<WaypointDraft[]>([]);
  // v123 fix #8: when entering with an existing routeId we open in
  // VIEW mode by default — a read-only display of the cloned trace
  // with Edit + Delete CTAs. User must tap Edit to enter the editing
  // surface (waypoint drag, snap-to-road, save). New routes (no
  // routeId) jump straight into edit mode.
  const [editMode, setEditMode] = useState<boolean>(!routeId);
  // True when snapToRoadAndTrim couldn't align the trace to road data
  // — typical indoors / sparse-OSM areas. We honestly tell the user
  // we're showing raw GPS, which prevents the "why are 7 waypoints
  // stacked on top of each other?" confusion seen in v16.
  const [snapWarning, setSnapWarning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; subtitle?: string | null; lat: number; lng: number }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  // Tracks the in-flight geocoding request so debounced typing can
  // cancel a stale request before its results overwrite a newer one
  // (race condition: "shang" results landing after "shanghai" results).
  const searchAbortRef = useRef<AbortController | null>(null);

  // Pre-fetch a one-shot GPS fix on enter so the editor opens centred
  // on the user's actual location and the geocoding bias / country
  // detection have a real coordinate to work from. Without this the
  // editor falls back to the configured region centre (NZ) — wrong
  // for a user testing in another country.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          if (!req.granted) return;
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const cur = useTrackingStore.getState();
        if (cur.status !== 'tracking') {
          useTrackingStore.setState({
            lastCoordinate: {
              lat: fix.coords.latitude,
              lng: fix.coords.longitude,
              alt: fix.coords.altitude ?? null,
            },
            lastCoordinateTime: Date.now(),
          });
        }
      } catch {
        // GPS unavailable — fall back to region centre.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced live-search: as the user types, fire handleSearch 400ms
  // after the last keystroke. Means they don't have to tap the search
  // button — typing "shang" surfaces matches automatically. 400ms is
  // long enough that a fast typist doesn't trigger an in-flight
  // request per keystroke.
  useEffect(() => {
    if (!showSearch) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      handleSearch();
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, showSearch]);

  // v123 fix #8: when opened with a routeId but the in-store record
  // doesn't yet have points (the list endpoint omits them for perf),
  // hydrate the full detail so the polyline + waypoints can render.
  useEffect(() => {
    if (routeId && existingRoute && existingRoute.points.length === 0) {
      loadRouteDetail(routeId);
    }
  }, [routeId, existingRoute?.points.length]);

  // Load existing route OR session data on mount
  useEffect(() => {
    if (existingRoute) {
      setName(existingRoute.name);
      if (existingRoute.waypoints.length > 0) {
        setWaypoints(existingRoute.waypoints.map(wp => ({
          id: wp.id, lat: wp.lat, lng: wp.lng, label: wp.label,
        })));
      } else if (existingRoute.points.length > 0) {
        const points = existingRoute.points;
        const step = Math.max(1, Math.floor(points.length / 20));
        const sampled = points.filter((_, i) => i % step === 0);
        setWaypoints(sampled.map((p, i) => ({
          id: `wp-imported-${i}`, lat: p.lat, lng: p.lng, label: `Point ${i + 1}`,
        })));
      }
    } else if (session) {
      // Pre-fill name from activity, then snap track to road network +
      // trim home/off-grid head & tail before exposing waypoints to
      // the editor. The product rule: "saved routes start from the
      // nearest public road, not from the user's house." See
      // routeMatcher service for the algorithm.
      const date = new Date(session.startedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
      setName(`${session.activityMode === 'running' ? 'Run' : 'Hike'} ${date}`);
      loadTrackPoints(session.id).then(async tp => {
        if (tp.length < 2) return;
        const profile = session.activityMode === 'running' ? 'walking' : 'walking';
        const matched = await snapToRoadAndTrim(
          tp.map(p => ({ lat: p.lat, lng: p.lng })),
          profile,
        );
        // Surface a banner when snapping fell back to raw GPS (indoors,
        // no nearby OSM road, or matcher confidence below threshold).
        // Otherwise the user sees raw clustered points on the map and
        // assumes the editor is broken.
        setSnapWarning(!matched.isSnapped);
        // Sample whichever polyline we have (snapped or fallback) down
        // to ~20 waypoints so the editor's draggable pins stay
        // manageable.
        const source = matched.points;
        const step = Math.max(1, Math.floor(source.length / 20));
        const sampled = source.filter((_, i) => i % step === 0);
        setWaypoints(sampled.map((p, i) => ({
          id: `wp-session-${i}`, lat: p.lat, lng: p.lng, label: `Point ${i + 1}`,
        })));
      });
    }
  }, [existingRoute?.id, session?.id]);

  // Calculate total distance from waypoints chain
  const totalDistanceM = waypoints.reduce((sum, wp, i) => {
    if (i === 0) return 0;
    return sum + haversineM(
      { lat: waypoints[i - 1].lat, lng: waypoints[i - 1].lng },
      { lat: wp.lat, lng: wp.lng },
    );
  }, 0);

  const handleAddWaypoint = (lat: number, lng: number) => {
    const id = `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setWaypoints(prev => [...prev, { id, lat, lng, label: `Point ${prev.length + 1}` }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleUndo = () => {
    setWaypoints(prev => prev.slice(0, -1));
  };

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 3000);
  };

  const handleClear = () => {
    setWaypoints([]);
  };

  const handleSave = () => {
    if (!name.trim()) {
      showError('Please enter a route name');
      return;
    }
    if (waypoints.length < 2) {
      showError('Add at least 2 waypoints to create a route');
      return;
    }

    const routeData = {
      name: name.trim(),
      points: waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng })),
      waypoints: waypoints.map(wp => ({
        id: wp.id,
        lat: wp.lat,
        lng: wp.lng,
        label: wp.label,
        announceOnArrival: true,
        radiusM: 30,
      })),
      distanceM: totalDistanceM,
      elevationGainM: existingRoute?.elevationGainM ?? session?.elevationGainM ?? 0,
    };

    try {
      if (routeId && existingRoute) {
        updateRoute(routeId, routeData);
      } else {
        addRoute(routeData);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Pop back to whatever pushed us here (Routes or MapHistory).
      // Using goBack() instead of navigate('Routes') prevents stack leak —
      // navigate() would push a new Routes instance, leaving RouteEditor on the stack.
      nav.goBack();
    } catch (e: any) {
      showError(e?.message || 'Failed to save route');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !MAPBOX_TOKEN) return;
    // Cancel any prior in-flight search before starting a new one.
    // Without this, rapid typing can result in stale results
    // overwriting fresh ones (typed "shang" → "shanghai" → both
    // requests in flight; "shang" returns last and overwrites the
    // narrower "shanghai" results).
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      // ── Geocoding strategy (modeled after Google Places best practices) ──
      // 1. Bias by the user's live GPS (proximity). Falls back to the
      //    configured region centre (NZ) when no GPS fix is available.
      // 2. Auto-detect the user's country via a reverse-geocode of their
      //    current GPS, then pass `country=<iso2>` so we hard-filter to
      //    that country. This is what stops "公园" from matching parks
      //    in Argentina when the user is standing in Shanghai.
      // 3. Pick the local language from the country code (zh for CN,
      //    ja for JP, ko for KR, en everywhere else by default), but
      //    keep English as the primary display language — Mapbox returns
      //    `place_name` in the requested language and `place_name_en`
      //    alongside it, so we show English as the main title with the
      //    local-language name as a secondary line.
      // 4. autocomplete=true — Mapbox defaults to false, which is why
      //    short queries used to feel broken. With autocomplete on,
      //    prefix matching kicks in for free.
      // 5. types=place,locality,neighborhood,address,poi — drop region
      //    /country/postcode noise that's irrelevant to a route editor.
      const userCoord = useTrackingStore.getState().lastCoordinate;
      const region = getCurrentRegion();
      const proxLng = userCoord?.lng ?? region.centerLng;
      const proxLat = userCoord?.lat ?? region.centerLat;

      // Reverse-geocode the proximity point to find which country we're
      // in. Cheap (one extra request, or 0 if the user already searched
      // and we cached). Best-effort — if it fails we just don't pass
      // country and fall back to region-only filtering.
      let countryCode: string | null = null;
      let langCode = 'en';
      try {
        const revRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${proxLng},${proxLat}.json?` +
          new URLSearchParams({
            access_token: MAPBOX_TOKEN,
            types: 'country',
            limit: '1',
          }).toString(),
          { signal: controller.signal },
        );
        const revData = await revRes.json();
        const cc = revData?.features?.[0]?.properties?.short_code as string | undefined;
        if (cc) {
          countryCode = cc.toUpperCase();
          // Map a handful of common countries to their primary local
          // language. Default 'en' is reasonable everywhere else —
          // Mapbox falls back gracefully.
          const langMap: Record<string, string> = {
            CN: 'zh-Hans', TW: 'zh-Hant', HK: 'zh-Hant',
            JP: 'ja', KR: 'ko',
            DE: 'de', FR: 'fr', ES: 'es', IT: 'it', PT: 'pt',
            RU: 'ru', NL: 'nl', PL: 'pl', TR: 'tr',
          };
          langCode = langMap[countryCode] ?? 'en';
        }
      } catch {
        // Network glitch on reverse geocode — proceed without country.
      }

      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        limit: '8',
        autocomplete: 'true',
        proximity: `${proxLng},${proxLat}`,
        types: 'place,locality,neighborhood,address,poi',
        // Request the local language — the response includes BOTH the
        // localized name AND an English fallback under text_en /
        // place_name_en, so we can render English first + local second.
        language: langCode,
      });
      if (countryCode) params.append('country', countryCode.toLowerCase());

      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?${params.toString()}`,
        { signal: controller.signal },
      );
      // If a newer query has fired since we started this request, drop
      // these results on the floor — abort() above already prevented
      // the next-query handler from being affected by us, but we may
      // still have parsed a stale response before the abort landed.
      if (controller.signal.aborted) return;
      const data = await res.json();
      const results = (data.features || []).map((f: any) => {
        // English-first display: prefer place_name_en when Mapbox
        // returns it (which it does whenever language ≠ en). Fall back
        // to place_name. The local-language version goes on the second
        // line so users see both — "Shanghai Zoo" / "上海动物园".
        const enName: string = f.place_name_en || f.place_name;
        const localName: string = f.place_name;
        const localDiffersFromEn = localName && localName !== enName;
        return {
          name: enName,
          subtitle: localDiffersFromEn ? localName : null,
          lat: f.center[1],
          lng: f.center[0],
        };
      });
      setSearchResults(results);
    } catch (err: any) {
      // AbortError when a newer query took over — leave the existing
      // results alone; the new query will populate setSearchResults.
      if (err?.name === 'AbortError') return;
      setSearchResults([]);
    }
  };

  const handleSelectSearchResult = (result: { name: string; lat: number; lng: number }) => {
    handleAddWaypoint(result.lat, result.lng);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <View style={styles.container}>
      {/* Map area */}
      <View style={styles.mapArea}>
        {MapView ? (
          <MapView
            style={StyleSheet.absoluteFillObject}
            styleURL="mapbox://styles/mapbox/outdoors-v12"
            logoEnabled={false}
            attributionEnabled={false}
            scaleBarEnabled={false}
            compassEnabled={false}
            onPress={(e: any) => {
              const coords = e?.geometry?.coordinates;
              if (Array.isArray(coords) && coords.length >= 2) {
                handleAddWaypoint(coords[1], coords[0]);
              }
            }}
          >
            {CameraComponent && (() => {
              const region = getCurrentRegion();
              const last = waypoints[waypoints.length - 1];
              // Camera centring priority:
              //  1. Last waypoint placed (zoom 13) — keeps the editor
              //     camera following what the user is editing.
              //  2. User's current GPS (zoom 14) — opens the editor
              //     centred on the user's actual location, the right
              //     starting point for "I want to plan a route from
              //     where I am right now". userCoord is reactive so
              //     when the GPS prime resolves a few seconds after
              //     mount the camera updates without a manual refresh.
              //  3. Region centre at default zoom — only when GPS is
              //     unavailable (cold start, permission denied).
              const center: [number, number] = last
                ? [last.lng, last.lat]
                : userCoord
                  ? [userCoord.lng, userCoord.lat]
                  : [region.centerLng, region.centerLat];
              const zoom = waypoints.length > 0
                ? 13
                : userCoord
                  ? 14
                  : region.defaultZoom;
              // Snap instantly when there are no waypoints yet — the
              // user expects the editor to "open at" their location,
              // not animate there. Animate during waypoint placement
              // so the camera follow feels natural.
              const dur = waypoints.length > 0 ? 300 : 0;
              return (
                <CameraComponent
                  centerCoordinate={center}
                  zoomLevel={zoom}
                  animationDuration={dur}
                />
              );
            })()}
            {/* Connect waypoints with a line */}
            {ShapeSource && LineLayer && waypoints.length >= 2 && (
              <ShapeSource
                id="route-line"
                shape={{
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: waypoints.map(wp => [wp.lng, wp.lat]),
                  },
                  properties: {},
                }}
              >
                <LineLayer
                  id="route-line-layer"
                  style={{
                    lineColor: Colors.primary,
                    lineWidth: 4,
                    lineOpacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}
            {/* Current user location — blue dot with white ring + soft
                glow. Visually distinct from waypoint pins so the user
                always knows "this is where I am right now" while
                planning. Position comes from useTrackingStore which
                we already prime with getCurrentPositionAsync on
                mount. */}
            {PointAnnotation && userCoord && (
              <PointAnnotation
                id="user-location"
                coordinate={[userCoord.lng, userCoord.lat]}
              >
                <View style={styles.userPinOuter}>
                  <View style={styles.userPinInner} />
                </View>
              </PointAnnotation>
            )}
            {/* Numbered waypoint pins */}
            {PointAnnotation && waypoints.map((wp, i) => (
              <PointAnnotation
                key={wp.id}
                id={wp.id}
                coordinate={[wp.lng, wp.lat]}
              >
                <View style={styles.waypointDot}>
                  <Text style={styles.waypointDotText}>{i + 1}</Text>
                </View>
              </PointAnnotation>
            ))}
          </MapView>
        ) : (
          <>
            <View style={styles.mapFallback}>
              <Icon name="Map" size={48} color={Colors.primaryMuted} />
              <Text style={styles.mapFallbackText}>Route Editor</Text>
              <Text style={styles.mapFallbackSub}>
                {Platform.OS === 'web'
                  ? 'Use search below to add waypoints'
                  : 'Tap map to add waypoints'}
              </Text>
            </View>
            {/* Waypoint markers on fallback panel */}
            {waypoints.map((wp, i) => (
              <View
                key={wp.id}
                style={[styles.waypointDot, {
                  position: 'absolute',
                  left: 100 + (i % 6) * 80,
                  top: 120 + Math.floor(i / 6) * 60,
                }]}
              >
                <Text style={styles.waypointDotText}>{i + 1}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Top bar — explicit safe-area inset so the back/save chips
          never overlap the Dynamic Island.
          v124 fix #8: in VIEW mode the top bar is JUST the back button.
          Edit + Delete moved to the bottom panel for parity with the
          Activity detail layout. EDIT mode keeps Save + (Delete) on top. */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topRow}>
          <BackButton variant="pill" />
          {editMode && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {routeId && existingRoute && (
                <TouchableOpacity
                  style={styles.deleteTopBtn}
                  onPress={() => {
                    Alert.alert(
                      'Delete route?',
                      `"${existingRoute.name}" will be removed. Source activity stays.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => {
                            deleteRoute(routeId);
                            nav.goBack();
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Icon name="Trash2" size={16} color={Colors.danger} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.saveTopBtn} onPress={handleSave}>
                <Icon name="Check" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.saveTopBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Bottom panel — wrapped in KeyboardAvoidingView so the route
          name input + tool buttons rise above the keyboard instead of
          being hidden under it. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomPanelWrap}
        keyboardVerticalOffset={0}
      >
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + Spacing.md }]}>
        {/* Error banner */}
        {errorMsg && (
          <View style={styles.errorBanner}>
            <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}
        {/* Snap-to-road fallback banner — appears when Mapbox couldn't
            align the trace to a road (indoors, no nearby OSM road, or
            track points cluster too tightly to match). Tells the user
            we're showing raw GPS so they don't think the editor is
            broken when waypoints overlap. */}
        {snapWarning && (
          <View style={styles.snapWarnBanner}>
            <Icon name="Info" size={14} color={Colors.severityCaution} strokeWidth={2} />
            <Text style={styles.snapWarnText}>
              Snap-to-road unavailable — track points cluster too tightly to match a road. Showing raw GPS.
            </Text>
          </View>
        )}
        {/* v123 fix #8: in VIEW mode the bottom panel is a read-only
            summary card. Search / Undo / Clear / name-edit are all
            edit-only. We always show the stats row (always useful). */}
        {!editMode ? (
          <>
            <View style={styles.viewSummary}>
              <Text style={styles.viewSummaryName} numberOfLines={1}>
                {existingRoute?.name ?? name ?? 'Route'}
              </Text>
              <View style={styles.viewStatsInline}>
                <Text style={styles.viewStatText}>{waypoints.length} waypoints</Text>
                <Text style={styles.viewStatDot}>·</Text>
                <Text style={styles.viewStatText}>{formatDistance(totalDistanceM, 'km', 1)} km</Text>
              </View>
            </View>
            {/* v124 fix #8: Edit + Delete moved into the bottom panel.
                Matches Activity detail's [Save as Route, Delete] row
                (Edit-on-left, Delete-on-right consistency rule). */}
            <View style={styles.viewActions}>
              <TouchableOpacity
                style={[styles.viewBtn, styles.viewEditBtn]}
                onPress={() => setEditMode(true)}
                activeOpacity={0.85}
              >
                <Icon name="Pencil" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.viewEditBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewBtn, styles.viewDeleteBtn]}
                onPress={() => {
                  if (!routeId) return;
                  Alert.alert(
                    'Delete route?',
                    `"${existingRoute?.name ?? 'This route'}" will be removed. Source activity stays.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          deleteRoute(routeId);
                          nav.goBack();
                        },
                      },
                    ],
                  );
                }}
                activeOpacity={0.85}
              >
                <Icon name="Trash2" size={16} color={Colors.danger} strokeWidth={2.5} />
                <Text style={styles.viewDeleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
        <>
        {/* Route name */}
        <TextInput
          style={styles.nameInput}
          placeholder="Route name (required)"
          placeholderTextColor={Colors.textMuted}
          value={name}
          onChangeText={setName}
        />

        {/* Stats row */}
        <View style={styles.statsRow}>
          <Text style={styles.statText}>{waypoints.length} waypoints</Text>
          <Text style={styles.statText}>{formatDistance(totalDistanceM, 'km', 1)} km</Text>
        </View>

        {/* Search toggle */}
        {showSearch ? (
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search destination..."
              placeholderTextColor={Colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              autoFocus
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
              <Icon name="Search" size={16} color="#fff" strokeWidth={2} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Search results */}
        {searchResults.length > 0 && (
          <FlatList
            data={searchResults}
            keyExtractor={(_, i) => String(i)}
            style={styles.searchResults}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.searchResultItem} onPress={() => handleSelectSearchResult(item)}>
                <Icon name="MapPin" size={14} color={Colors.primary} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.searchResultText} numberOfLines={1}>{item.name}</Text>
                  {item.subtitle && (
                    <Text style={styles.searchResultSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Tool buttons */}
        <View style={styles.toolRow}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setShowSearch(!showSearch)}>
            <Icon name="Search" size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.toolBtnText}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={handleUndo} disabled={waypoints.length === 0}>
            <Icon name="Undo2" size={18} color={waypoints.length > 0 ? Colors.primary : Colors.textMuted} strokeWidth={2} />
            <Text style={[styles.toolBtnText, waypoints.length === 0 && { color: Colors.textMuted }]}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={handleClear} disabled={waypoints.length === 0}>
            <Icon name="Trash2" size={18} color={waypoints.length > 0 ? Colors.danger : Colors.textMuted} strokeWidth={2} />
            <Text style={[styles.toolBtnText, { color: waypoints.length > 0 ? Colors.danger : Colors.textMuted }]}>Clear</Text>
          </TouchableOpacity>
        </View>
        </>
        )}
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primaryBg },
  mapArea: { flex: 1 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  mapFallbackText: { fontSize: FontSize.h3, fontWeight: '600', color: Colors.textPrimary },
  mapFallbackSub: { fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center' },
  waypointDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', ...Shadow.card,
  },
  waypointDotText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  // User location pin — outer translucent ring + inner solid blue dot,
  // matches the iOS "Find My" / Mapbox UserLocationComponent visual
  // language. White center ring separates the dot from the map at any
  // basemap colour.
  userPinOuter: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(58,134,237,0.25)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  userPinInner: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#3a86ed',
  },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg,
  },
  saveTopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  saveTopBtnText: { fontSize: FontSize.small, fontWeight: '700', color: '#fff' },
  // v122 fix #8: delete button on the route editor top bar (only
  // shown when editing an existing route).
  deleteTopBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  // v123 fix #8: read-only summary card shown when in VIEW mode (route
  // detail). User taps Edit in the top bar to switch to the editing UI.
  viewSummary: {
    backgroundColor: Colors.primaryBg,
    padding: Spacing.md,
    borderRadius: Radius.card,
    gap: 4,
    marginBottom: Spacing.sm,
  },
  viewSummaryName: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  viewSummaryHint: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
  },
  // v124 fix #8: stats row inline with the route name (single block).
  viewStatsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  viewStatText: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
  },
  viewStatDot: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
  },
  // v124 fix #8: Edit + Delete buttons in the VIEW-mode bottom panel.
  // Equal-width siblings, matches Activity detail's two-button row.
  viewActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.button,
  },
  viewEditBtn: {
    backgroundColor: Colors.primary,
  },
  viewEditBtnText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  viewDeleteBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  viewDeleteBtnText: {
    color: Colors.danger,
    fontSize: FontSize.body,
    fontWeight: '700',
  },

  // KeyboardAvoidingView wrapper sits at the bottom of the screen and
  // pushes its child up when the keyboard appears.
  bottomPanelWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  bottomPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.base, paddingTop: Spacing.md,
    ...Shadow.overlay,
  },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg ?? '#fde8ea', borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.danger ?? '#c53d2e',
  },
  errorText: { fontSize: FontSize.small, color: Colors.danger ?? '#c53d2e', fontWeight: '600', flex: 1 },
  // Yellow caution banner used when snap-to-road fell back to raw GPS.
  // Same shape as errorBanner but caution palette so users read it as
  // "heads up" not "error".
  snapWarnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.severityWarningBg ?? '#fef3e2', borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.severityCaution ?? '#f59e0b',
  },
  snapWarnText: { fontSize: FontSize.small, color: Colors.severityCaution ?? '#b36b00', fontWeight: '600', flex: 1 },
  nameInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  statText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },

  searchBox: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  searchInput: {
    flex: 1, backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.sm, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  searchResults: { maxHeight: 150, marginBottom: Spacing.sm },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 8, paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  searchResultText: { fontSize: FontSize.small, color: Colors.textPrimary, fontWeight: '500' },
  searchResultSubtitle: { fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 1 },

  toolRow: { flexDirection: 'row', gap: Spacing.sm },
  toolBtn: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.sm,
    borderRadius: Radius.card, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  toolBtnText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
});
