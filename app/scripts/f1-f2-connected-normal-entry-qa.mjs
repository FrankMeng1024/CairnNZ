#!/usr/bin/env node

/**
 * F1/F2 connected normal-entry QA.
 *
 * This is loaded Expo Web evidence with a disposable user, deterministic
 * O55 Raw GPS input, and fixture-fulfilled API calls. It exercises normal UI
 * handlers; it is not native GPS, physical-device, real Mapbox Matching,
 * production API, or MySQL evidence.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { calculateV1SourceFingerprint } from '../../backend/scripts/v1-source-fingerprint.mjs';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(
  process.env.CAIRN_F1_F2_QA_DIR || '_review/f1-f2-connected-normal-entry',
);
const qaNamespace = String(
  process.env.CAIRN_F1_F2_QA_NAMESPACE || `f1-f2-${process.pid}`,
).replace(/[^a-zA-Z0-9._-]/g, '-');
const fixtureUserId = String(process.env.CAIRN_F1_F2_QA_USER_ID || '9902');
if (!/^\d+$/.test(fixtureUserId)) throw new Error('fixture_user_id_must_be_numeric');
const browserProfileDir = path.resolve(
  process.env.CAIRN_F1_F2_QA_BROWSER_PROFILE
    || path.join(process.env.TMPDIR || '/tmp', `cairn-${qaNamespace}-chrome-profile`),
);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewport = { width: 390, height: 844 };
const user = {
  id: fixtureUserId,
  name: 'Connected Journey QA',
  email: `${qaNamespace}@example.invalid`,
  createdAt: '2026-09-20T00:00:00.000Z',
  hasPassword: true,
  providers: ['email'],
};
const rawGpsFixture = Object.freeze({
  authority: 'O55 R-GPS-02',
  model: 'O55 rawGpsObservationModel / REALISTIC_GPS_PROFILE',
  seed: 550202,
  origin: { lat: -41.2865, lng: 174.7762 },
  speedKmh: 4.68,
  physicalPauseSeconds: 8,
  localVerticesM: [[0, 0], [70, 12], [86, 48], [48, 48], [65, 48], [110, 48]],
});
const EXPECTED_BACKGROUND_API_FIXTURES = new Map([
  ['POST /api/edit-diag', { ok: true }],
  ['POST /api/telemetry/sessions', { ok: true }],
  ['GET /api/friends', []],
  ['GET /api/friends/requests', []],
  ['GET /api/friends/requests/outbound', []],
  ['GET /api/friends/blocked', []],
  ['GET /api/friend-sharing/policy', { policy: null }],
  ['GET /api/friend-sharing/private-places', { places: [] }],
  ['GET /api/friend-sharing/sources', { sources: [] }],
  ['POST /api/friend-sharing/projections', { cells: [], projections: [] }],
  ['POST /api/friend-content/encounters/verify', { encountered_marker_ids: [] }],
  ['GET /api/memory-subscriptions', { limit: 5, count: 0, subscriptions: [] }],
  ['GET /api/public-cairns/capabilities', { enabled: false }],
  ['GET /api/markers/library', { markers: [], has_more: false, next_cursor: null }],
  ['GET /api/push/preferences', { memoryHits: false, announcements: false }],
]);
const EXPECTED_MAPBOX_NO_CONTENT_FIXTURES = new Map([
  ['POST events.mapbox.com/events/v2', 'fixture-mapbox-events-empty'],
  ['GET api.mapbox.com/map-sessions/v1', 'fixture-mapbox-session-no-content'],
]);
const sourceFingerprint = calculateV1SourceFingerprint();

function expectedBackgroundApiFixture(method, pathname) {
  const exactKey = `${method} ${pathname}`;
  const queryAgnosticKey = pathname === '/api/markers/library'
    ? `${method} /api/markers/library`
    : exactKey;
  if (!EXPECTED_BACKGROUND_API_FIXTURES.has(queryAgnosticKey)) {
    return { matched: false, key: queryAgnosticKey, body: null };
  }
  return {
    matched: true,
    key: queryAgnosticKey,
    body: EXPECTED_BACKGROUND_API_FIXTURES.get(queryAgnosticKey),
  };
}

function expectedMapboxNoContentFixture(method, hostname, pathname) {
  const key = `${method} ${hostname}${pathname}`;
  if (!EXPECTED_MAPBOX_NO_CONTENT_FIXTURES.has(key)) {
    return { matched: false, key, status: null, action: null };
  }
  return {
    matched: true,
    key,
    status: 204,
    action: EXPECTED_MAPBOX_NO_CONTENT_FIXTURES.get(key),
  };
}

function expectedMapboxWalkingDirectionsFixture(method, hostname, pathname, searchParams) {
  const key = `${method} ${hostname}${pathname}`;
  const prefix = '/directions/v5/mapbox/walking/';
  const expectedQuery = new Map([
    ['alternatives', 'true'],
    ['geometries', 'geojson'],
    ['overview', 'full'],
    ['steps', 'true'],
  ]);
  const queryKeys = [...searchParams.keys()].sort();
  const expectedKeys = [...expectedQuery.keys(), 'access_token'].sort();
  const queryShapeMatches = queryKeys.length === expectedKeys.length
    && queryKeys.every((value, index) => value === expectedKeys[index])
    && [...expectedQuery].every(([name, value]) => searchParams.get(name) === value)
    && String(searchParams.get('access_token') ?? '').startsWith('pk.');
  if (method !== 'GET' || hostname !== 'api.mapbox.com'
    || !pathname.startsWith(prefix) || !queryShapeMatches) {
    return { matched: false, key, action: null, body: null };
  }
  const encodedCoordinates = pathname.slice(prefix.length);
  const coordinates = decodeURIComponent(encodedCoordinates).split(';').map(pair => {
    const [lng, lat, ...extra] = pair.split(',');
    return extra.length === 0 ? [Number(lng), Number(lat)] : [Number.NaN, Number.NaN];
  });
  if (coordinates.length !== 2 || coordinates.some(([lng, lat]) => (
    !Number.isFinite(lng) || !Number.isFinite(lat)
    || Math.abs(lng) > 180 || Math.abs(lat) > 90
  ))) {
    return { matched: false, key, action: null, body: null };
  }
  const [[startLng, startLat], [endLng, endLat]] = coordinates;
  const deltaLng = endLng - startLng;
  const deltaLat = endLat - startLat;
  const length = Math.hypot(deltaLng, deltaLat) || 1;
  const bend = 0.0000015;
  const midpoint = [
    (startLng + endLng) / 2 - bend * deltaLat / length,
    (startLat + endLat) / 2 + bend * deltaLng / length,
  ];
  return {
    matched: true,
    key,
    action: 'fixture-mapbox-walking-directions',
    body: {
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: [coordinates[0], midpoint, coordinates[1]] },
        legs: [{ steps: [{ name: 'Isolated QA walking connector' }] }],
      }],
    },
  };
}

/**
 * Read loaded fog geometry only while Memory owns the mounted debug map.
 * Non-Memory snapshots deliberately do not treat a stale/unmounted Mapbox
 * object as persistence evidence.
 */
function readMountedMemoryFogPresentation(runtime = globalThis) {
  const currentRoute = runtime.__cairnStores?.getCurrentRoute?.() ?? null;
  const unavailable = lifecycleScope => ({
    lifecycleScope,
    mapLoaded: false,
    sourcePresent: false,
    geometryType: null,
    polygonCount: 0,
    innerRingCount: 0,
    evidencePointCount: 0,
    contentSignature: '',
    geometryRevision: '',
    geometry: null,
  });
  if (currentRoute !== 'Memory') return unavailable('not-memory');
  const map = runtime.__cairnMap;
  if (!map) return unavailable('memory-map-unavailable');
  try {
    const mapLoaded = Boolean(map.loaded?.());
    const fogSource = map.getSource?.('memory-fog-src');
    const serializedFog = fogSource?.serialize?.();
    let fogData = serializedFog?.data ?? fogSource?._data ?? null;
    if (typeof fogData === 'string') {
      try { fogData = JSON.parse(fogData); } catch { fogData = null; }
    }
    const feature = fogData?.type === 'FeatureCollection' ? fogData.features?.[0] : fogData;
    const fogGeometry = feature?.geometry;
    const fogProperties = feature?.properties;
    const polygonCoordinates = fogGeometry?.type === 'Polygon'
      ? [fogGeometry.coordinates]
      : fogGeometry?.type === 'MultiPolygon' ? fogGeometry.coordinates : [];
    const innerRingCount = polygonCoordinates.reduce(
      (total, polygon) => total + Math.max(0, (polygon?.length ?? 0) - 1),
      0,
    );
    return {
      lifecycleScope: 'mounted-memory',
      mapLoaded,
      sourcePresent: Boolean(fogSource),
      geometryType: fogGeometry?.type ?? null,
      polygonCount: polygonCoordinates.length,
      innerRingCount,
      evidencePointCount: Number(fogProperties?.cairnEvidencePointCount ?? 0),
      contentSignature: String(fogProperties?.cairnContentSignature ?? ''),
      geometryRevision: String(fogProperties?.cairnGeometryRevision ?? ''),
      geometry: fogGeometry ?? null,
    };
  } catch (error) {
    return {
      ...unavailable('memory-map-destroyed'),
      readError: String(error instanceof Error ? error.message : error),
    };
  }
}

/** Read the exact GeoJSON owned by the currently mounted Hike/Run map. */
function readMountedPlannedRoutePresentation(runtime = globalThis) {
  const currentRoute = runtime.__cairnStores?.getCurrentRoute?.() ?? null;
  const unavailable = lifecycleScope => ({
    lifecycleScope,
    mapLoaded: false,
    sourcePresent: false,
    layerPresent: false,
    geometryType: null,
    coordinates: [],
  });
  if (currentRoute !== 'Hiking' && currentRoute !== 'Running') {
    return unavailable('not-activity-prestart');
  }
  const map = runtime.__cairnMap;
  if (!map) return unavailable('activity-map-unavailable');
  try {
    const source = map.getSource?.('planned-route-source');
    const serialized = source?.serialize?.();
    let data = serialized?.data ?? source?._data ?? null;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = null; }
    }
    const feature = data?.type === 'FeatureCollection' ? data.features?.[0] : data;
    const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
    return {
      lifecycleScope: 'mounted-activity-prestart',
      mapLoaded: Boolean(map.loaded?.()),
      sourcePresent: Boolean(source),
      layerPresent: Boolean(map.getLayer?.('planned-route-line')),
      geometryType: geometry?.type ?? null,
      coordinates: geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)
        ? geometry.coordinates
        : [],
    };
  } catch (error) {
    return {
      ...unavailable('activity-map-destroyed'),
      readError: String(error instanceof Error ? error.message : error),
    };
  }
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function routePointsGeometryHash(points) {
  return sha((points ?? []).map(point => [Number(point.lng), Number(point.lat)]));
}

function matchesPrestartRouteSelection(stage, expected) {
  const commonBoundary = stage?.currentRoute === expected.screen
    && stage?.navigation?.routeId === expected.routeId
    && stage?.prestartRouteSelection?.routeName === expected.routeName
    && stage?.prestartRouteSelection?.routeNameVisible === true
    && stage?.prestartRouteSelection?.referenceDescriptionVisible === true
    && stage?.route?.clientRouteId === expected.routeId
    && routePointsGeometryHash(stage?.route?.points) === expected.geometryHash
    && stage?.route?.syncState === 'synced';
  if (!commonBoundary) return false;
  if (expected.mapCapability === 'web_fallback') {
    return stage?.prestartRouteSelection?.mapCapability === 'web_fallback'
      && stage?.prestartRouteSelection?.mapUnavailableVisible === true
      && stage?.prestartRouteSelection?.plannedRouteSourceLoaded === false
      && stage?.prestartRouteSelection?.nativeMountedMapboxSource === 'NOT_RUN'
      && stage?.plannedRoutePresentation?.sourcePresent === false
      && stage?.plannedRoutePresentation?.layerPresent === false;
  }
  return expected.mapCapability === 'native_mapbox'
    && stage?.prestartRouteSelection?.mapCapability === 'native_mapbox'
    && stage?.prestartRouteSelection?.plannedRouteSourceLoaded === true
    && stage?.plannedRoutePresentation?.lifecycleScope === 'mounted-activity-prestart'
    && stage?.plannedRoutePresentation?.mapLoaded === true
    && stage?.plannedRoutePresentation?.sourcePresent === true
    && stage?.plannedRoutePresentation?.layerPresent === true
    && stage?.plannedRoutePresentation?.geometryType === 'LineString'
    && stage?.plannedRoutePresentation?.geometryHash === expected.geometryHash;
}

function matchesIdlePrestartBoundary(stage) {
  return stage?.tracking?.status === 'idle'
    && stage?.tracking?.sessionId == null
    && stage?.activityRouteReference == null;
}

function toCoordinate([eastM, northM]) {
  const metresPerDegree = 111_320;
  return {
    lat: rawGpsFixture.origin.lat + northM / metresPerDegree,
    lng: rawGpsFixture.origin.lng
      + eastM / (metresPerDegree * Math.cos(rawGpsFixture.origin.lat * Math.PI / 180)),
  };
}

function bearingDegrees(a, b) {
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}

function wrappedTurn(a, b) {
  return ((b - a + 540) % 360) - 180;
}

function scenarioSensitivity(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 6) throw new Error('scenario_requires_six_vertices');
  const segmentLengthsM = vertices.slice(1).map((point, index) => Math.hypot(
    point[0] - vertices[index][0],
    point[1] - vertices[index][1],
  ));
  const bearings = vertices.slice(1).map((point, index) => bearingDegrees(vertices[index], point));
  const turns = bearings.slice(1).map((bearing, index) => wrappedTurn(bearings[index], bearing));
  const nonCollinear = turns.some(value => Math.abs(value) >= 35 && Math.abs(value) <= 145);
  const legs = vertices.slice(1).map((point, index) => [
    point[0] - vertices[index][0],
    point[1] - vertices[index][1],
  ]);
  const firstLeg = legs[0];
  const dotWithFirst = leg => leg[0] * firstLeg[0] + leg[1] * firstLeg[1];
  const backtrackLegIndex = legs.findIndex((leg, index) => index > 0 && dotWithFirst(leg) < 0);
  const hasBacktrack = backtrackLegIndex >= 0;
  const hasForwardAfterBacktrack = hasBacktrack
    && legs.slice(backtrackLegIndex + 1).some(leg => dotWithFirst(leg) > 0);
  if (!nonCollinear) throw new Error('scenario_lost_bend_or_turn');
  if (!hasBacktrack || !hasForwardAfterBacktrack) throw new Error('scenario_lost_backtrack_or_forward_recovery');
  if (!segmentLengthsM.every(value => value >= 10)) throw new Error('scenario_has_degenerate_leg');
  return { segmentLengthsM, bearings, turns, nonCollinear, hasBacktrack, hasForwardAfterBacktrack };
}

function runSelfTest() {
  const sensitivity = scenarioSensitivity(rawGpsFixture.localVerticesM);
  let straightLineRejected = false;
  try {
    scenarioSensitivity(rawGpsFixture.localVerticesM.map(([east]) => [east, 0]));
  } catch {
    straightLineRejected = true;
  }
  if (!straightLineRejected) throw new Error('sensitivity_control_failed');
  const coordinates = rawGpsFixture.localVerticesM.map(toCoordinate);
  const perturbed = coordinates.map((point, index) => (
    index === 0 || index === coordinates.length - 1
      ? point
      : { lat: point.lat + 0.000004 * Math.sin(index), lng: point.lng + 0.000006 * Math.cos(index) }
  ));
  if (sha(coordinates) === sha(perturbed)) throw new Error('geometry_mutation_sensitivity_failed');
  const expectedEncounter = expectedBackgroundApiFixture(
    'POST',
    '/api/friend-content/encounters/verify',
  );
  const wrongEncounterMethod = expectedBackgroundApiFixture(
    'GET',
    '/api/friend-content/encounters/verify',
  );
  const unknownEndpoint = expectedBackgroundApiFixture('POST', '/api/qa-unknown-endpoint');
  if (!expectedEncounter.matched
    || JSON.stringify(expectedEncounter.body) !== JSON.stringify({ encountered_marker_ids: [] })) {
    throw new Error('expected_encounter_fixture_missing_or_wrong');
  }
  if (wrongEncounterMethod.matched) throw new Error('api_allowlist_method_sensitivity_failed');
  if (unknownEndpoint.matched) throw new Error('unknown_api_strict_rejection_failed');
  const expectedMapboxSession = expectedMapboxNoContentFixture(
    'GET',
    'api.mapbox.com',
    '/map-sessions/v1',
  );
  const wrongMapboxSessionMethod = expectedMapboxNoContentFixture(
    'POST',
    'api.mapbox.com',
    '/map-sessions/v1',
  );
  const unknownMapboxTelemetry = expectedMapboxNoContentFixture(
    'GET',
    'api.mapbox.com',
    '/map-sessions/v2',
  );
  if (!expectedMapboxSession.matched || expectedMapboxSession.status !== 204) {
    throw new Error('expected_mapbox_session_fixture_missing_or_wrong');
  }
  if (wrongMapboxSessionMethod.matched || unknownMapboxTelemetry.matched) {
    throw new Error('mapbox_telemetry_allowlist_sensitivity_failed');
  }
  const knownDirectionsPath = '/directions/v5/mapbox/walking/174.777208,-41.286070;174.776777,-41.286096';
  const knownDirectionsQuery = new URLSearchParams({
    alternatives: 'true',
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    access_token: 'pk.synthetic-self-test-token',
  });
  const expectedDirections = expectedMapboxWalkingDirectionsFixture(
    'GET', 'api.mapbox.com', knownDirectionsPath, knownDirectionsQuery,
  );
  const wrongDirectionsMethod = expectedMapboxWalkingDirectionsFixture(
    'POST', 'api.mapbox.com', knownDirectionsPath, knownDirectionsQuery,
  );
  const wrongDirectionsProfile = expectedMapboxWalkingDirectionsFixture(
    'GET', 'api.mapbox.com', knownDirectionsPath.replace('/walking/', '/driving/'), knownDirectionsQuery,
  );
  const incompleteDirectionsQuery = new URLSearchParams(knownDirectionsQuery);
  incompleteDirectionsQuery.delete('steps');
  const missingDirectionsQuery = expectedMapboxWalkingDirectionsFixture(
    'GET', 'api.mapbox.com', knownDirectionsPath, incompleteDirectionsQuery,
  );
  if (!expectedDirections.matched
    || expectedDirections.action !== 'fixture-mapbox-walking-directions'
    || expectedDirections.body?.code !== 'Ok'
    || expectedDirections.body?.routes?.[0]?.geometry?.coordinates?.length < 2) {
    throw new Error('expected_mapbox_directions_fixture_missing_or_wrong');
  }
  if (wrongDirectionsMethod.matched || wrongDirectionsProfile.matched || missingDirectionsQuery.matched) {
    throw new Error('mapbox_directions_allowlist_sensitivity_failed');
  }
  const throwingMap = {
    loaded() { throw new Error('destroyed-map'); },
    getSource() { throw new Error('destroyed-map'); },
  };
  const nonMemoryFog = readMountedMemoryFogPresentation({
    __cairnStores: { getCurrentRoute: () => 'Hiking' },
    __cairnMap: throwingMap,
  });
  const destroyedMemoryFog = readMountedMemoryFogPresentation({
    __cairnStores: { getCurrentRoute: () => 'Memory' },
    __cairnMap: throwingMap,
  });
  if (nonMemoryFog.lifecycleScope !== 'not-memory' || nonMemoryFog.sourcePresent) {
    throw new Error('non_memory_map_lifecycle_sensitivity_failed');
  }
  if (destroyedMemoryFog.lifecycleScope !== 'memory-map-destroyed'
    || !destroyedMemoryFog.readError?.includes('destroyed-map')) {
    throw new Error('destroyed_map_lifecycle_sensitivity_failed');
  }
  const prestartPoints = [{ lat: -41.2865, lng: 174.7762 }, { lat: -41.286, lng: 174.777 }];
  const expectedPrestart = {
    screen: 'Running',
    routeId: 'route-client-1',
    routeName: 'Version-bound route',
    geometryHash: routePointsGeometryHash(prestartPoints),
    mapCapability: 'web_fallback',
  };
  const validPrestart = {
    currentRoute: 'Running',
    navigation: { name: 'Running', routeId: 'route-client-1' },
    tracking: { status: 'idle', sessionId: null },
    route: {
      clientRouteId: 'route-client-1',
      name: 'Version-bound route',
      points: prestartPoints,
      syncState: 'synced',
    },
    activityRouteReference: null,
    prestartRouteSelection: {
      routeName: 'Version-bound route',
      routeNameVisible: true,
      referenceDescriptionVisible: true,
      mapCapability: 'web_fallback',
      mapUnavailableVisible: true,
      plannedRouteSourceLoaded: false,
      nativeMountedMapboxSource: 'NOT_RUN',
    },
    plannedRoutePresentation: {
      lifecycleScope: 'activity-map-unavailable',
      mapLoaded: false,
      sourcePresent: false,
      layerPresent: false,
      geometryType: null,
      geometryHash: sha([]),
    },
  };
  if (!matchesPrestartRouteSelection(validPrestart, expectedPrestart)
    || !matchesIdlePrestartBoundary(validPrestart)) {
    throw new Error('valid_prestart_route_contract_rejected');
  }
  const wrongGeometry = {
    ...validPrestart,
    route: { ...validPrestart.route, points: [...prestartPoints, { lat: -41.2858, lng: 174.7772 }] },
  };
  const wrongNavigationIdentity = {
    ...validPrestart,
    navigation: { name: 'Running', routeId: 'route-client-other' },
  };
  const hiddenWebFallback = {
    ...validPrestart,
    prestartRouteSelection: {
      ...validPrestart.prestartRouteSelection,
      mapUnavailableVisible: false,
    },
  };
  const fabricatedWebSource = {
    ...validPrestart,
    prestartRouteSelection: {
      ...validPrestart.prestartRouteSelection,
      plannedRouteSourceLoaded: true,
    },
  };
  const nativeExpectedPrestart = { ...expectedPrestart, mapCapability: 'native_mapbox' };
  const validNativePrestart = {
    ...validPrestart,
    prestartRouteSelection: {
      ...validPrestart.prestartRouteSelection,
      mapCapability: 'native_mapbox',
      mapUnavailableVisible: false,
      plannedRouteSourceLoaded: true,
      nativeMountedMapboxSource: 'LOADED',
    },
    plannedRoutePresentation: {
      lifecycleScope: 'mounted-activity-prestart',
      mapLoaded: true,
      sourcePresent: true,
      layerPresent: true,
      geometryType: 'LineString',
      geometryHash: routePointsGeometryHash(prestartPoints),
    },
  };
  const wrongMountedGeometry = {
    ...validNativePrestart,
    plannedRoutePresentation: {
      ...validNativePrestart.plannedRoutePresentation,
      geometryHash: sha([[174.7, -41.2], [174.8, -41.1]]),
    },
  };
  const missingNativeSource = {
    ...validNativePrestart,
    plannedRoutePresentation: {
      ...validNativePrestart.plannedRoutePresentation,
      lifecycleScope: 'activity-map-unavailable',
      mapLoaded: false,
      sourcePresent: false,
      layerPresent: false,
      geometryType: null,
      geometryHash: sha([]),
    },
    prestartRouteSelection: {
      ...validNativePrestart.prestartRouteSelection,
      plannedRouteSourceLoaded: false,
    },
  };
  const prematureReference = {
    ...validPrestart,
    activityRouteReference: { routeId: 'route-client-1', points: prestartPoints },
  };
  const recordingPrestart = {
    ...validPrestart,
    tracking: { status: 'tracking', sessionId: 'activity-too-early' },
  };
  if (matchesPrestartRouteSelection(wrongGeometry, expectedPrestart)
    || matchesPrestartRouteSelection(wrongNavigationIdentity, expectedPrestart)
    || matchesPrestartRouteSelection(hiddenWebFallback, expectedPrestart)
    || matchesPrestartRouteSelection(fabricatedWebSource, expectedPrestart)
    || !matchesPrestartRouteSelection(validNativePrestart, nativeExpectedPrestart)
    || matchesPrestartRouteSelection(wrongMountedGeometry, nativeExpectedPrestart)
    || matchesPrestartRouteSelection(missingNativeSource, nativeExpectedPrestart)
    || matchesIdlePrestartBoundary(prematureReference)
    || matchesIdlePrestartBoundary(recordingPrestart)) {
    throw new Error('prestart_route_contract_mutation_sensitivity_failed');
  }
  process.stdout.write(`${JSON.stringify({
    selfTest: 'PASS',
    fingerprint: sourceFingerprint,
    fixture: rawGpsFixture,
    sensitivity,
    straightLineRejected,
    originalGeometryHash: sha(coordinates),
    perturbedGeometryHash: sha(perturbed),
    apiAllowlistSensitivity: {
      expectedEncounter,
      wrongEncounterMethodRejected: !wrongEncounterMethod.matched,
      unknownEndpointRejected: !unknownEndpoint.matched,
      fixtureCount: EXPECTED_BACKGROUND_API_FIXTURES.size,
    },
    mapboxIsolationSensitivity: {
      expectedMapboxSession,
      expectedDirections,
      wrongMethodRejected: !wrongMapboxSessionMethod.matched,
      unknownTelemetryPathRejected: !unknownMapboxTelemetry.matched,
      wrongDirectionsMethodRejected: !wrongDirectionsMethod.matched,
      wrongDirectionsProfileRejected: !wrongDirectionsProfile.matched,
      missingDirectionsQueryRejected: !missingDirectionsQuery.matched,
      fixtureCount: EXPECTED_MAPBOX_NO_CONTENT_FIXTURES.size,
    },
    mapLifecycleSensitivity: {
      nonMemoryFog,
      destroyedMemoryFog,
    },
    prestartRouteSensitivity: {
      validSelectionAccepted: matchesPrestartRouteSelection(validPrestart, expectedPrestart),
      idleNullReferenceAccepted: matchesIdlePrestartBoundary(validPrestart),
      wrongGeometryRejected: !matchesPrestartRouteSelection(wrongGeometry, expectedPrestart),
      wrongNavigationIdentityRejected: !matchesPrestartRouteSelection(wrongNavigationIdentity, expectedPrestart),
      hiddenWebFallbackRejected: !matchesPrestartRouteSelection(hiddenWebFallback, expectedPrestart),
      fabricatedWebSourceRejected: !matchesPrestartRouteSelection(fabricatedWebSource, expectedPrestart),
      validNativeSourceAccepted: matchesPrestartRouteSelection(validNativePrestart, nativeExpectedPrestart),
      wrongMountedGeometryRejected: !matchesPrestartRouteSelection(wrongMountedGeometry, nativeExpectedPrestart),
      missingNativeSourceRejected: !matchesPrestartRouteSelection(missingNativeSource, nativeExpectedPrestart),
      prematureReferenceRejected: !matchesIdlePrestartBoundary(prematureReference),
      recordingRejected: !matchesIdlePrestartBoundary(recordingPrestart),
    },
  }, null, 2)}\n`);
}

if (process.env.CAIRN_F1_F2_QA_SELF_TEST === '1') {
  runSelfTest();
} else {
  await runLoadedJourney();
}

async function runLoadedJourney() {
  fs.mkdirSync(outputDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const requests = [];
  const externalRequests = [];
  const unexpectedExternalRequests = [];
  const unexpectedApiRequests = [];
  const failedRequests = [];
  const httpErrors = [];
  const runtimeErrors = [];
  const consoleNotes = [];
  const stages = [];
  const captures = [];
  const flow = [];
  const assertions = {};
  const identities = {};
  let qaStep = 'boot';
  let savedActivity = null;
  let startedClientActivityId = null;
  let markerCreateBody = null;
  let routeCreateBody = null;
  let routeUpdateBodies = [];
  let remoteMarker = null;
  let nextRemoteRouteId = 6201;
  const remoteRoutes = new Map();
  let matchingCalls = 0;
  let directionsCalls = 0;
  const directionsCallSteps = [];
  let browser = null;
  let context = null;
  let page = null;
  let traceStopped = false;
  let terminalError = null;

  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const redactUrl = value => String(value)
    .replace(/([?&]access_token=)[^&]+/ig, '$1[redacted]')
    .replace(/([?&]token=)[^&]+/ig, '$1[redacted]');
  const recordExternal = (request, action) => externalRequests.push({
    at: new Date().toISOString(),
    step: qaStep,
    method: request.method(),
    resourceType: request.resourceType(),
    url: redactUrl(request.url()),
    action,
  });

  function remoteRouteRow(body, id, previous = null) {
    const createdAt = previous?.created_at ?? new Date().toISOString();
    const sourceOrigin = previous?.creation_origin
      ?? (body.source_activity_client_id || body.source_session_id ? 'activity' : 'manual');
    const originalHash = previous?.origin_geometry_hash ?? sha(savedActivity?.route_points ?? body.points ?? []);
    const createdHash = previous?.created_geometry_hash ?? sha(body.points ?? []);
    return {
      id,
      user_id: Number(user.id),
      client_route_id: previous?.client_route_id ?? body.client_route_id ?? null,
      creation_origin: sourceOrigin,
      source_activity_client_id: previous?.source_activity_client_id ?? body.source_activity_client_id ?? null,
      source_session_id: previous?.source_session_id ?? body.source_session_id ?? null,
      origin_geometry_hash: originalHash,
      created_geometry_hash: createdHash,
      geometry_edited_since_creation: previous
        ? Number(body.points !== undefined || previous.geometry_edited_since_creation === 1)
        : 0,
      origin_gap_reconnected: previous?.origin_gap_reconnected ?? Number(Boolean(body.origin_gap_reconnected)),
      name: body.name ?? previous?.name ?? 'Connected Route',
      description: body.description ?? previous?.description ?? null,
      points: body.points ?? previous?.points ?? [],
      waypoints: body.waypoints ?? previous?.waypoints ?? [],
      distance_m: body.distance_m ?? previous?.distance_m ?? 0,
      elevation_gain_m: body.elevation_gain_m ?? previous?.elevation_gain_m ?? 0,
      run_count: previous?.run_count ?? 0,
      last_run_at: null,
      permission: body.permission ?? previous?.permission ?? 'personal',
      created_at: createdAt,
      updated_at: new Date().toISOString(),
    };
  }

  try {
    context = await chromium.launchPersistentContext(browserProfileDir, {
      headless: true,
      executablePath: chromePath,
      args: ['--disable-web-security'],
      viewport,
      deviceScaleFactor: 1,
      locale: 'en-NZ',
      timezoneId: 'Pacific/Auckland',
      geolocation: {
        latitude: rawGpsFixture.origin.lat,
        longitude: rawGpsFixture.origin.lng,
        accuracy: 16,
      },
      permissions: ['geolocation'],
      reducedMotion: 'reduce',
    });
    browser = context.browser();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = context.pages()[0] ?? await context.newPage();

    page.on('pageerror', error => runtimeErrors.push(`pageerror [${qaStep}]: ${error.message}`));
    page.on('request', request => {
      const parsed = new URL(request.url());
      if (!/^https?:$/.test(parsed.protocol) || parsed.origin === new URL(baseUrl).origin) return;
      const explicitlyIsolated = ['api.mapbox.com', 'tiles.mapbox.com', 'events.mapbox.com',
        'api.open-meteo.com', 'api.bigdatacloud.net'].includes(parsed.hostname)
        || parsed.pathname.startsWith('/api/');
      if (explicitlyIsolated) return;
      const entry = {
        at: new Date().toISOString(),
        step: qaStep,
        method: request.method(),
        resourceType: request.resourceType(),
        url: redactUrl(request.url()),
      };
      unexpectedExternalRequests.push(entry);
      runtimeErrors.push(`unexpected-external [${qaStep}] ${entry.method} ${entry.resourceType} ${entry.url}`);
    });
    page.on('requestfailed', request => {
      const entry = {
        at: new Date().toISOString(),
        step: qaStep,
        method: request.method(),
        resourceType: request.resourceType(),
        url: redactUrl(request.url()),
        error: request.failure()?.errorText ?? 'unknown',
      };
      failedRequests.push(entry);
      runtimeErrors.push(`requestfailed [${qaStep}] ${entry.method} ${entry.resourceType} ${entry.url}: ${entry.error}`);
    });
    page.on('response', response => {
      if (response.status() < 400) return;
      const request = response.request();
      const entry = {
        at: new Date().toISOString(),
        step: qaStep,
        status: response.status(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: redactUrl(response.url()),
      };
      httpErrors.push(entry);
      runtimeErrors.push(`http [${qaStep}] ${entry.status} ${entry.method} ${entry.resourceType} ${entry.url}`);
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const location = message.location();
      const source = location.url
        ? `${redactUrl(location.url)}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`
        : 'unknown-location';
      runtimeErrors.push(`console [${qaStep}] ${source}: ${message.text()}`);
    });
    page.on('dialog', dialog => dialog.dismiss());

    // Keep every external read deterministic and context-local. The blank
    // Mapbox style still exercises the loaded map canvas and Cairn-owned
    // GeoJSON layers without depending on remote tiles or hiding failures.
    await page.route(/https:\/\/(?:api|tiles|events)\.mapbox\.com\/.*/, async route => {
      const request = route.request();
      const parsed = new URL(request.url());
      const noContentFixture = expectedMapboxNoContentFixture(
        request.method(),
        parsed.hostname,
        parsed.pathname,
      );
      if (noContentFixture.matched) {
        recordExternal(request, noContentFixture.action);
        return route.fulfill({ status: noContentFixture.status, body: '' });
      }
      if (parsed.pathname.startsWith('/styles/v1/')) {
        recordExternal(request, 'fixture-mapbox-empty-style');
        return json(route, {
          version: 8,
          name: `Cairn ${qaNamespace} isolated QA style`,
          center: [rawGpsFixture.origin.lng, rawGpsFixture.origin.lat],
          zoom: 13,
          sources: {},
          layers: [{ id: 'qa-background', type: 'background', paint: { 'background-color': '#dce5dc' } }],
        });
      }
      const directionsFixture = expectedMapboxWalkingDirectionsFixture(
        request.method(), parsed.hostname, parsed.pathname, parsed.searchParams,
      );
      if (directionsFixture.matched) {
        directionsCalls += 1;
        directionsCallSteps.push(qaStep);
        recordExternal(request, directionsFixture.action);
        requests.push({
          at: new Date().toISOString(), step: qaStep, method: request.method(),
          pathname: parsed.pathname, action: directionsFixture.action, inputPoints: 2,
        });
        return json(route, directionsFixture.body);
      }
      if (!parsed.pathname.startsWith('/matching/v5/mapbox/walking/')) {
        recordExternal(request, 'unexpected-mapbox-request');
        return json(route, { error: 'unexpected_mapbox_request', namespace: qaNamespace }, 501);
      }
      const encoded = parsed.pathname.split('/walking/')[1] ?? '';
      const input = decodeURIComponent(encoded).split(';').map(pair => {
        const [lng, lat] = pair.split(',').map(Number);
        return [lng, lat];
      }).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      matchingCalls += 1;
      recordExternal(request, 'fixture-map-matching');
      const amplitude = matchingCalls === 1 ? 0.000006 : 0.000009;
      const coordinates = input.map(([lng, lat], index) => (
        index === 0 || index === input.length - 1
          ? [lng, lat]
          : [lng + amplitude * Math.cos(index + matchingCalls), lat + amplitude * 0.7 * Math.sin(index + matchingCalls)]
      ));
      requests.push({
        at: new Date().toISOString(), step: qaStep, method: request.method(),
        pathname: parsed.pathname, action: 'fixture-map-matching', inputPoints: input.length,
      });
      return json(route, {
        code: 'Ok',
        matchings: [{ confidence: 0.98, geometry: { type: 'LineString', coordinates } }],
      });
    });

    await page.route('https://api.open-meteo.com/**', route => {
      recordExternal(route.request(), 'fixture-weather-wellington');
      const nowSeconds = Math.floor(Date.now() / 1000);
      return json(route, {
        timezone: 'Pacific/Auckland',
        current: { temperature_2m: 14, weathercode: 0 },
        daily: { sunrise: [nowSeconds - 21_600], sunset: [nowSeconds + 21_600] },
      });
    });

    await page.route('https://api.bigdatacloud.net/**', route => {
      recordExternal(route.request(), 'fixture-reverse-geocode-wellington');
      return json(route, {
        city: 'Wellington',
        locality: 'Wellington',
        principalSubdivision: 'Wellington Region',
        countryName: 'New Zealand',
        countryCode: 'NZ',
      });
    });

    await page.route('**/api/**', async route => {
      const request = route.request();
      const parsed = new URL(request.url());
      const pathname = parsed.pathname;
      const method = request.method();
      let body = null;
      try { body = request.postDataJSON(); } catch { /* no JSON body */ }
      requests.push({ at: new Date().toISOString(), step: qaStep, method, pathname, body });

      if (pathname === '/api/auth/me' && method === 'GET') return json(route, { user });
      if (pathname === '/api/sessions/unfinished' && method === 'GET') return json(route, { session: null });
      if (pathname === '/api/sessions/start' && method === 'POST') {
        startedClientActivityId = body?.client_activity_id ?? null;
        return json(route, { id: 9202, client_activity_id: startedClientActivityId });
      }
      if (pathname === '/api/sessions/9202/append-points' && method === 'PATCH') return json(route, { ok: true });
      if (pathname === '/api/sessions/9202/save' && method === 'PATCH') {
        savedActivity = body;
        return json(route, {
          ok: true,
          session_id: 9202,
          client_activity_id: body?.client_activity_id,
          finalized_at: new Date().toISOString(),
          memory: { accepted: body?.memory_points?.length ?? 0, rejected: 0 },
          idempotent_replay: false,
        });
      }
      if (pathname === '/api/sessions/9202' && method === 'GET') {
        return json(route, { session: {
          id: 9202,
          client_activity_id: startedClientActivityId,
          user_id: Number(user.id),
          type: 'hiking',
          start_time: savedActivity?.route_points?.[0]?.t
            ? new Date(savedActivity.route_points[0].t).toISOString() : new Date().toISOString(),
          end_time: savedActivity?.end_time ?? new Date().toISOString(),
          distance_m: savedActivity?.distance_m ?? 0,
          duration_s: savedActivity?.duration_s ?? 0,
          name: savedActivity?.name ?? 'F1 F2 connected normal entry',
          route_points: savedActivity?.route_points ?? [],
          route_points_raw: savedActivity?.route_points_raw ?? [],
          flags: [],
          created_at: new Date().toISOString(),
        } });
      }
      if (pathname === '/api/sessions' && method === 'GET') {
        return json(route, { sessions: savedActivity ? [{
          id: 9202,
          client_activity_id: startedClientActivityId,
          type: 'hiking',
          start_time: new Date(savedActivity.route_points?.[0]?.t ?? Date.now()).toISOString(),
          end_time: savedActivity.end_time,
          distance_m: savedActivity.distance_m,
          duration_s: savedActivity.duration_s,
          name: savedActivity.name,
          created_at: new Date().toISOString(),
        }] : [] });
      }
      if (pathname === '/api/markers' && method === 'POST') {
        markerCreateBody = body;
        remoteMarker = {
          id: 7301,
          user_id: Number(user.id),
          client_cairn_id: body?.client_cairn_id,
          origin_activity_client_id: body?.origin_activity_client_id,
          type: body?.type,
          text: body?.text,
          lat: body?.lat,
          lng: body?.lng,
          permission: body?.permission,
          approximate: Number(Boolean(body?.approximate)),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return json(route, remoteMarker, 201);
      }
      if (pathname === '/api/markers' && method === 'GET') return json(route, remoteMarker ? [remoteMarker] : []);
      if (pathname === '/api/routes' && method === 'GET') {
        const rows = [...remoteRoutes.values()].map(({ points: _points, waypoints: _waypoints, ...row }) => row);
        return json(route, { routes: rows });
      }
      if (pathname === '/api/routes' && method === 'POST') {
        routeCreateBody = body;
        const existing = [...remoteRoutes.values()].find(item => item.client_route_id === body?.client_route_id);
        const row = remoteRouteRow(body ?? {}, existing?.id ?? nextRemoteRouteId++, existing);
        remoteRoutes.set(String(row.id), row);
        return json(route, { route: row }, 201);
      }
      const routeMatch = pathname.match(/^\/api\/routes\/(\d+)$/);
      if (routeMatch && method === 'GET') {
        const row = remoteRoutes.get(routeMatch[1]);
        return row ? json(route, { route: row }) : json(route, { error: 'Route not found.' }, 404);
      }
      if (routeMatch && method === 'PUT') {
        const previous = remoteRoutes.get(routeMatch[1]);
        if (!previous) return json(route, { error: 'Route not found.' }, 404);
        routeUpdateBodies.push(body);
        const updated = remoteRouteRow(body ?? {}, previous.id, previous);
        remoteRoutes.set(routeMatch[1], updated);
        return json(route, { route: updated });
      }
      if (pathname === '/api/memory/points' && method === 'GET') {
        return json(route, { points: [], presence_witnesses: [], has_more: false });
      }
      if (pathname === '/api/memory/points' && method === 'POST') {
        return json(route, {
          points: (body?.points ?? []).map((point, batchIndex) => ({
            batch_index: batchIndex,
            cid: point.cid || `qa-memory-${batchIndex}`,
            ts: point.ts,
          })),
          presence_witnesses: (body?.presence_witnesses ?? []).map(witness => ({ cid: witness.cid })),
        });
      }
      if (pathname === '/api/circle/markers' && method === 'GET') return json(route, { markers: [] });
      if (pathname === '/api/markers/public' && method === 'GET') return json(route, { markers: [] });
      if ((pathname === '/api/hierarchy/deepest' || pathname === '/api/hierarchy/panel') && method === 'GET') {
        return json(route, { data: [], children: [] });
      }
      // Normal boot/background reads are explicit fixtures. Any new or
      // mistyped method/path is evidence, not a silent generic success.
      const backgroundFixture = expectedBackgroundApiFixture(method, pathname);
      if (backgroundFixture.matched) {
        return json(route, backgroundFixture.body);
      }
      const unexpected = {
        at: new Date().toISOString(),
        step: qaStep,
        method,
        pathname,
        query: parsed.search,
        body,
      };
      unexpectedApiRequests.push(unexpected);
      return json(route, {
        error: 'unexpected_api_request',
        namespace: qaNamespace,
        method,
        pathname,
      }, 501);
    });

    const settle = (ms = 500) => page.waitForTimeout(ms);
    const waitForRoute = (name, timeout = 30_000) => page.waitForFunction(
      expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
      name,
      { timeout },
    );
    const capture = async name => {
      qaStep = `capture:${name}`;
      const target = path.join(outputDir, `${String(captures.length + 1).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: target, fullPage: false });
      captures.push({
        name,
        file: path.basename(target),
        route: await page.evaluate(() => globalThis.__cairnStores?.getCurrentRoute?.() ?? null),
      });
    };
    const recordFlow = (step, handler) => flow.push({ at: new Date().toISOString(), step, handler });
    const anyExactTextVisible = async text => {
      const candidates = page.getByText(text, { exact: true });
      for (let index = 0; index < await candidates.count(); index += 1) {
        if (await candidates.nth(index).isVisible().catch(() => false)) return true;
      }
      return false;
    };
    const snapshot = async label => {
      qaStep = `snapshot:${label}`;
      const fogPresentation = await page.evaluate(readMountedMemoryFogPresentation);
      const plannedRoutePresentation = await page.evaluate(readMountedPlannedRoutePresentation);
      const state = await page.evaluate(({ stage, fogPresentation: scopedFogPresentation, plannedRoutePresentation: scopedPlannedRoutePresentation }) => {
        const stores = globalThis.__cairnStores;
        const tracking = stores.useTrackingStore.getState();
        const simulator = stores.useActivitySimulatorStore.getState();
        const memory = stores.useMemoryStore.getState();
        const sessions = stores.useSessionStore.getState();
        const markers = stores.useMarkerStore.getState();
        const routes = stores.useRouteStore.getState();
        const navigationRoute = stores.navigationRef?.getCurrentRoute?.() ?? null;
        const selectedRouteId = navigationRoute?.params?.routeId == null
          ? null
          : String(navigationRoute.params.routeId);
        const route = selectedRouteId
          ? routes.routes.find(item => [item.id, item.clientRouteId, item.remoteId]
            .filter(value => value != null)
            .map(String)
            .includes(selectedRouteId)) ?? null
          : routes.routes[0] ?? null;
        return {
          stage,
          observedAt: Date.now(),
          currentRoute: stores.getCurrentRoute?.() ?? null,
          navigation: {
            name: navigationRoute?.name ?? null,
            routeId: selectedRouteId,
          },
          tracking: {
            status: tracking.status,
            transitionState: tracking.transitionState,
            sessionId: tracking.sessionId,
            remoteId: tracking.remoteId,
            provider: tracking.locationProviderSource,
            rawCount: tracking.trackPointsRaw.length,
            acceptedCount: tracking.trackPoints.length,
            distanceM: tracking.distanceM,
            lastCoordinate: tracking.lastCoordinate,
            lastCoordinateTime: tracking.lastCoordinateTime,
          },
          simulator: {
            seed: simulator.deterministicSeed,
            observationMode: simulator.observationMode,
            timeScale: simulator.timeScale,
            rawTrailCount: simulator.rawGpsTrail.length,
            truthTrailCount: simulator.groundTruthTrail.length,
            rawTrail: simulator.rawGpsTrail.map(point => ({
              lat: point.lat, lng: point.lng, accuracyM: point.accuracyM,
              timestamp: point.timestamp ?? point.t ?? point.ts,
            })),
            truthTrail: simulator.groundTruthTrail.map(point => ({ lat: point.lat, lng: point.lng })),
          },
          memory: {
            personalCount: memory.points.length,
            presenceCount: memory.presenceWitnesses.length,
            syntheticCount: memory.testPoints.length,
            synthetic: memory.testPoints.map(point => ({ lat: point.lat, lng: point.lng, cid: point.cid, ts: point.ts })),
          },
          fogPresentation: scopedFogPresentation,
          plannedRoutePresentation: scopedPlannedRoutePresentation,
          sessions: sessions.sessions.map(item => ({
            id: item.id,
            clientActivityId: item.clientActivityId,
            remoteId: item.remoteId,
            markerIds: item.markerIds,
            trackPointCount: item.trackPoints?.length ?? 0,
          })),
          markers: markers.markers.map(item => ({
            id: item.id,
            clientCairnId: item.clientCairnId,
            serverCairnId: item.serverCairnId,
            originActivityClientId: item.originActivityClientId,
            permission: item.permission,
            note: item.note,
            lat: item.lat,
            lng: item.lng,
            syncState: item.syncState,
          })),
          route: route ? {
            id: route.id,
            clientRouteId: route.clientRouteId,
            remoteId: route.remoteId,
            name: route.name,
            creationOrigin: route.creationOrigin,
            originActivityClientId: route.originActivityClientId,
            originActivityServerId: route.originActivityServerId,
            originGeometryHash: route.originGeometryHash,
            createdGeometryHash: route.createdGeometryHash,
            geometryEditedSinceCreation: route.geometryEditedSinceCreation,
            originPersistence: route.originPersistence,
            syncState: route.syncState,
            points: route.points,
          } : null,
          activityRouteReference: routes.activityRouteReference,
        };
      }, { stage: label, fogPresentation, plannedRoutePresentation });
      if (state.fogPresentation?.geometry) {
        state.fogPresentation.geometryHash = sha(state.fogPresentation.geometry);
        delete state.fogPresentation.geometry;
      } else {
        state.fogPresentation.geometryHash = null;
      }
      state.plannedRoutePresentation.geometryHash = sha(
        state.plannedRoutePresentation.coordinates ?? [],
      );
      stages.push(state);
      return state;
    };
    const clickVisibleBack = async () => {
      const candidates = page.getByText('Back', { exact: true });
      for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
        if (!await candidates.nth(index).isVisible()) continue;
        await candidates.nth(index).click();
        return;
      }
      throw new Error('visible_back_control_not_found');
    };
    const waitForLoadedMemory = async () => {
      const mapUnavailable = page.getByText('Map unavailable', { exact: true });
      if (await mapUnavailable.isVisible().catch(() => false)) {
        throw new Error(
          'memory_map_renderer_unavailable: start Expo with an isolated pk-format '
          + 'EXPO_PUBLIC_MAPBOX_TOKEN so the fully intercepted web adapter is enabled',
        );
      }
      await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 30_000 });
      await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.getLayer?.('memory-fog')), null, { timeout: 30_000 });
      await page.waitForFunction(() => {
        const source = globalThis.__cairnMap?.getSource?.('memory-fog-src');
        const serialized = source?.serialize?.();
        let data = serialized?.data ?? source?._data ?? null;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch { return false; }
        }
        const feature = data?.type === 'FeatureCollection' ? data.features?.[0] : data;
        const geometry = feature?.geometry;
        const polygons = geometry?.type === 'Polygon'
          ? [geometry.coordinates]
          : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
        const innerRings = polygons.reduce(
          (total, polygon) => total + Math.max(0, (polygon?.length ?? 0) - 1),
          0,
        );
        return Number(feature?.properties?.cairnEvidencePointCount ?? 0) > 0
          && String(feature?.properties?.cairnContentSignature ?? '').includes('|qa-raw-gps-isolated|')
          && innerRings > 0;
      }, null, { timeout: 30_000 });
      await page.getByText('Opening your map', { exact: true }).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    };
    const applyReadyRouteDraft = async flowStep => {
      const label = page.getByText('Apply to draft', { exact: true });
      await label.waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForFunction(() => {
        const labels = [...document.querySelectorAll('*')]
          .filter(element => element.children.length === 0 && element.textContent?.trim() === 'Apply to draft');
        return labels.some(element => {
          const control = element.closest('[role="button"],button,[aria-disabled]');
          return Boolean(control)
            && control.getAttribute('aria-disabled') !== 'true'
            && !control.hasAttribute('disabled');
        });
      }, null, { timeout: 30_000 });
      await label.click({ timeout: 30_000 });
      await label.waitFor({ state: 'hidden', timeout: 30_000 });
      recordFlow(flowStep, 'enabled RouteEditor Apply to draft UI control');
    };
    const configureWaypoint = coordinate => page.evaluate(next => {
      globalThis.__cairnStores.useActivitySimulatorStore.getState().replaceWaypoints([
        { id: `r-gps-02-${Date.now()}`, ...next },
      ]);
    }, coordinate);
    const tickSeconds = seconds => page.evaluate(async count => {
      globalThis.__f1f2TickCursor ??= Date.now();
      const engine = globalThis.__cairnStores.activitySimulatorEngine;
      for (let index = 0; index < count; index += 1) {
        globalThis.__f1f2TickCursor += 1_000;
        await engine.tick(globalThis.__f1f2TickCursor, false);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }, seconds);
    const walkTo = async (coordinate, label) => {
      await configureWaypoint(coordinate);
      await page.evaluate(async () => {
        const stores = globalThis.__cairnStores;
        const engine = stores.activitySimulatorEngine;
        globalThis.__f1f2TickCursor ??= Date.now();
        for (let index = 0; index < 120; index += 1) {
          globalThis.__f1f2TickCursor += 1_000;
          await engine.tick(globalThis.__f1f2TickCursor, false);
          await new Promise(resolve => setTimeout(resolve, 0));
          if (stores.useActivitySimulatorStore.getState().waypoints.length === 0) return;
        }
        throw new Error('waypoint_timeout');
      });
      recordFlow(`raw-gps-${label}`, 'activitySimulatorEngine.tick through production observation pipeline');
    };

    qaStep = 'boot';
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => {
      const stores = globalThis.__cairnStores;
      return Boolean(stores?.useAppStore && stores?.useTrackingStore && stores?.useMemoryStore
        && stores?.useSessionStore && stores?.useMarkerStore && stores?.useRouteStore
        && stores?.useActivitySimulatorStore && stores?.activitySimulatorEngine);
    }, null, { timeout: 120_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
    await page.evaluate(({ fixtureUser, namespace }) => {
      localStorage.setItem('cairn_jwt', `f1-f2-connected-loaded-qa-token:${namespace}`);
      localStorage.setItem('cairn_onboarding_v1_done', 'true');
      localStorage.setItem(`cairn_onboarding_v1_done_${fixtureUser.id}`, 'true');
      const stores = globalThis.__cairnStores;
      stores.useAppStore.setState({
        user: fixtureUser, isLoggedIn: true, hydrated: true, sessionExpired: false,
      });
      stores.useSessionStore.setState({ currentUserId: fixtureUser.id, sessions: [] });
      stores.useMarkerStore.setState({ userId: fixtureUser.id, markers: [], circleMarkers: [], publicMarkers: [] });
      stores.useRouteStore.setState({
        routeOwnerId: fixtureUser.id,
        routes: [], routesLoading: false, routesLoadError: false,
        routeDetailState: {}, activityRouteReference: null, followingRouteId: null,
      });
      stores.useSettingsStore.getState().saveAll({
        appearance: 'day', debugMode: false, telemetryUploadEnabled: false, mapLayer: 'outdoors',
      });
      stores.useWeatherStore.getState().setConditionOverride('sunny');
      stores.useWeatherStore.getState().setDayNightOverride('day');
    }, { fixtureUser: user, namespace: qaNamespace });
    await waitForRoute('Home');
    await settle(700);

    qaStep = 'home-to-hike';
    await page.getByText('Hiking', { exact: true }).click();
    await waitForRoute('Hiking');
    await page.getByTestId('activity-hike-start-dock').waitFor({ state: 'visible', timeout: 30_000 });
    recordFlow('home-to-hike-prestart', 'Home Hiking control');

    // Enabling Debug/Simulator intentionally triggers Hiking's asynchronous
    // fresh-entry reset. Let that lifecycle finish before applying the R-GPS
    // scenario, matching the authoritative loaded Raw GPS runner.
    qaStep = 'simulator-enable-fresh-entry';
    await page.evaluate(({ fixtureUser }) => {
      const stores = globalThis.__cairnStores;
      stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
      stores.useActivitySimulatorStore.setState({ hydratedUserId: fixtureUser.id });
      const simulator = stores.useActivitySimulatorStore.getState();
      simulator.setEnabled(true);
    }, { fixtureUser: user });
    await settle(1_500);

    // Scenario configuration is QA input only. Start remains the ordinary
    // product Start button and all observations pass through the shared sink.
    qaStep = 'simulator-configure-r-gps-02';
    await page.evaluate(fixture => {
      const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
      simulator.setObservationMode('raw-gps');
      simulator.setDeterministicSeed(fixture.seed);
      simulator.setTimeScale(1);
      simulator.setCustomSpeed(fixture.speedKmh);
      simulator.setAccuracyPreset('normal');
      simulator.setSignal('normal');
      simulator.setOrigin(fixture.origin);
      simulator.setDiagnosticsVisible(true);
    }, rawGpsFixture);
    await settle(1_400);
    await page.waitForFunction(fixtureSeed => {
      const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
      return simulator.enabled && simulator.startConfigured
        && simulator.observationMode === 'raw-gps' && simulator.deterministicSeed === fixtureSeed;
    }, rawGpsFixture.seed, { timeout: 20_000 });
    await capture('hike-prestart-r-gps-02');

    qaStep = 'normal-start';
    await page.getByRole('button', { name: 'Start hike' }).click();
    await page.waitForFunction(() => {
      const state = globalThis.__cairnStores.useTrackingStore.getState();
      return state.status === 'tracking' && state.locationProviderSource === 'simulator' && Boolean(state.sessionId);
    }, null, { timeout: 30_000 });
    recordFlow('normal-start', 'Hike Start button');
    await page.evaluate(async () => {
      await globalThis.__cairnStores.activitySimulatorEngine.stopRuntime();
      globalThis.__f1f2TickCursor = Date.now();
    });
    const afterStart = await snapshot('after-normal-start');
    identities.activityClientId = afterStart.tracking.sessionId;
    await tickSeconds(1);

    const fixtureCoordinates = rawGpsFixture.localVerticesM.map(toCoordinate);
    for (let index = 1; index <= 2; index += 1) {
      await walkTo(fixtureCoordinates[index], `leg-${index}`);
    }
    await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().stopAutopilot());
    await tickSeconds(rawGpsFixture.physicalPauseSeconds);
    recordFlow('physical-pause', `${rawGpsFixture.physicalPauseSeconds} stationary one-second truth ticks`);
    for (let index = 3; index < fixtureCoordinates.length; index += 1) {
      await walkTo(fixtureCoordinates[index], `leg-${index}`);
    }
    const afterRawGps = await snapshot('r-gps-02-complete-prefinish');
    await capture('hike-r-gps-02-complete');

    qaStep = 'normal-pause';
    await page.getByRole('button', { name: 'Pause hike' }).click();
    await page.waitForFunction(() => {
      const state = globalThis.__cairnStores.useTrackingStore.getState();
      return state.status === 'paused' && state.transitionState === 'idle';
    }, null, { timeout: 20_000 });
    recordFlow('pause', 'Hike Pause control');
    await capture('hike-paused');

    qaStep = 'normal-resume';
    await page.getByRole('button', { name: 'Resume hike' }).click();
    await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking', null, { timeout: 20_000 });
    await page.evaluate(async () => globalThis.__cairnStores.activitySimulatorEngine.stopRuntime());
    recordFlow('resume', 'Hike Resume control');

    qaStep = 'normal-plant-entry';
    await page.getByRole('button', { name: 'Plant a Cairn' }).click();
    await waitForRoute('Plant');
    recordFlow('hike-to-plant', 'live Hike Plant a Cairn control');
    await page.getByRole('textbox', { name: 'Title' }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('textbox', { name: 'Title' }).fill('Turn and return');
    await page.getByRole('textbox', { name: 'Note' }).fill('Private Cairn planted from the connected R-GPS-02 Activity.');
    const onlyMe = page.getByRole('button', { name: 'Visibility Only me' });
    await onlyMe.click();
    await capture('plant-text-private');
    qaStep = 'normal-plant-commit';
    await page.getByRole('button', { name: 'Plant Cairn' }).click();
    await waitForRoute('Hiking');
    await page.getByTestId('activity-hike-control-dock').waitFor({ state: 'visible', timeout: 30_000 });
    recordFlow('plant-return-same-recording', 'Plant commit handler goBack');
    await page.waitForFunction(activityId => {
      const stores = globalThis.__cairnStores;
      const marker = stores.useMarkerStore.getState().markers[0];
      return marker?.originActivityClientId === activityId;
    }, identities.activityClientId, { timeout: 30_000 });
    const afterPlant = await snapshot('after-plant-returned-to-recording');
    identities.cairnClientId = afterPlant.markers[0]?.clientCairnId;
    await capture('hike-after-private-cairn');

    // Observe live Memory before Finish through ordinary Back/Home/Memory and
    // return to the same active Hike. This preserves the F1 authority boundary.
    qaStep = 'prefinish-memory';
    await page.getByRole('button', { name: 'Back from Hike' }).click();
    await waitForRoute('Home');
    await page.getByText('Memory', { exact: true }).click();
    await waitForRoute('Memory');
    const firstVisit = page.getByRole('button', { name: 'Got it' });
    if (await firstVisit.isVisible().catch(() => false)) await firstVisit.click();
    await waitForLoadedMemory();
    const beforeFinishMemory = await snapshot('live-memory-before-finish');
    await capture('live-memory-before-finish');
    recordFlow('live-memory-before-finish', 'Home Memory tab while Activity remains active');
    await clickVisibleBack();
    await waitForRoute('Home');
    await page.getByText('Hiking', { exact: true }).click();
    await waitForRoute('Hiking');
    await page.getByTestId('activity-hike-control-dock').waitFor({ state: 'visible', timeout: 30_000 });
    const immediatelyBeforeFinish = await snapshot('same-recording-immediately-before-finish');

    qaStep = 'normal-finish-intent';
    await page.getByRole('button', { name: 'Finish hike' }).click();
    await page.getByText('Finish hike', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await capture('finish-handler-confirmation');
    const activityName = page.getByText('Name this hike (optional)', { exact: true }).locator('..').getByRole('textbox');
    await activityName.fill('F1 F2 connected normal entry');
    qaStep = 'normal-finish-commit';
    await page.getByRole('button', { name: 'Finish hike and view activity' }).click();
    await waitForRoute('MapHistory', 40_000);
    await page.getByTestId('activity-save-as-route').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'idle', null, { timeout: 30_000 });
    const activityDetail = await snapshot('same-activity-detail-after-finish');
    await page.getByTestId(`activity-linked-cairn-${identities.cairnClientId}`).waitFor({ state: 'visible', timeout: 30_000 });
    await capture('activity-detail-linked-cairn');
    recordFlow('finish-to-same-activity-detail', 'Finish & view activity handler');

    qaStep = 'save-as-route';
    await page.getByTestId('activity-save-as-route').click();
    await waitForRoute('RouteEditor');
    await page.getByText('Beautify', { exact: true }).click();
    await applyReadyRouteDraft('activity-route-edit-ready-and-applied');
    await page.getByPlaceholder('Route name (required)').fill('Wellington turn and return');
    await capture('route-create-real-geometry-edit');
    await page.getByText('Save Route', { exact: true }).click();
    await waitForRoute('MapHistory', 40_000);
    await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useRouteStore.getState().routes[0]?.syncState === 'synced', null, { timeout: 30_000 });
    const routeCreated = await snapshot('activity-route-created');
    identities.routeClientId = routeCreated.route?.clientRouteId;
    identities.routeRemoteId = routeCreated.route?.remoteId;
    identities.routeCreatedGeometryHash = sha(routeCreated.route?.points ?? []);
    identities.routeSnapshotBeforeReloadHash = sha(routeCreated.route);
    await capture('route-detail-created');
    recordFlow('activity-save-as-route-edited', 'Activity Save as Route > Beautify > Apply > Save Route');

    qaStep = 'cold-reload-route-persistence';
    identities.realmSentinelBeforeReload = `${qaNamespace}:${crypto.randomUUID()}`;
    await page.evaluate(value => { globalThis.__f1f2RealmSentinel = value; }, identities.realmSentinelBeforeReload);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => {
      const stores = globalThis.__cairnStores;
      return Boolean(stores?.useAppStore && stores?.useRouteStore && stores?.getCurrentRoute);
    }, null, { timeout: 120_000 });
    await page.waitForFunction(() => {
      const app = globalThis.__cairnStores.useAppStore.getState();
      return app.hydrated === true && app.isLoggedIn === true;
    }, null, { timeout: 120_000 });
    await waitForRoute('Home', 120_000);
    identities.realmSentinelAfterReload = await page.evaluate(() => globalThis.__f1f2RealmSentinel ?? null);
    const afterColdReloadHome = await snapshot('after-cold-reload-home');
    await capture('after-cold-reload-home');
    recordFlow('cold-reload-created-route', 'page.reload to a new JS realm before Trails reopen');

    qaStep = 'home-trails-reopen';
    await page.getByText('Trails', { exact: true }).click();
    await waitForRoute('Routes');
    await page.getByText('Routes', { exact: true }).last().click();
    await page.getByTestId(`route-record-${identities.routeClientId}`).waitFor({ state: 'visible', timeout: 30_000 });
    await capture('trails-same-route');
    await page.getByTestId(`route-record-${identities.routeClientId}`).click();
    await waitForRoute('MapHistory');
    await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
    const routeReopened = await snapshot('route-reopened-from-trails');
    identities.routeSnapshotAfterReloadHash = sha(routeReopened.route);
    recordFlow('home-trails-reopen-route', 'cold Home > Trails > Routes > stable route row');

    qaStep = 'existing-route-edit';
    await page.getByLabel('Edit route').click();
    await waitForRoute('RouteEditor');
    await page.getByText('Edit', { exact: true }).last().click();
    await page.getByText('Beautify', { exact: true }).click();
    await applyReadyRouteDraft('reopened-route-edit-ready-and-applied');
    await page.getByPlaceholder('Route name (required)').fill('Wellington turn and return — edited');
    await capture('route-existing-real-geometry-edit');
    await page.getByText('Save Route', { exact: true }).click();
    await waitForRoute('MapHistory', 40_000);
    await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
    const routeEdited = await snapshot('route-edited-and-saved');
    identities.routeEditedGeometryHash = sha(routeEdited.route?.points ?? []);
    await capture('route-detail-edited');
    recordFlow('reopened-route-edit-save', 'Route Detail Edit > Beautify > Apply > Save Route');

    qaStep = 'use-route-hike';
    await page.getByTestId('route-use-action').click();
    await page.getByTestId('route-use-hike').click();
    await waitForRoute('Hiking');
    await page.getByText('This Route is shown on the map for reference.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByText('Map unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    const hikePrestart = await snapshot('use-route-hike-prestart-idle');
    const hikeMapUnavailableVisible = await anyExactTextVisible('Map unavailable');
    const hikePlannedRouteSourceLoaded = Boolean(
      hikePrestart.plannedRoutePresentation?.sourcePresent
      && hikePrestart.plannedRoutePresentation?.layerPresent
      && hikePrestart.plannedRoutePresentation?.geometryType === 'LineString',
    );
    hikePrestart.prestartRouteSelection = {
      routeName: routeEdited.route?.name ?? null,
      routeNameVisible: await anyExactTextVisible(routeEdited.route?.name ?? ''),
      referenceDescriptionVisible: await anyExactTextVisible('This Route is shown on the map for reference.'),
      mapCapability: hikeMapUnavailableVisible && !hikePlannedRouteSourceLoaded
        ? 'web_fallback'
        : hikePlannedRouteSourceLoaded ? 'native_mapbox' : 'unknown',
      mapUnavailableVisible: hikeMapUnavailableVisible,
      plannedRouteSourceLoaded: hikePlannedRouteSourceLoaded,
      nativeMountedMapboxSource: hikeMapUnavailableVisible ? 'NOT_RUN' : 'UNKNOWN',
    };
    await capture('use-route-hike-prestart-idle');
    recordFlow('use-route-hike-idle', 'Route Detail Use Route > Hike');

    await clickVisibleBack();
    await waitForRoute('MapHistory');
    qaStep = 'use-route-run';
    await page.getByTestId('route-use-action').click();
    await page.getByTestId('route-use-run').click();
    await waitForRoute('Running');
    await page.getByText('This Route is shown on the map for reference.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByText('Map unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    const runPrestart = await snapshot('use-route-run-prestart-idle');
    const runMapUnavailableVisible = await anyExactTextVisible('Map unavailable');
    const runPlannedRouteSourceLoaded = Boolean(
      runPrestart.plannedRoutePresentation?.sourcePresent
      && runPrestart.plannedRoutePresentation?.layerPresent
      && runPrestart.plannedRoutePresentation?.geometryType === 'LineString',
    );
    runPrestart.prestartRouteSelection = {
      routeName: routeEdited.route?.name ?? null,
      routeNameVisible: await anyExactTextVisible(routeEdited.route?.name ?? ''),
      referenceDescriptionVisible: await anyExactTextVisible('This Route is shown on the map for reference.'),
      mapCapability: runMapUnavailableVisible && !runPlannedRouteSourceLoaded
        ? 'web_fallback'
        : runPlannedRouteSourceLoaded ? 'native_mapbox' : 'unknown',
      mapUnavailableVisible: runMapUnavailableVisible,
      plannedRouteSourceLoaded: runPlannedRouteSourceLoaded,
      nativeMountedMapboxSource: runMapUnavailableVisible ? 'NOT_RUN' : 'UNKNOWN',
    };
    await capture('use-route-run-prestart-idle');
    recordFlow('use-route-run-idle', 'Route Detail Use Route > Run');

    const rawTimestamps = afterRawGps.simulator.rawTrail.map(point => Number(point.timestamp)).filter(Number.isFinite);
    const cadence = rawTimestamps.slice(1).map((value, index) => value - rawTimestamps[index]);
    const accuracies = afterRawGps.simulator.rawTrail.map(point => Number(point.accuracyM)).filter(Number.isFinite);
    const geometryAtActivity = activityDetail.sessions[0]?.trackPointCount ?? 0;
    Object.assign(assertions, {
      normalHomeHikeStart: Boolean(identities.activityClientId),
      activityIdentityStartAcknowledged: startedClientActivityId === identities.activityClientId,
      activityIdentityFinishCommitted: savedActivity?.client_activity_id === identities.activityClientId,
      realisticRawExceedsAccepted: afterRawGps.tracking.rawCount > afterRawGps.tracking.acceptedCount
        && afterRawGps.tracking.acceptedCount >= 10,
      variableRawCadence: new Set(cadence).size >= 3 && Math.max(...cadence) > Math.min(...cadence),
      variableHorizontalAccuracy: new Set(accuracies.map(value => value.toFixed(2))).size >= 3
        && Math.max(...accuracies) - Math.min(...accuracies) >= 2,
      nonIdealScenarioAuthority: scenarioSensitivity(rawGpsFixture.localVerticesM).hasBacktrack,
      pauseResumeReturnedTracking: afterPlant.tracking.status === 'tracking',
      cairnClientIdentityStable: Boolean(identities.cairnClientId)
        && markerCreateBody?.client_cairn_id === identities.cairnClientId,
      cairnOriginActivityStable: afterPlant.markers[0]?.originActivityClientId === identities.activityClientId
        && markerCreateBody?.origin_activity_client_id === identities.activityClientId,
      cairnTextPrivate: afterPlant.markers[0]?.permission === 'personal'
        && afterPlant.markers[0]?.note?.includes('Private Cairn'),
      plantReturnedSameRecording: afterPlant.tracking.sessionId === identities.activityClientId,
      liveMemoryBeforeFinish: beforeFinishMemory.memory.syntheticCount > 0
        && beforeFinishMemory.tracking.sessionId === identities.activityClientId
        && beforeFinishMemory.fogPresentation.mapLoaded === true
        && beforeFinishMemory.fogPresentation.sourcePresent === true
        && beforeFinishMemory.fogPresentation.innerRingCount > 0
        && beforeFinishMemory.fogPresentation.evidencePointCount === beforeFinishMemory.memory.syntheticCount
        && beforeFinishMemory.fogPresentation.contentSignature.includes(`${user.id}|qa-raw-gps-isolated|`)
        && Boolean(beforeFinishMemory.fogPresentation.geometryHash),
      directionsFixtureScopedToFinalGeometry: directionsCalls === 1
        && directionsCallSteps.every(step => step === 'normal-finish-commit')
        && beforeFinishMemory.fogPresentation.contentSignature.includes(`${user.id}|qa-raw-gps-isolated|`),
      finishPreservedActivityIdentity: activityDetail.sessions.some(item => item.clientActivityId === identities.activityClientId)
        && geometryAtActivity >= 2,
      linkedCairnVisibleOnSameActivity: Boolean(identities.cairnClientId),
      routeStableAcrossCreateAndReopen: routeCreated.route?.id === routeReopened.route?.id
        && routeCreated.route?.clientRouteId === routeReopened.route?.clientRouteId,
      coldReloadCreatedNewRealm: identities.realmSentinelAfterReload === null
        && afterColdReloadHome.currentRoute === 'Home'
        && afterColdReloadHome.tracking.status === 'idle',
      routeStableAcrossColdReload: identities.routeClientId === routeReopened.route?.clientRouteId
        && identities.routeRemoteId === routeReopened.route?.remoteId,
      routeOriginActivityStable: routeEdited.route?.originActivityClientId === identities.activityClientId
        && routeCreateBody?.source_activity_client_id === identities.activityClientId,
      createGeometryActuallyEdited: matchingCalls >= 1
        && identities.routeCreatedGeometryHash !== sha(savedActivity?.route_points ?? []),
      reopenedGeometryActuallyEdited: matchingCalls >= 2
        && identities.routeEditedGeometryHash !== identities.routeCreatedGeometryHash
        && routeEdited.route?.geometryEditedSinceCreation === true,
      routeIdentityStableAfterEdit: routeEdited.route?.id === identities.routeClientId
        && routeEdited.route?.remoteId === identities.routeRemoteId,
      routeUpdateAcknowledged: routeUpdateBodies.some(body => Array.isArray(body?.points)),
      hikeSelectedEditedRoutePrestart: matchesPrestartRouteSelection(hikePrestart, {
        screen: 'Hiking',
        routeId: identities.routeClientId,
        routeName: routeEdited.route?.name,
        geometryHash: routePointsGeometryHash(routeEdited.route?.points),
        mapCapability: 'web_fallback',
      }),
      hikeIdleWithReferenceDeferredUntilStart: matchesIdlePrestartBoundary(hikePrestart),
      runSelectedEditedRoutePrestart: matchesPrestartRouteSelection(runPrestart, {
        screen: 'Running',
        routeId: identities.routeClientId,
        routeName: routeEdited.route?.name,
        geometryHash: routePointsGeometryHash(routeEdited.route?.points),
        mapCapability: 'web_fallback',
      }),
      runIdleWithReferenceDeferredUntilStart: matchesIdlePrestartBoundary(runPrestart),
      noPersonalMemoryContamination: stages.every(stage => stage.memory.personalCount === 0 && stage.memory.presenceCount === 0),
      sameRecordingImmediatelyBeforeFinish: immediatelyBeforeFinish.tracking.sessionId === identities.activityClientId,
      noUnexpectedApiRequests: unexpectedApiRequests.length === 0,
      runtimeClean: runtimeErrors.length === 0 && unexpectedExternalRequests.length === 0
        && unexpectedApiRequests.length === 0 && failedRequests.length === 0 && httpErrors.length === 0,
    });
  } catch (error) {
    terminalError = {
      step: qaStep,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    };
    assertions.loadedJourneyCompleted = false;
  } finally {
    if (context && !traceStopped) {
      try {
        await context.tracing.stop({ path: path.join(outputDir, 'trace.zip') });
        traceStopped = true;
      } catch (error) {
        consoleNotes.push(`Trace stop failed: ${String(error)}`);
      }
    }
    if (context) await context.close().catch(() => {});
    else if (browser) await browser.close().catch(() => {});
  }

  if (!terminalError) assertions.loadedJourneyCompleted = true;
  assertions.noUnexpectedApiRequests = unexpectedApiRequests.length === 0;
  assertions.runtimeClean = runtimeErrors.length === 0 && unexpectedExternalRequests.length === 0
    && unexpectedApiRequests.length === 0 && failedRequests.length === 0 && httpErrors.length === 0;
  const failed = Object.entries(assertions).filter(([, value]) => value !== true).map(([name]) => name);
  const manifest = {
    schema: 'cairnnz.f1-f2.connected-normal-entry.loaded-web.v1',
    generatedAt,
    candidateFingerprint: sourceFingerprint,
    verdict: failed.length === 0 && runtimeErrors.length === 0 ? 'PASS' : 'FAIL',
    evidenceBoundary: {
      renderer: 'Loaded Expo Web at mobile viewport',
      fixtureApis: true,
      fixtureMapMatching: true,
      realApiOrMysql: false,
      nativeOrPhysicalDevice: false,
      nativeGpsOrFieldEvidence: false,
      actualHandlersAndNavigation: true,
      activityMapCapability: 'web_fallback',
      nativeMountedPlannedRouteSource: 'NOT_RUN',
      note: 'Matching and walking-Directions responses are deterministic synthetic Final/Route geometry; Memory remains derived from accepted R-GPS evidence. The real RouteEditor Beautify/Apply/Save handlers consume the matching fixture. Expo Web proves the exact Map unavailable fallback plus selected Route UI/store identity and edited geometry; native mounted planned-route-source evidence is NOT_RUN.',
    },
    environment: {
      baseUrl,
      viewport,
      locale: 'en-NZ',
      timezone: 'Pacific/Auckland',
      qaNamespace,
      fixtureUserId: user.id,
      fixtureUserEmail: user.email,
      browserProfileDir,
    },
    source: rawGpsFixture,
    flow,
    stages,
    identities,
    api: {
      requestCount: requests.length,
      startedClientActivityId,
      savedActivityClientId: savedActivity?.client_activity_id ?? null,
      markerCreateClientId: markerCreateBody?.client_cairn_id ?? null,
      markerOriginActivityClientId: markerCreateBody?.origin_activity_client_id ?? null,
      routeCreateClientId: routeCreateBody?.client_route_id ?? null,
      routeSourceActivityClientId: routeCreateBody?.source_activity_client_id ?? null,
      routeUpdateCount: routeUpdateBodies.length,
      fixtureMatchingCalls: matchingCalls,
      fixtureDirectionsCalls: directionsCalls,
      fixtureDirectionsCallSteps: directionsCallSteps,
    },
    assertions,
    failed,
    terminalError,
    runtimeErrors: [...new Set(runtimeErrors)],
    networkDiagnostics: {
      externalRequests,
      unexpectedExternalRequests,
      unexpectedApiRequests,
      failedRequests,
      httpErrors,
    },
    consoleNotes: [...new Set(consoleNotes)],
    captures,
    artifacts: {
      trace: traceStopped ? 'trace.zip' : null,
      requests: 'requests.json',
      networkDiagnostics: 'network-diagnostics.json',
      runtimeErrors: 'runtime-errors.txt',
    },
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'requests.json'), `${JSON.stringify(requests, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'network-diagnostics.json'), `${JSON.stringify({
    namespace: qaNamespace,
    externalRequests,
    unexpectedExternalRequests,
    unexpectedApiRequests,
    failedRequests,
    httpErrors,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), runtimeErrors.length
    ? `${[...new Set(runtimeErrors)].join('\n')}\n` : 'none\n');

  if (captures.length > 0) {
    const selected = captures.slice(0, 12);
    const tileWidth = 195;
    const tileHeight = 422;
    const labelHeight = 32;
    const columns = 4;
    const gap = 10;
    const rows = Math.ceil(selected.length / columns);
    const composites = [];
    for (const [index, item] of selected.entries()) {
      const left = gap + (index % columns) * (tileWidth + gap);
      const top = gap + Math.floor(index / columns) * (tileHeight + labelHeight + gap);
      composites.push({
        input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileWidth / 2}" y="20" text-anchor="middle" font-family="Arial" font-size="9" fill="#F5F3EC">${item.name.slice(0, 34)}</text></svg>`),
        left,
        top,
      });
      composites.push({
        input: await sharp(path.join(outputDir, item.file)).resize({ width: tileWidth, height: tileHeight, fit: 'contain', background: '#151A19' }).png().toBuffer(),
        left,
        top: top + labelHeight,
      });
    }
    await sharp({
      create: {
        width: gap + columns * (tileWidth + gap),
        height: gap + rows * (tileHeight + labelHeight + gap),
        channels: 3,
        background: '#151A19',
      },
    }).composite(composites).jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
      .toFile(path.join(outputDir, 'ordered-connected-journey.jpg'));
  }

  process.stdout.write(`${JSON.stringify({
    outputDir,
    fingerprint: sourceFingerprint,
    verdict: manifest.verdict,
    failed,
    terminalError,
    runtimeErrors: manifest.runtimeErrors,
    captures: captures.length,
    trace: traceStopped,
  }, null, 2)}\n`);
  if (manifest.verdict !== 'PASS') process.exitCode = 1;
}
