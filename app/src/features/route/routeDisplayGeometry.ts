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
  a: RoutePoint;
  b: RoutePoint;
  key: string;
  referenceA: RoutePoint;
  referenceB: RoutePoint;
  direction: 'forward' | 'backward';
  breakBefore: boolean;
}

const CONNECTED_M = 0.5;
const KEY_SCALE = 1_000_000;

function pointKey(point: RoutePoint): string {
  return `${Math.round(point.lng * KEY_SCALE)},${Math.round(point.lat * KEY_SCALE)}`;
}

function clone(point: RoutePoint): RoutePoint {
  return { ...point };
}

function segmentDescriptor(id: string, a: RoutePoint, b: RoutePoint, breakBefore = false): DisplaySegment {
  const aKey = pointKey(a);
  const bKey = pointKey(b);
  const forward = aKey <= bKey;
  return {
    id,
    a: clone(a),
    b: clone(b),
    key: forward ? `${aKey}>${bKey}` : `${bKey}>${aKey}`,
    referenceA: clone(forward ? a : b),
    referenceB: clone(forward ? b : a),
    direction: forward ? 'forward' : 'backward',
    breakBefore,
  };
}

/**
 * Build a reversible presentation projection from immutable canonical Route
 * coordinates. Connected tool/provider parts are rendered as one line so an
 * internal join never receives its own cap. Exact repeated traversals get at
 * most two direction-stable pixel lanes; no shifted point is returned to the
 * editor, persistence, metrics or navigation layers.
 */
export function buildRouteDisplayGeometry(geometry: CanonicalRouteGeometry): RouteDisplayGeometry {
  const gapAfter = new Set(geometry.gaps.map(gap => gap.afterPartId));
  const segments: DisplaySegment[] = [];
  geometry.parts.forEach((part, partIndex) => {
    part.points.slice(0, -1).forEach((point, pointIndex) => {
      segments.push(segmentDescriptor(
        `${part.id}:${pointIndex}`,
        point,
        part.points[pointIndex + 1],
        pointIndex === 0 && partIndex > 0 && gapAfter.has(geometry.parts[partIndex - 1].id),
      ));
    });
    const next = geometry.parts[partIndex + 1];
    if (!next || gapAfter.has(part.id)) return;
    const end = part.points.at(-1);
    const start = next.points[0];
    // Parts with a shared endpoint are already represented by their own
    // adjacent segments. A non-zero connector is not invented here.
    if (end && start && routePointDistanceM(end, start) > CONNECTED_M) return;
  });

  const grouped = new Map<string, DisplaySegment[]>();
  for (const segment of segments) grouped.set(segment.key, [...(grouped.get(segment.key) ?? []), segment]);
  const repeatedKeys = new Set([...grouped].filter(([, entries]) => entries.length > 1).map(([key]) => key));

  const baseLines: RouteDisplayLine[] = [];
  let active: RouteDisplayLine | null = null;
  for (const segment of segments) {
    if (repeatedKeys.has(segment.key)) {
      if (active) baseLines.push(active);
      active = null;
      continue;
    }
    if (active && !segment.breakBefore && routePointDistanceM(active.coordinates.at(-1)!, segment.a) <= CONNECTED_M) {
      active.coordinates.push(clone(segment.b));
      active.occurrenceIds.push(segment.id);
    } else {
      if (active) baseLines.push(active);
      active = {
        id: `base:${segment.id}`,
        coordinates: [clone(segment.a), clone(segment.b)],
        occurrenceIds: [segment.id],
      };
    }
  }
  if (active) baseLines.push(active);

  // With no repeated segment, preserve one continuous feature across every
  // shared internal part boundary. This is the common multi-stroke case.
  const rawRepeatLanes: RouteRepeatLane[] = [];
  for (const [key, entries] of grouped) {
    if (entries.length < 2) continue;
    const forward = entries.filter(entry => entry.direction === 'forward');
    const backward = entries.filter(entry => entry.direction === 'backward');
    const reference = entries[0];
    const addLane = (direction: 'forward' | 'backward', matches: DisplaySegment[], offsetPx: number) => {
      if (!matches.length) return;
      rawRepeatLanes.push({
        id: `repeat:${key}:${direction}`,
        coordinates: [clone(reference.referenceA), clone(reference.referenceB)],
        occurrenceIds: matches.map(match => match.id),
        direction,
        multiplicity: matches.length,
        offsetPx,
      });
    };
    if (forward.length && backward.length) {
      addLane('forward', forward, 3);
      addLane('backward', backward, -3);
    } else if (forward.length) addLane('forward', forward, 0);
    else addLane('backward', backward, 0);
  }

  const repeatLanes: RouteRepeatLane[] = [];
  for (const direction of ['forward', 'backward'] as const) {
    for (const lane of rawRepeatLanes.filter(item => item.direction === direction)) {
      const prior = repeatLanes.at(-1);
      if (prior
        && prior.direction === lane.direction
        && prior.offsetPx === lane.offsetPx
        && prior.multiplicity === lane.multiplicity
        && routePointDistanceM(prior.coordinates.at(-1)!, lane.coordinates[0]) <= CONNECTED_M) {
        prior.coordinates.push(...lane.coordinates.slice(1).map(clone));
        prior.occurrenceIds.push(...lane.occurrenceIds);
      } else {
        repeatLanes.push({
          ...lane,
          coordinates: lane.coordinates.map(clone),
          occurrenceIds: [...lane.occurrenceIds],
        });
      }
    }
  }
  const repeatLabels: RouteRepeatLabel[] = repeatLanes.map(lane => {
    const midpoint = lane.coordinates[Math.floor((lane.coordinates.length - 1) / 2)];
    const next = lane.coordinates[Math.min(lane.coordinates.length - 1, Math.floor((lane.coordinates.length - 1) / 2) + 1)];
    return {
      id: `repeat-label:${lane.id}`,
      coordinate: {
        lat: (midpoint.lat + next.lat) / 2,
        lng: (midpoint.lng + next.lng) / 2,
      },
      text: `${lane.direction === 'forward' ? '→' : '←'}${lane.multiplicity > 1 ? ` ×${lane.multiplicity}` : ''}`,
      occurrenceIds: [...lane.occurrenceIds],
      direction: lane.direction,
    };
  });

  return { baseLines, repeatLanes, repeatLabels };
}
