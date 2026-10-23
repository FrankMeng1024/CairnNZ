import type { RoutePoint } from '../../store/useRouteStore';
import type { CanonicalRouteGeometry } from './canonicalRouteGeometry';
import { routePointDistanceM } from './orderedRouteDraft';

export interface RouteDisplayLine {
  id: string;
  coordinates: RoutePoint[];
  occurrenceIds: string[];
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

export interface RouteDisplayGeometry {
  baseLines: RouteDisplayLine[];
  /** Display-only non-retraced intervals. Canonical geometry remains in baseLines. */
  ordinaryLines: RouteDisplayLine[];
  repeatLanes: RouteRepeatLane[];
  repeatLabels: RouteRepeatLabel[];
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
      return;
    }
    active = {
      id: `ordinary:${segment.id}`,
      coordinates: [clone(segment.a), clone(segment.b)],
      occurrenceIds: [segment.occurrenceId],
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
export function buildRouteDisplayGeometry(geometry: CanonicalRouteGeometry): RouteDisplayGeometry {
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
    if (activeBase
      && !hasGap
      && routePointDistanceM(activeBase.coordinates.at(-1)!, part.points[0]) <= CONNECTED_M) {
      activeBase.coordinates.push(...part.points.slice(1).map(clone));
      activeBase.occurrenceIds.push(...occurrenceIds);
      return;
    }
    activeBase = {
      id: `base:${part.id}`,
      coordinates: part.points.map(clone),
      occurrenceIds,
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
    ordinaryLines: baseLines.map(line => ({ ...line, coordinates: line.coordinates.map(clone), occurrenceIds: [...line.occurrenceIds] })),
    repeatLanes: [],
    repeatLabels: [],
  };

  const ordinaryLines = linesForMask(segments, repeated.map(value => !value));

  const repeatLanes: RouteRepeatLane[] = [];
  let activeRepeat: RouteRepeatLane | null = null;

  const flushRepeat = () => {
    if (activeRepeat) repeatLanes.push(activeRepeat);
    activeRepeat = null;
  };

  segments.forEach((segment, index) => {
    if (repeated[index]) {
      const multiplicity = traversalMultiplicity(matchIndexes[index]);
      if (activeRepeat
        && !segment.breakBefore
        && routePointDistanceM(activeRepeat.coordinates.at(-1)!, segment.a) <= CONNECTED_M) {
        activeRepeat.coordinates.push(clone(segment.b));
        if (!activeRepeat.occurrenceIds.includes(segment.occurrenceId)) {
          activeRepeat.occurrenceIds.push(segment.occurrenceId);
        }
        activeRepeat.multiplicity = Math.max(activeRepeat.multiplicity, multiplicity);
      } else {
        flushRepeat();
        activeRepeat = {
          id: `repeat:${segment.id}`,
          coordinates: [clone(segment.a), clone(segment.b)],
          occurrenceIds: [segment.occurrenceId],
          direction: 'forward',
          multiplicity,
          // Mapbox applies a positive offset relative to traversal direction.
          // Consecutive A→B→A legs therefore appear on opposite sides of the
          // untouched canonical centerline and remain joined by a rounded U.
          offsetPx: RETRACE_LANE_OFFSET_PX,
        };
      }
      return;
    }

    flushRepeat();
  });
  flushRepeat();

  const repeatLabels: RouteRepeatLabel[] = repeatLanes
    .filter(lane => lane.multiplicity >= 2
      && lane.coordinates.slice(1).reduce(
        (sum, point, index) => sum + routePointDistanceM(lane.coordinates[index], point),
        0,
      ) >= RETRACE_LABEL_MIN_M)
    .map(lane => {
      const middle = Math.floor((lane.coordinates.length - 1) / 2);
      const a = lane.coordinates[middle];
      const b = lane.coordinates[Math.min(lane.coordinates.length - 1, middle + 1)];
      return {
        id: `repeat-label:${lane.id}`,
        coordinate: interpolate(a, b, 0.5),
        text: `${lane.multiplicity} passes`,
        occurrenceIds: [...lane.occurrenceIds],
        direction: lane.direction,
      };
    });

  return { baseLines, ordinaryLines, repeatLanes, repeatLabels };
}
