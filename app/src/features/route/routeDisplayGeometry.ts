import type { RoutePoint } from '../../store/useRouteStore';
import type { CanonicalRouteGeometry } from './canonicalRouteGeometry';
import { routePointDistanceM } from './orderedRouteDraft';
import { cairnText } from '../../i18n/runtime';

export interface RouteDisplayLine {
  id: string;
  coordinates: RoutePoint[];
  occurrenceIds: string[];
  /** Stable six-metre interval identities used by the visual coverage oracle. */
  coverageIds: string[];
}

export interface RouteRepeatLane extends RouteDisplayLine {
  direction: 'forward' | 'backward';
  multiplicity: number;
  offsetPx: number;
}

export interface RouteRepeatLabel {
  id: string;
  coordinate: RoutePoint;
  text: string;
  occurrenceIds: string[];
  direction: 'forward' | 'backward';
}

export interface RouteTurnConnector {
  id: string;
  coordinate: RoutePoint;
  /** Display-only screen-space cap anchor. No invented persisted geometry. */
  occurrenceIds: string[];
  multiplicity: number;
}

export interface RouteDisplayGeometry {
  baseLines: RouteDisplayLine[];
  /** Display-only non-retraced intervals. Canonical geometry remains in baseLines. */
  ordinaryLines: RouteDisplayLine[];
  repeatLanes: RouteRepeatLane[];
  repeatLabels: RouteRepeatLabel[];
  /** Truthful reversal anchors retained for diagnostics; no connector geometry. */
  turnConnectors: RouteTurnConnector[];
}

interface DisplaySegment {
  id: string;
  occurrenceId: string;
  a: RoutePoint;
  b: RoutePoint;
  breakBefore: boolean;
}

const CONNECTED_M = 0.5;
const DISPLAY_SAMPLE_M = 6;
const RETRACE_CORRIDOR_M = 3.25;
const RETRACE_HEADING_DEG = 28;
const RETRACE_TURN_BRIDGE_M = 18;
const RETRACE_LABEL_MIN_M = 40;
const RETRACE_MIN_SUSTAINED_OVERLAP_M = 18;
const RETRACE_LANE_OFFSET_PX = 3.5;

function clone(point: RoutePoint): RoutePoint {
  return { ...point };
}

function interpolate(a: RoutePoint, b: RoutePoint, fraction: number): RoutePoint {
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
}

function localMetres(point: RoutePoint, origin: RoutePoint): [number, number] {
  const latScale = 111_132;
  const lngScale = 111_320 * Math.cos(origin.lat * Math.PI / 180);
  return [(point.lng - origin.lng) * lngScale, (point.lat - origin.lat) * latScale];
}

function pointToSegmentDistanceM(point: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const [px, py] = localMetres(point, a);
  const [bx, by] = localMetres(b, a);
  const denominator = bx * bx + by * by;
  if (denominator <= Number.EPSILON) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / denominator));
  return Math.hypot(px - bx * t, py - by * t);
}

function headingCompatible(a: DisplaySegment, b: DisplaySegment): boolean {
  const [ax, ay] = localMetres(a.b, a.a);
  const [bx, by] = localMetres(b.b, b.a);
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (length <= Number.EPSILON) return false;
  const absoluteCosine = Math.abs((ax * bx + ay * by) / length);
  return absoluteCosine >= Math.cos(RETRACE_HEADING_DEG * Math.PI / 180);
}

function headingDot(a: DisplaySegment, b: DisplaySegment): number {
  const [ax, ay] = localMetres(a.b, a.a);
  const [bx, by] = localMetres(b.b, b.a);
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return length <= Number.EPSILON ? 0 : (ax * bx + ay * by) / length;
}

function segmentsShareCorridor(a: DisplaySegment, b: DisplaySegment): boolean {
  if (!headingCompatible(a, b)) return false;
  const aMid = interpolate(a.a, a.b, 0.5);
  const bMid = interpolate(b.a, b.b, 0.5);
  return pointToSegmentDistanceM(aMid, b.a, b.b) <= RETRACE_CORRIDOR_M
    && pointToSegmentDistanceM(bMid, a.a, a.b) <= RETRACE_CORRIDOR_M;
}

function subdivide(
  occurrenceId: string,
  a: RoutePoint,
  b: RoutePoint,
  breakBefore: boolean,
): DisplaySegment[] {
  const steps = Math.max(1, Math.ceil(routePointDistanceM(a, b) / DISPLAY_SAMPLE_M));
  const result: DisplaySegment[] = [];
  for (let index = 0; index < steps; index += 1) {
    result.push({
      id: `${occurrenceId}@${index}`,
      occurrenceId,
      a: interpolate(a, b, index / steps),
      b: interpolate(a, b, (index + 1) / steps),
      breakBefore: breakBefore && index === 0,
    });
  }
  return result;
}

function traversalMultiplicity(matches: number[]): number {
  const peers = [...matches].sort((a, b) => a - b);
  let groups = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const peer of peers) {
    // Adjacent six-metre samples belong to one traversal occurrence.
    if (peer - previous > 2) groups += 1;
    previous = peer;
  }
  return Math.max(2, groups + 1);
}

function canStep(segments: DisplaySegment[], from: number, to: number): boolean {
  if (to < 0 || to >= segments.length || Math.abs(to - from) !== 1) return false;
  return to > from ? !segments[to].breakBefore : !segments[from].breakBefore;
}

/**
 * A repeat must persist as ordered travel, not just touch the same corridor in
 * a few dense/noisy samples. Both sides are already normalized to six-metre
 * display segments, so this remains stable across provider vertex densities.
 */
function sustainedCorridorOverlapM(segments: DisplaySegment[], left: number, right: number): number {
  const peerDirection = headingDot(segments[left], segments[right]) >= 0 ? 1 : -1;
  const sourceHeading = segments[left];
  const peerHeading = segments[right];
  const localDirectionFloor = Math.cos(40 * Math.PI / 180);
  let total = routePointDistanceM(segments[left].a, segments[left].b);

  const extend = (sourceDirection: -1 | 1) => {
    let sourceIndex = left;
    let peerIndex = right;
    while (true) {
      const nextSource = sourceIndex + sourceDirection;
      if (!canStep(segments, sourceIndex, nextSource)) break;
      if (headingDot(sourceHeading, segments[nextSource]) < localDirectionFloor) break;
      let selectedPeer = -1;
      let cursor = peerIndex;
      // Subdivision already normalizes both occurrences to six-metre samples.
      // Advancing exactly one ordered sample prevents a noisy zig-zag from
      // hopping across several short oscillations and manufacturing one long
      // apparent traversal.
      for (let step = 1; step <= 1; step += 1) {
        const candidate = peerIndex + sourceDirection * peerDirection * step;
        if (!canStep(segments, cursor, candidate)) break;
        cursor = candidate;
        if (Math.abs(candidate - nextSource) <= 2) break;
        if (headingDot(peerHeading, segments[candidate]) < localDirectionFloor) break;
        if (segmentsShareCorridor(segments[nextSource], segments[candidate])) {
          selectedPeer = candidate;
          break;
        }
      }
      if (selectedPeer < 0) break;
      sourceIndex = nextSource;
      peerIndex = selectedPeer;
      total += routePointDistanceM(segments[sourceIndex].a, segments[sourceIndex].b);
    }
  };

  extend(-1);
  extend(1);
  return total;
}

function linesForMask(segments: DisplaySegment[], included: boolean[]): RouteDisplayLine[] {
  const lines: RouteDisplayLine[] = [];
  let active: RouteDisplayLine | null = null;
  segments.forEach((segment, index) => {
    if (!included[index]) {
      active = null;
      return;
    }
    if (active && !segment.breakBefore
      && routePointDistanceM(active.coordinates.at(-1)!, segment.a) <= CONNECTED_M) {
      active.coordinates.push(clone(segment.b));
      if (!active.occurrenceIds.includes(segment.occurrenceId)) active.occurrenceIds.push(segment.occurrenceId);
      active.coverageIds.push(segment.id);
      return;
    }
    active = {
      id: `ordinary:${segment.id}`,
      coordinates: [clone(segment.a), clone(segment.b)],
      occurrenceIds: [segment.occurrenceId],
      coverageIds: [segment.id],
    };
    lines.push(active);
  });
  return lines;
}

/**
 * Build a reversible, screen-space presentation from immutable canonical
 * coordinates. Sampling is used only for overlap recognition; persistence,
 * metrics and navigation keep using the untouched canonical geometry.
 *
 * Canonical coordinates remain untouched in `baseLines`. Presentation splits
 * only proven repeated intervals so Mapbox can paint a small directional
 * offset: consecutive A→B→A legs land on opposite visual sides and keep a
 * rounded U at the real turn. Matching uses corridor and heading, so A-B can
 * match B-M-A without requiring identical endpoint pairs.
 */
export function buildRouteDisplayGeometry(
  geometry: CanonicalRouteGeometry,
  options: { repeatPresentationEnabled?: boolean } = {},
): RouteDisplayGeometry {
  const gapAfter = new Set(geometry.gaps.map(gap => gap.afterPartId));
  // Retain the exact ordered canonical coordinates as a reversible authority
  // per real gap. The renderer uses `ordinaryLines` plus `repeatLanes`; this
  // untouched source remains available for fingerprints, metrics and parity.
  const baseLines: RouteDisplayLine[] = [];
  let activeBase: RouteDisplayLine | null = null;
  geometry.parts.forEach((part, partIndex) => {
    if (part.points.length < 2) return;
    const hasGap = partIndex > 0 && gapAfter.has(geometry.parts[partIndex - 1].id);
    const occurrenceIds = part.points.slice(0, -1).map((_, index) => `${part.id}:${index}`);
    const coverageIds = part.points.slice(0, -1).flatMap((point, index) => (
      subdivide(occurrenceIds[index], point, part.points[index + 1], false).map(segment => segment.id)
    ));
    if (activeBase
      && !hasGap
      && routePointDistanceM(activeBase.coordinates.at(-1)!, part.points[0]) <= CONNECTED_M) {
      activeBase.coordinates.push(...part.points.slice(1).map(clone));
      activeBase.occurrenceIds.push(...occurrenceIds);
      activeBase.coverageIds.push(...coverageIds);
      return;
    }
    activeBase = {
      id: `base:${part.id}`,
      coordinates: part.points.map(clone),
      occurrenceIds,
      coverageIds,
    };
    baseLines.push(activeBase);
  });

  const segments: DisplaySegment[] = [];
  geometry.parts.forEach((part, partIndex) => {
    part.points.slice(0, -1).forEach((point, pointIndex) => {
      segments.push(...subdivide(
        `${part.id}:${pointIndex}`,
        point,
        part.points[pointIndex + 1],
        pointIndex === 0 && partIndex > 0 && gapAfter.has(geometry.parts[partIndex - 1].id),
      ));
    });
  });

  if (options.repeatPresentationEnabled === false) return {
    baseLines,
    ordinaryLines: baseLines.map(line => ({
      ...line,
      coordinates: line.coordinates.map(clone),
      occurrenceIds: [...line.occurrenceIds],
      coverageIds: [...line.coverageIds],
    })),
    repeatLanes: [],
    repeatLabels: [],
    turnConnectors: [],
  };

  const matchIndexes = segments.map(() => [] as number[]);
  // A route can contain hundreds of accepted observations. Compare only
  // spatially nearby six-metre display segments; an all-pairs scan made a
  // long Activity-derived Route spend over a second classifying no repeats.
  const gridOrigin = segments[0]?.a;
  const gridCellM = DISPLAY_SAMPLE_M + RETRACE_CORRIDOR_M;
  const grid = new Map<string, number[]>();
  const cellFor = (segment: DisplaySegment): [number, number] => {
    const midpoint = interpolate(segment.a, segment.b, 0.5);
    const [x, y] = localMetres(midpoint, gridOrigin ?? midpoint);
    return [Math.floor(x / gridCellM), Math.floor(y / gridCellM)];
  };
  segments.forEach((segment, right) => {
    const [cellX, cellY] = cellFor(segment);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const candidates = grid.get(`${cellX + dx}:${cellY + dy}`) ?? [];
        for (const left of candidates) {
          if (right - left < 3 || segment.breakBefore) continue;
          if (!segmentsShareCorridor(segments[left], segment)) continue;
          if (sustainedCorridorOverlapM(segments, left, right) < RETRACE_MIN_SUSTAINED_OVERLAP_M) continue;
          matchIndexes[left].push(right);
          matchIndexes[right].push(left);
        }
      }
    }
    const key = `${cellX}:${cellY}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(right);
    else grid.set(key, [right]);
  });
  const repeated = matchIndexes.map(matches => matches.length > 0);

  // The neighbour guard above intentionally prevents a segment from matching
  // the immediately adjacent samples at a real turn. That leaves a tiny hole
  // at the tip of an out-and-back. Bridge only a short, continuous hole that
  // is bounded by already-proven overlap on both sides; never bridge a gap or
  // a longer connector between distinct nearby paths.
  let runStart = -1;
  for (let index = 0; index <= repeated.length; index += 1) {
    if (index < repeated.length && !repeated[index] && !segments[index].breakBefore) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0) {
      const runEnd = index - 1;
      const bounded = runStart > 0
        && index < repeated.length
        && repeated[runStart - 1]
        && repeated[index]
        && !segments[index].breakBefore;
      const distance = bounded
        ? segments.slice(runStart, runEnd + 1)
          .reduce((sum, segment) => sum + routePointDistanceM(segment.a, segment.b), 0)
        : Number.POSITIVE_INFINITY;
      if (distance <= RETRACE_TURN_BRIDGE_M) {
        for (let fill = runStart; fill <= runEnd; fill += 1) repeated[fill] = true;
      }
      runStart = -1;
    }
  }

  // Sampling is recognition-only; the base source above always retains the
  // exact canonical vertices.
  if (!repeated.some(Boolean)) return {
    baseLines,
    ordinaryLines: baseLines.map(line => ({
      ...line,
      coordinates: line.coordinates.map(clone),
      occurrenceIds: [...line.occurrenceIds],
      coverageIds: [...line.coverageIds],
    })),
    repeatLanes: [],
    repeatLabels: [],
    turnConnectors: [],
  };

  const ordinaryLines = linesForMask(segments, repeated.map(value => !value));

  const repeatLanes: RouteRepeatLane[] = [];
  let activeRepeat: RouteRepeatLane | null = null;
  let activeRepeatSegmentIndex = -1;
  const firstRepeatedSegmentIndex = repeated.findIndex(Boolean);

  const flushRepeat = () => {
    if (activeRepeat) repeatLanes.push(activeRepeat);
    activeRepeat = null;
    activeRepeatSegmentIndex = -1;
  };

  segments.forEach((segment, index) => {
    if (repeated[index]) {
      const multiplicity = traversalMultiplicity(matchIndexes[index]);
      if (activeRepeat
        && !segment.breakBefore
        && activeRepeatSegmentIndex >= 0
        && headingDot(segments[activeRepeatSegmentIndex], segment) > 0
        && routePointDistanceM(activeRepeat.coordinates.at(-1)!, segment.a) <= CONNECTED_M) {
        activeRepeat.coordinates.push(clone(segment.b));
        if (!activeRepeat.occurrenceIds.includes(segment.occurrenceId)) {
          activeRepeat.occurrenceIds.push(segment.occurrenceId);
        }
        activeRepeat.coverageIds.push(segment.id);
        activeRepeat.multiplicity = Math.max(activeRepeat.multiplicity, multiplicity);
        activeRepeatSegmentIndex = index;
      } else {
        flushRepeat();
        activeRepeat = {
          id: `repeat:${segment.id}`,
          coordinates: [clone(segment.a), clone(segment.b)],
          occurrenceIds: [segment.occurrenceId],
          coverageIds: [segment.id],
          direction: firstRepeatedSegmentIndex < 0
            || headingDot(segments[firstRepeatedSegmentIndex], segment) >= 0
            ? 'forward'
            : 'backward',
          multiplicity,
          // Mapbox applies a positive offset relative to traversal direction.
          // Consecutive A→B→A legs therefore appear on opposite sides of the
          // untouched canonical centerline and remain joined by a rounded U.
          offsetPx: RETRACE_LANE_OFFSET_PX,
        };
        activeRepeatSegmentIndex = index;
      }
      return;
    }

    flushRepeat();
  });
  flushRepeat();

  const hasDirectRepeatEvidence = (start: number, direction: -1 | 1): boolean => {
    let index = start;
    for (let steps = 0; steps < 4 && index >= 0 && index < segments.length; steps += 1) {
      if (!repeated[index]) return false;
      if (matchIndexes[index].length > 0) return true;
      const next = index + direction;
      if (!canStep(segments, index, next)) return false;
      index = next;
    }
    return false;
  };

  // Each traversal is split at a genuine reversal. Mapbox therefore applies
  // the same pixel offset to two opposing line directions, yielding two
  // parallel arms whose round screen-space caps form a stable, natural U at
  // every zoom. The anchor below remains metadata only; no metre-scaled loop
  // or connector is added to canonical or display coordinates.
  const turnConnectors: RouteTurnConnector[] = [];
  for (let right = 1; right < segments.length; right += 1) {
    const left = right - 1;
    if (!repeated[left] || !repeated[right] || segments[right].breakBefore) continue;
    if (routePointDistanceM(segments[left].b, segments[right].a) > CONNECTED_M) continue;
    if (headingDot(segments[left], segments[right]) > -0.5) continue;
    if (!hasDirectRepeatEvidence(left, -1) || !hasDirectRepeatEvidence(right, 1)) continue;

    const coordinate = interpolate(segments[left].b, segments[right].a, 0.5);
    const multiplicity = Math.max(
      traversalMultiplicity(matchIndexes[left]),
      traversalMultiplicity(matchIndexes[right]),
    );
    const existing = turnConnectors.find(connector => (
      routePointDistanceM(connector.coordinate, coordinate) <= CONNECTED_M
    ));
    const occurrenceIds = [segments[left].occurrenceId, segments[right].occurrenceId];
    if (existing) {
      occurrenceIds.forEach(id => {
        if (!existing.occurrenceIds.includes(id)) existing.occurrenceIds.push(id);
      });
      existing.multiplicity = Math.max(existing.multiplicity, multiplicity);
      continue;
    }
    turnConnectors.push({
      id: `turn:${segments[left].id}:${segments[right].id}`,
      coordinate,
      occurrenceIds,
      multiplicity,
    });
  }

  const repeatLabelCandidates: RouteRepeatLabel[] = repeatLanes
    .filter(lane => lane.multiplicity >= 3
      && lane.coordinates.slice(1).reduce(
        (sum, point, index) => sum + routePointDistanceM(lane.coordinates[index], point),
        0,
      ) >= RETRACE_LABEL_MIN_M)
    .map(lane => {
      const segmentLengths = lane.coordinates.slice(1).map((point, index) => (
        routePointDistanceM(lane.coordinates[index], point)
      ));
      const totalLength = segmentLengths.reduce((sum, value) => sum + value, 0);
      const labelDistance = totalLength * 0.5;
      let traversed = 0;
      let coordinate = clone(lane.coordinates[0]);
      for (let index = 0; index < segmentLengths.length; index += 1) {
        const next = traversed + segmentLengths[index];
        if (next >= labelDistance) {
          const fraction = segmentLengths[index] > 0
            ? (labelDistance - traversed) / segmentLengths[index]
            : 0;
          coordinate = interpolate(lane.coordinates[index], lane.coordinates[index + 1], fraction);
          break;
        }
        traversed = next;
      }
      return {
        id: `repeat-label:${lane.id}`,
        coordinate,
        text: cairnText('route.route-display-geometry.value-passes', { multiplicity: lane.multiplicity }),
        occurrenceIds: [...lane.occurrenceIds],
        direction: lane.direction,
      };
    });
  const repeatLabels = repeatLabelCandidates.filter((candidate, index, candidates) => (
    candidates.findIndex(other => (
      other.text === candidate.text
      && routePointDistanceM(other.coordinate, candidate.coordinate) <= RETRACE_CORRIDOR_M * 2
    )) === index
  ));

  return { baseLines, ordinaryLines, repeatLanes, repeatLabels, turnConnectors };
}
