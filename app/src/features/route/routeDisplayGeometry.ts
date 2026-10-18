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

/**
 * Build a reversible, screen-space presentation from immutable canonical
 * coordinates. Sampling is used only for overlap recognition; persistence,
 * metrics and navigation keep using the untouched canonical geometry.
 *
 * Repeated intervals remain in original traversal order as a continuous
 * offset feature. Mapbox rounds the real turning vertex into the small U that
 * joins an out-and-back. Matching uses corridor and heading, so A-B can match
 * B-M-A without requiring identical endpoint pairs.
 */
export function buildRouteDisplayGeometry(geometry: CanonicalRouteGeometry): RouteDisplayGeometry {
  const gapAfter = new Set(geometry.gaps.map(gap => gap.afterPartId));
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
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 3; right < segments.length; right += 1) {
      if (segments[right].breakBefore) continue;
      if (!segmentsShareCorridor(segments[left], segments[right])) continue;
      matchIndexes[left].push(right);
      matchIndexes[right].push(left);
    }
  }
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

  // Most Routes do not retrace themselves. Preserve their exact canonical
  // vertices in the display source: sampling above is recognition-only.
  if (!repeated.some(Boolean)) {
    const baseLines: RouteDisplayLine[] = [];
    let active: RouteDisplayLine | null = null;
    geometry.parts.forEach((part, partIndex) => {
      const hasGap = partIndex > 0 && gapAfter.has(geometry.parts[partIndex - 1].id);
      const occurrenceIds = part.points.slice(0, -1).map((_, index) => `${part.id}:${index}`);
      if (active
        && !hasGap
        && routePointDistanceM(active.coordinates.at(-1)!, part.points[0]) <= CONNECTED_M) {
        active.coordinates.push(...part.points.slice(1).map(clone));
        active.occurrenceIds.push(...occurrenceIds);
      } else {
        active = {
          id: `base:${part.id}`,
          coordinates: part.points.map(clone),
          occurrenceIds,
        };
        baseLines.push(active);
      }
    });
    return { baseLines, repeatLanes: [], repeatLabels: [] };
  }

  const baseLines: RouteDisplayLine[] = [];
  const repeatLanes: RouteRepeatLane[] = [];
  let activeBase: RouteDisplayLine | null = null;
  let activeRepeat: RouteRepeatLane | null = null;

  const flushBase = () => {
    if (activeBase) baseLines.push(activeBase);
    activeBase = null;
  };
  const flushRepeat = () => {
    if (activeRepeat) repeatLanes.push(activeRepeat);
    activeRepeat = null;
  };

  segments.forEach((segment, index) => {
    if (repeated[index]) {
      flushBase();
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
          // Direction-relative +3 puts a reverse leg on the opposite physical
          // side and keeps both legs joined at the canonical turn.
          offsetPx: 3,
        };
      }
      return;
    }

    flushRepeat();
    if (activeBase
      && !segment.breakBefore
      && routePointDistanceM(activeBase.coordinates.at(-1)!, segment.a) <= CONNECTED_M) {
      activeBase.coordinates.push(clone(segment.b));
      if (!activeBase.occurrenceIds.includes(segment.occurrenceId)) {
        activeBase.occurrenceIds.push(segment.occurrenceId);
      }
    } else {
      flushBase();
      activeBase = {
        id: `base:${segment.id}`,
        coordinates: [clone(segment.a), clone(segment.b)],
        occurrenceIds: [segment.occurrenceId],
      };
    }
  });
  flushBase();
  flushRepeat();

  const repeatLabels: RouteRepeatLabel[] = repeatLanes
    .filter(lane => lane.multiplicity >= 4)
    .map(lane => {
      const middle = Math.floor((lane.coordinates.length - 1) / 2);
      const a = lane.coordinates[middle];
      const b = lane.coordinates[Math.min(lane.coordinates.length - 1, middle + 1)];
      return {
        id: `repeat-label:${lane.id}`,
        coordinate: interpolate(a, b, 0.5),
        text: `${lane.multiplicity} traversals`,
        occurrenceIds: [...lane.occurrenceIds],
        direction: lane.direction,
      };
    });

  return { baseLines, repeatLanes, repeatLabels };
}
