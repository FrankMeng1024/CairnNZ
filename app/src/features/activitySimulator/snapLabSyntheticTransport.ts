import {
  sanitizeSnapLabRequestUrl,
  snapLabRequestFingerprint,
  type SnapLabTransportReceipt,
} from './snapLabTransport';

export interface SnapLabSyntheticMapPath {
  id: string;
  name: string;
  kind: string;
  coordinates: Array<{ lat: number; lng: number }>;
}

export interface SnapLabSyntheticBarrier {
  id: string;
  kind: string;
  from: Coordinate;
  to: Coordinate;
}

export interface SnapLabSyntheticMap {
  paths: SnapLabSyntheticMapPath[];
  barriers?: SnapLabSyntheticBarrier[];
}

export interface SnapLabSyntheticTransportOptions {
  caseId: string;
  profileId: string;
  scenario: string;
  map: SnapLabSyntheticMap;
  failureMode?: 'none' | 'timeout' | 'nomatch' | 'auth-then-unavailable';
  forceLowMatchingConfidence?: boolean;
}

type Coordinate = { lat: number; lng: number };
type LocalPoint = { x: number; y: number };

const EARTH_M_PER_DEG = 111_320;

function toLocal(point: Coordinate, origin: Coordinate): LocalPoint {
  const latitudeRadians = origin.lat * Math.PI / 180;
  return {
    x: (point.lng - origin.lng) * EARTH_M_PER_DEG * Math.cos(latitudeRadians),
    y: (point.lat - origin.lat) * EARTH_M_PER_DEG,
  };
}

function toCoordinate(point: LocalPoint, origin: Coordinate): Coordinate {
  const latitudeRadians = origin.lat * Math.PI / 180;
  return {
    lat: origin.lat + point.y / EARTH_M_PER_DEG,
    lng: origin.lng + point.x / (EARTH_M_PER_DEG * Math.cos(latitudeRadians)),
  };
}

function projectToSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint): {
  point: LocalPoint;
  distanceM: number;
  along: number;
} {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const along = denominator <= 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  const projected = { x: start.x + dx * along, y: start.y + dy * along };
  return { point: projected, distanceM: Math.hypot(point.x - projected.x, point.y - projected.y), along };
}

interface PathProjection {
  path: SnapLabSyntheticMapPath;
  coordinate: Coordinate;
  distanceM: number;
  pathPosition: number;
}

function orientation(left: LocalPoint, middle: LocalPoint, right: LocalPoint): number {
  return (middle.y - left.y) * (right.x - middle.x)
    - (middle.x - left.x) * (right.y - middle.y);
}

function segmentsProperlyIntersect(
  firstStart: LocalPoint,
  firstEnd: LocalPoint,
  secondStart: LocalPoint,
  secondEnd: LocalPoint,
): boolean {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  // Only a proper crossing blocks attribution. Merely touching a barrier
  // endpoint is intentionally left eligible so a real gate can be modeled by
  // two barrier segments without introducing a synthetic dead zone.
  return firstA * firstB < 0 && secondA * secondB < 0;
}

function projectionCrossesBarrier(
  source: Coordinate,
  projected: Coordinate,
  barriers: SnapLabSyntheticBarrier[] = [],
): boolean {
  return barriers.some(barrier => {
    const origin = barrier.from;
    return segmentsProperlyIntersect(
      toLocal(source, origin),
      toLocal(projected, origin),
      toLocal(barrier.from, origin),
      toLocal(barrier.to, origin),
    );
  });
}

function projectToPath(point: Coordinate, path: SnapLabSyntheticMapPath): PathProjection | null {
  if (path.coordinates.length < 2) return null;
  const origin = path.coordinates[0];
  const localPoint = toLocal(point, origin);
  let best: PathProjection | null = null;
  for (let index = 1; index < path.coordinates.length; index += 1) {
    const projected = projectToSegment(
      localPoint,
      toLocal(path.coordinates[index - 1], origin),
      toLocal(path.coordinates[index], origin),
    );
    if (!best || projected.distanceM < best.distanceM) {
      best = {
        path,
        coordinate: toCoordinate(projected.point, origin),
        distanceM: projected.distanceM,
        pathPosition: index - 1 + projected.along,
      };
    }
  }
  return best;
}

function parseCoordinates(url: URL): Coordinate[] {
  const encoded = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
  return encoded.split(';').flatMap(value => {
    const [lng, lat] = value.split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
  });
}

function parseRadii(url: URL, count: number): number[] {
  const values = (url.searchParams.get('radiuses') ?? '').split(';').map(Number);
  return Array.from({ length: count }, (_, index) => (
    Number.isFinite(values[index]) ? Math.max(3, values[index]) : 18
  ));
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => JSON.parse(JSON.stringify(body)),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function matchingBody(options: SnapLabSyntheticTransportOptions, url: URL): unknown {
  const coordinates = parseCoordinates(url);
  const radii = parseRadii(url, coordinates.length);
  const projections = coordinates.map((coordinate, index) => {
    const ranked = options.map.paths
      .flatMap(path => projectToPath(coordinate, path) ?? [])
      .sort((left, right) => left.distanceM - right.distanceM);
    const best = ranked[0] ?? null;
    const supported = best
      && best.distanceM <= Math.max(12, radii[index] * 1.25)
      && !projectionCrossesBarrier(coordinate, best.coordinate, options.map.barriers)
      ? best
      : null;
    const alternativesCount = supported
      ? ranked.slice(1).filter(candidate => candidate.distanceM <= supported.distanceM + 7).length
      : 0;
    return { supported, alternativesCount };
  });

  const matchings: Array<{
    confidence: number;
    geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  }> = [];
  const tracepoints: Array<null | {
    location: [number, number];
    matchings_index: number;
    waypoint_index: number;
    alternatives_count: number;
    name: string;
  }> = Array(coordinates.length).fill(null);
  let index = 0;
  while (index < projections.length) {
    const first = projections[index].supported;
    if (!first) {
      index += 1;
      continue;
    }
    const run: Array<{ sourceIndex: number; projection: PathProjection; alternativesCount: number }> = [];
    while (index < projections.length && projections[index].supported?.path.id === first.path.id) {
      run.push({
        sourceIndex: index,
        projection: projections[index].supported!,
        alternativesCount: projections[index].alternativesCount,
      });
      index += 1;
    }
    if (run.length < 2) continue;
    const matchingIndex = matchings.length;
    const meanDistance = run.reduce((sum, item) => sum + item.projection.distanceM, 0) / run.length;
    const ambiguousFraction = run.filter(item => item.alternativesCount > 0).length / run.length;
    const confidence = options.forceLowMatchingConfidence
      ? 0.18
      : Math.max(0.05, Math.min(0.99, 0.98 - meanDistance / 45 - ambiguousFraction * 0.45));
    matchings.push({
      confidence,
      geometry: {
        type: 'LineString',
        coordinates: run.map(item => [item.projection.coordinate.lng, item.projection.coordinate.lat]),
      },
    });
    run.forEach((item, waypointIndex) => {
      tracepoints[item.sourceIndex] = {
        location: [item.projection.coordinate.lng, item.projection.coordinate.lat],
        matchings_index: matchingIndex,
        waypoint_index: waypointIndex,
        alternatives_count: item.alternativesCount,
        name: item.projection.path.name,
      };
    });
  }
  if (matchings.length === 0) return { code: 'NoMatch', message: 'No segment matched the deterministic available map.', tracepoints };
  return { code: 'Ok', tracepoints, matchings };
}

function directionsBody(options: SnapLabSyntheticTransportOptions, url: URL): unknown {
  const coordinates = parseCoordinates(url);
  if (coordinates.length < 2) return { code: 'NoRoute', routes: [] };
  const start = coordinates[0];
  const end = coordinates.at(-1)!;
  const ranked = options.map.paths.flatMap(path => {
    const startProjection = projectToPath(start, path);
    const endProjection = projectToPath(end, path);
    return startProjection && endProjection ? [{ path, startProjection, endProjection }] : [];
  }).sort((left, right) => (
    left.startProjection.distanceM + left.endProjection.distanceM
    - right.startProjection.distanceM - right.endProjection.distanceM
  ));
  const selected = ranked[0];
  if (!selected || selected.startProjection.distanceM > 35 || selected.endProjection.distanceM > 35) {
    return { code: 'NoRoute', routes: [] };
  }
  const forwards = selected.startProjection.pathPosition <= selected.endProjection.pathPosition;
  const low = Math.floor(Math.min(selected.startProjection.pathPosition, selected.endProjection.pathPosition)) + 1;
  const high = Math.ceil(Math.max(selected.startProjection.pathPosition, selected.endProjection.pathPosition));
  const interior = selected.path.coordinates.slice(low, high);
  const geometry = [selected.startProjection.coordinate, ...interior, selected.endProjection.coordinate];
  if (!forwards) geometry.reverse();
  return {
    code: 'Ok',
    routes: [{
      geometry: { type: 'LineString', coordinates: geometry.map(point => [point.lng, point.lat]) },
      legs: [{ steps: [{ name: selected.path.name }] }],
    }],
  };
}

/** Deterministic HTTP-boundary provider derived only from submitted samples
 * and the case's available map. Latent truth and private oracle never enter
 * this module. It never falls through to global fetch. */
export function createSnapLabSyntheticGraphTransport(options: SnapLabSyntheticTransportOptions): {
  fetch: typeof fetch;
  receipts: () => SnapLabTransportReceipt[];
} {
  const receipts: SnapLabTransportReceipt[] = [];
  let requestOrdinal = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requestOrdinal += 1;
    const startedAt = Date.now();
    const method = String(init?.method ?? 'GET').toUpperCase();
    const rawUrl = typeof input === 'string' ? input : input.toString();
    const url = new URL(rawUrl);
    const sanitizedUrl = sanitizeSnapLabRequestUrl(rawUrl);
    const requestFingerprint = snapLabRequestFingerprint(method, rawUrl);
    const endpoint = url.pathname.includes('/matching/') ? 'matching' : 'directions';
    const baseReceipt: SnapLabTransportReceipt = {
      requestFingerprint,
      method,
      sanitizedUrl,
      matched: true,
      status: null,
      startedAt,
      completedAt: startedAt,
      provenance: 'DETERMINISTIC_TRANSPORT',
      endpoint,
      requestOrdinal,
    };
    const complete = (status: number | null, errorCategory: string | null) => {
      receipts.push({ ...baseReceipt, status, completedAt: Date.now(), errorCategory });
    };
    if (method !== 'GET') {
      complete(405, 'METHOD_NOT_ALLOWED');
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (options.failureMode === 'timeout') {
      complete(null, 'TIMEOUT');
      throw Object.assign(new Error('snap_lab_deterministic_timeout'), { name: 'AbortError' });
    }
    if (options.failureMode === 'nomatch') {
      complete(200, 'NO_MATCH');
      return jsonResponse(200, endpoint === 'matching'
        ? { code: 'NoMatch', tracepoints: [], matchings: [] }
        : { code: 'NoRoute', routes: [] });
    }
    if (options.failureMode === 'auth-then-unavailable') {
      const status = requestOrdinal % 2 === 1 ? 401 : 503;
      complete(status, status === 401 ? 'AUTH' : 'UNAVAILABLE');
      return jsonResponse(status, { code: status === 401 ? 'Unauthorized' : 'ServiceUnavailable' });
    }
    const body = endpoint === 'matching' ? matchingBody(options, url) : directionsBody(options, url);
    complete(200, null);
    return jsonResponse(200, body);
  };
  return {
    fetch: fetchImpl as typeof fetch,
    receipts: () => receipts.map(receipt => ({ ...receipt })),
  };
}
