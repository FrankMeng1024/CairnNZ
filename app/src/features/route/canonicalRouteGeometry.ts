import type { OrderedRouteDraft } from './orderedRouteDraft';
import type { RoutePoint } from '../../store/useRouteStore';

export interface CanonicalRoutePart {
  id: string;
  points: RoutePoint[];
}

export interface CanonicalRouteGap {
  id: string;
  afterPartId: string;
  from: RoutePoint;
  to: RoutePoint;
}

export interface CanonicalRouteGeometry {
  parts: CanonicalRoutePart[];
  gaps: CanonicalRouteGap[];
  start: RoutePoint | null;
  end: RoutePoint | null;
}

const finitePoint = (point: RoutePoint | null | undefined): point is RoutePoint => (
  !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
);

const copyPoints = (points: readonly RoutePoint[]) => points
  .filter(finitePoint)
  .map(point => ({ ...point }));

/**
 * The single presentation boundary for planned Routes. Ordered parts and
 * inherited gaps remain distinct; legacy rows are one continuous part.
 * Appearance is deliberately absent from this model.
 */
export function canonicalRouteGeometry(input: {
  orderedDraft?: OrderedRouteDraft;
  points?: readonly RoutePoint[];
}): CanonicalRouteGeometry {
  const orderedParts = input.orderedDraft?.parts
    .map(part => ({ id: part.id, points: copyPoints(part.points) }))
    .filter(part => part.points.length >= 2) ?? [];
  const parts = orderedParts.length > 0
    ? orderedParts
    : (() => {
        const points = copyPoints(input.points ?? []);
        return points.length >= 2 ? [{ id: 'legacy-route', points }] : [];
      })();

  const gaps = (input.orderedDraft?.gaps ?? []).flatMap(gap => {
    const precedingIndex = parts.findIndex(part => part.id === gap.afterPartId);
    const from = parts[precedingIndex]?.points.at(-1);
    const to = parts[precedingIndex + 1]?.points[0];
    return finitePoint(from) && finitePoint(to)
      ? [{ id: gap.id, afterPartId: gap.afterPartId, from: { ...from }, to: { ...to } }]
      : [];
  });

  return {
    parts,
    gaps,
    start: parts[0]?.points[0] ? { ...parts[0].points[0] } : null,
    end: parts.at(-1)?.points.at(-1) ? { ...parts.at(-1)!.points.at(-1)! } : null,
  };
}

export function canonicalRouteBounds(geometry: CanonicalRouteGeometry): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  const points = geometry.parts.flatMap(part => part.points);
  if (points.length < 2) return null;
  let minLat = Math.min(...points.map(point => point.lat));
  let maxLat = Math.max(...points.map(point => point.lat));
  let minLng = Math.min(...points.map(point => point.lng));
  let maxLng = Math.max(...points.map(point => point.lng));
  const minimumSpanDegrees = 0.005;
  if (maxLat - minLat < minimumSpanDegrees) {
    const center = (minLat + maxLat) / 2;
    minLat = center - minimumSpanDegrees / 2;
    maxLat = center + minimumSpanDegrees / 2;
  }
  if (maxLng - minLng < minimumSpanDegrees) {
    const center = (minLng + maxLng) / 2;
    minLng = center - minimumSpanDegrees / 2;
    maxLng = center + minimumSpanDegrees / 2;
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function canonicalRouteGeometryFingerprint(geometry: CanonicalRouteGeometry): string {
  let hash = 0x811c9dc5;
  const values = geometry.parts.flatMap(part => [
    'part;',
    ...part.points.map(point => `${point.lat.toFixed(6)},${point.lng.toFixed(6)};`),
  ]).concat(geometry.gaps.map(gap => (
    `gap:${gap.from.lat.toFixed(6)},${gap.from.lng.toFixed(6)}>${gap.to.lat.toFixed(6)},${gap.to.lng.toFixed(6)};`
  )));
  values.forEach(value => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  });
  return hash.toString(16).padStart(8, '0');
}
