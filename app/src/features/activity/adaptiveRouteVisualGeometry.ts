/**
 * Shared display-only route geometry policy.
 *
 * The planner works in local metric space and never changes recording
 * authority. It only replaces a supported visual corner with a bounded
 * quadratic fillet. Endpoints, segment boundaries, gaps and chronological
 * order remain exact. Live uses adjacent causal arms so a corner is decided
 * once its next displayed observation exists; Saved Final may accumulate
 * support along a dense provider trace before applying the same policy.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface AdaptiveVisualPoint {
  lat: number;
  lng: number;
  t?: number;
  segmentId?: string;
  livePresentationBreakBefore?: true;
  accuracy?: number | null;
  segmentStartReason?: unknown;
  observationId?: string;
  clientActivityId?: string;
  ownerGeneration?: string;
  rawOrdinal?: number;
}

interface XY {
  x: number;
  y: number;
}

export interface AdaptiveRouteVisualOptions {
  eligibleCorners?: ReadonlyArray<boolean>;
  armMode?: "adjacent" | "trace";
  minimumArmM?: number;
  maximumArmM?: number;
  minimumTurnDeg?: number;
  maximumTurnDeg?: number;
  maximumTangentM?: number;
  maximumTangentArmRatio?: number;
  crossingGuardM?: number;
  curveSamples?: number;
  selectionMode?: "causal" | "sharpest";
  /** Bounded earlier display evidence used by causal Live topology checks. */
  topologyContext?: ReadonlyArray<AdaptiveVisualPoint>;
}

export interface AdaptiveRouteVisualDiagnostics {
  consideredCorners: number;
  roundedCorners: number;
  skippedShortArm: number;
  skippedTurnShape: number;
  skippedTopologyGuard: number;
  skippedOverlapGuard: number;
  skippedProvenanceGuard: number;
  maximumTangentM: number;
  roundedCornerIndices: number[];
}

interface Arm {
  anchorIndex: number;
  armM: number;
}

interface Tangent<T> {
  point: T;
  edgeStart: number;
}

interface Candidate<T> {
  cornerIndex: number;
  contextStart: number;
  contextEnd: number;
  entryEdgeStart: number;
  exitEdgeStart: number;
  tangentIn: T;
  tangentOut: T;
  turnDeg: number;
  tangentM: number;
}

const defaults = {
  minimumArmM: 5,
  maximumArmM: 45,
  minimumTurnDeg: 28,
  maximumTurnDeg: 112,
  maximumTangentM: 5.5,
  maximumTangentArmRatio: 0.27,
  crossingGuardM: 3,
  curveSamples: 3,
} as const;

function project(point: AdaptiveVisualPoint, originLat: number): XY {
  const radians = Math.PI / 180;
  return {
    x: EARTH_RADIUS_M * point.lng * radians * Math.cos(originLat * radians),
    y: EARTH_RADIUS_M * point.lat * radians,
  };
}

function unproject(
  point: XY,
  originLat: number,
): Pick<AdaptiveVisualPoint, "lat" | "lng"> {
  const degrees = 180 / Math.PI;
  return {
    lat: (point.y / EARTH_RADIUS_M) * degrees,
    lng:
      (point.x / (EARTH_RADIUS_M * Math.cos((originLat * Math.PI) / 180))) *
      degrees,
  };
}

const distance = (left: XY, right: XY) =>
  Math.hypot(left.x - right.x, left.y - right.y);

/**
 * A generated display vertex is deliberately not an observation. Keeping a
 * source observation's identity on an interpolated point would make an audit
 * or cold read-back appear to contain duplicate physical evidence.
 */
function withoutObservationIdentity<T extends AdaptiveVisualPoint>(
  point: T,
): T {
  const copy = { ...point };
  delete copy.observationId;
  delete copy.clientActivityId;
  delete copy.ownerGeneration;
  delete copy.rawOrdinal;
  return copy;
}

function pointToSegmentDistance(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator <= 1e-9) return distance(point, start);
  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator,
    ),
  );
  return distance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy });
}

function interpolatePoint<T extends AdaptiveVisualPoint>(
  start: T,
  end: T,
  fraction: number,
): T {
  const timestamp =
    start.t != null && end.t != null
      ? Math.round(start.t + (end.t - start.t) * fraction)
      : (start.t ?? end.t);
  return {
    ...withoutObservationIdentity(start),
    lat: start.lat + (end.lat - start.lat) * fraction,
    lng: start.lng + (end.lng - start.lng) * fraction,
    ...(timestamp == null ? {} : { t: timestamp }),
    segmentId: start.segmentId ?? end.segmentId,
    livePresentationBreakBefore: undefined,
    segmentStartReason: undefined,
  } as T;
}

function sameContinuousSegment(
  previous: AdaptiveVisualPoint,
  next: AdaptiveVisualPoint,
): boolean {
  return (
    next.livePresentationBreakBefore !== true &&
    (previous.segmentId ?? "__legacy") === (next.segmentId ?? "__legacy")
  );
}

function hasNearbyNonAdjacentEdge(
  points: ReadonlyArray<XY>,
  cornerIndex: number,
  crossingGuardM: number,
): boolean {
  const corner = points[cornerIndex];
  for (let edge = 0; edge < points.length - 1; edge += 1) {
    if (edge >= cornerIndex - 2 && edge <= cornerIndex + 1) continue;
    if (
      pointToSegmentDistance(corner, points[edge], points[edge + 1]) <
      crossingGuardM
    ) {
      return true;
    }
  }
  return false;
}

function hasNearbyContextEdge(
  point: XY,
  context: ReadonlyArray<AdaptiveVisualPoint>,
  originLat: number,
  crossingGuardM: number,
): boolean {
  if (context.length < 2) return false;
  const planar = context.map((candidate) => project(candidate, originLat));
  for (let edge = 0; edge < planar.length - 1; edge += 1) {
    if (
      pointToSegmentDistance(point, planar[edge], planar[edge + 1]) <
      crossingGuardM
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Produces display coordinates only. A point added by this function is not a
 * GPS observation and callers must never feed it into canonical distance,
 * elevation, Memory/Fog or matching authority.
 */
export function applyAdaptiveRouteVisualGeometry<T extends AdaptiveVisualPoint>(
  points: ReadonlyArray<T>,
  options: AdaptiveRouteVisualOptions = {},
): { points: T[]; diagnostics: AdaptiveRouteVisualDiagnostics } {
  const settings = { ...defaults, ...options };
  const diagnostics: AdaptiveRouteVisualDiagnostics = {
    consideredCorners: Math.max(0, points.length - 2),
    roundedCorners: 0,
    skippedShortArm: 0,
    skippedTurnShape: 0,
    skippedTopologyGuard: 0,
    skippedOverlapGuard: 0,
    skippedProvenanceGuard: 0,
    maximumTangentM: 0,
    roundedCornerIndices: [],
  };
  if (points.length < 3)
    return { points: points.map((point) => ({ ...point })), diagnostics };

  const originLat =
    points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const planar = points.map((point) => project(point, originLat));
  const arm = (cornerIndex: number, direction: -1 | 1): Arm | null => {
    if (settings.armMode === "adjacent") {
      const adjacentIndex = cornerIndex + direction;
      if (
        adjacentIndex < 0 ||
        adjacentIndex >= points.length ||
        !sameContinuousSegment(
          direction < 0 ? points[adjacentIndex] : points[cornerIndex],
          direction < 0 ? points[cornerIndex] : points[adjacentIndex],
        )
      )
        return null;
      const armM = distance(planar[cornerIndex], planar[adjacentIndex]);
      return armM >= settings.minimumArmM && armM <= settings.maximumArmM
        ? { anchorIndex: adjacentIndex, armM }
        : null;
    }
    let cursor = cornerIndex;
    let armM = 0;
    while (armM < settings.minimumArmM) {
      const next = cursor + direction;
      if (
        next < 0 ||
        next >= points.length ||
        !sameContinuousSegment(
          direction < 0 ? points[next] : points[cursor],
          direction < 0 ? points[cursor] : points[next],
        )
      )
        return null;
      armM += distance(planar[cursor], planar[next]);
      cursor = next;
      if (armM > settings.maximumArmM) return null;
    }
    return { anchorIndex: cursor, armM };
  };
  const tangentAlongTrace = (
    cornerIndex: number,
    direction: -1 | 1,
    tangentM: number,
  ): Tangent<T> | null => {
    let cursor = cornerIndex;
    let remainingM = tangentM;
    while (remainingM > 1e-6) {
      const next = cursor + direction;
      if (next < 0 || next >= points.length) return null;
      const edgeM = distance(planar[cursor], planar[next]);
      if (edgeM >= remainingM && edgeM > 1e-9) {
        return {
          point: interpolatePoint(
            points[cursor],
            points[next],
            remainingM / edgeM,
          ),
          edgeStart: direction < 0 ? next : cursor,
        };
      }
      remainingM -= edgeM;
      cursor = next;
    }
    return null;
  };

  const candidates: Candidate<T>[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (settings.eligibleCorners && settings.eligibleCorners[index] !== true) {
      diagnostics.skippedProvenanceGuard += 1;
      continue;
    }
    if (
      !sameContinuousSegment(points[index - 1], points[index]) ||
      !sameContinuousSegment(points[index], points[index + 1])
    ) {
      diagnostics.skippedTopologyGuard += 1;
      continue;
    }
    const incomingArm = arm(index, -1);
    const outgoingArm = arm(index, 1);
    if (!incomingArm || !outgoingArm) {
      diagnostics.skippedShortArm += 1;
      continue;
    }
    const corner = planar[index];
    const previous = planar[incomingArm.anchorIndex];
    const next = planar[outgoingArm.anchorIndex];
    const incoming = {
      x: (corner.x - previous.x) / incomingArm.armM,
      y: (corner.y - previous.y) / incomingArm.armM,
    };
    const outgoing = {
      x: (next.x - corner.x) / outgoingArm.armM,
      y: (next.y - corner.y) / outgoingArm.armM,
    };
    const turnDeg =
      (Math.acos(
        Math.max(
          -1,
          Math.min(1, incoming.x * outgoing.x + incoming.y * outgoing.y),
        ),
      ) *
        180) /
      Math.PI;
    if (
      turnDeg < settings.minimumTurnDeg ||
      turnDeg > settings.maximumTurnDeg
    ) {
      diagnostics.skippedTurnShape += 1;
      continue;
    }
    if (
      hasNearbyNonAdjacentEdge(planar, index, settings.crossingGuardM) ||
      (settings.topologyContext != null &&
        hasNearbyContextEdge(
          corner,
          settings.topologyContext,
          originLat,
          settings.crossingGuardM,
        ))
    ) {
      diagnostics.skippedTopologyGuard += 1;
      continue;
    }

    const shorterArmM = Math.min(incomingArm.armM, outgoingArm.armM);
    const turnStrength = Math.sin((turnDeg * Math.PI) / 360);
    const accuracy = points[index].accuracy;
    const uncertaintyConfidence =
      accuracy != null && Number.isFinite(accuracy) && accuracy > 0
        ? Math.max(0.72, Math.min(1, shorterArmM / (accuracy * 1.5)))
        : 1;
    const tangentRatio =
      settings.maximumTangentArmRatio *
      (0.72 + 0.28 * turnStrength) *
      uncertaintyConfidence;
    const tangentM = Math.min(
      settings.maximumTangentM,
      incomingArm.armM * tangentRatio,
      outgoingArm.armM * tangentRatio,
    );
    if (tangentM < 0.75) {
      diagnostics.skippedShortArm += 1;
      continue;
    }
    const tangentIn = tangentAlongTrace(index, -1, tangentM);
    const tangentOut = tangentAlongTrace(index, 1, tangentM);
    if (!tangentIn || !tangentOut) {
      diagnostics.skippedShortArm += 1;
      continue;
    }
    const startT = tangentIn.point.t;
    const endT = tangentOut.point.t;
    if (
      startT != null &&
      endT != null &&
      endT - startT <= settings.curveSamples
    ) {
      diagnostics.skippedShortArm += 1;
      continue;
    }
    candidates.push({
      cornerIndex: index,
      contextStart: incomingArm.anchorIndex,
      contextEnd: outgoingArm.anchorIndex,
      entryEdgeStart: tangentIn.edgeStart,
      exitEdgeStart: tangentOut.edgeStart,
      tangentIn: tangentIn.point,
      tangentOut: tangentOut.point,
      turnDeg,
      tangentM,
    });
  }

  // Live uses chronological selection: once a supported corner is visible, a
  // later nearby vertex cannot replace it. Finished dense provider traces can
  // choose the sharpest vertex in the same local context because their full
  // evidence is already stable.
  const selected: Candidate<T>[] = [];
  const selectionOrder =
    options.selectionMode === "sharpest"
      ? [...candidates].sort(
          (left, right) =>
            right.turnDeg - left.turnDeg ||
            left.cornerIndex - right.cornerIndex,
        )
      : candidates;
  for (const candidate of selectionOrder) {
    const overlaps = selected.some(
      (existing) =>
        candidate.contextStart < existing.contextEnd &&
        existing.contextStart < candidate.contextEnd,
    );
    if (overlaps) diagnostics.skippedOverlapGuard += 1;
    else selected.push(candidate);
  }
  selected.sort((left, right) => left.cornerIndex - right.cornerIndex);

  const output: T[] = [];
  let sourceCursor = 0;
  for (const candidate of selected) {
    while (sourceCursor <= candidate.entryEdgeStart) {
      output.push({ ...points[sourceCursor] });
      sourceCursor += 1;
    }
    const tangentInXY = project(candidate.tangentIn, originLat);
    const tangentOutXY = project(candidate.tangentOut, originLat);
    output.push(candidate.tangentIn);
    for (let sample = 1; sample <= settings.curveSamples; sample += 1) {
      const fraction = sample / (settings.curveSamples + 1);
      const inverse = 1 - fraction;
      const curved = unproject(
        {
          x:
            inverse * inverse * tangentInXY.x +
            2 * inverse * fraction * planar[candidate.cornerIndex].x +
            fraction * fraction * tangentOutXY.x,
          y:
            inverse * inverse * tangentInXY.y +
            2 * inverse * fraction * planar[candidate.cornerIndex].y +
            fraction * fraction * tangentOutXY.y,
        },
        originLat,
      );
      const startT = candidate.tangentIn.t;
      const endT = candidate.tangentOut.t;
      const timestamp =
        startT != null && endT != null
          ? Math.round(startT + (endT - startT) * fraction)
          : points[candidate.cornerIndex].t;
      output.push({
        ...withoutObservationIdentity(points[candidate.cornerIndex]),
        ...curved,
        ...(timestamp == null ? {} : { t: timestamp }),
        segmentId: points[candidate.cornerIndex].segmentId,
        livePresentationBreakBefore: undefined,
        segmentStartReason: undefined,
      });
    }
    output.push(candidate.tangentOut);
    sourceCursor = candidate.exitEdgeStart + 1;
    diagnostics.maximumTangentM = Math.max(
      diagnostics.maximumTangentM,
      candidate.tangentM,
    );
    diagnostics.roundedCornerIndices.push(candidate.cornerIndex);
  }
  while (sourceCursor < points.length) {
    output.push({ ...points[sourceCursor] });
    sourceCursor += 1;
  }
  diagnostics.roundedCorners = selected.length;
  return { points: output, diagnostics };
}
