import type { LngLat } from '../../services/routing/corridor/PolylineSampler';
import { douglasPeucker } from '../../utils/strokeSimplify';
import {
  baselineSlice,
  projectPointOntoBaseline,
} from '../../store/brush/bcef';

const EARTH_RADIUS_M = 6_371_000;
const TILE_SIZE = 512;
const ENDPOINT_LIMIT_M = 50;

export type RouteDrawingIntent =
  | 'straight-replacement'
  | 'shaped-replacement'
  | 'intentional-turn'
  | 'extension'
  | 'ambiguous';

export type DrawingSelectionSource = 'provider' | 'drawn-intent' | 'original-preserved';

export interface DrawingViewport {
  width: number;
  height: number;
  center: LngLat;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface DrawingGeometryMetrics {
  pathLengthM: number;
  pathLengthInflation: number;
  meanDeviationM: number;
  maxDeviationM: number;
  meanDeviationPx: number;
  maxDeviationPx: number;
  sharpTurns: number;
  reversals: number;
  spikes: number;
  maxTurnDeg: number;
  seamEntryTurnDeg: number;
  seamExitTurnDeg: number;
}

export interface DrawingAttachment {
  point: LngLat;
  arcM: number;
  distanceM: number;
  segmentIndex: number;
}

export interface RouteDrawingDecision {
  status: 'accepted' | 'preserved';
  intent: RouteDrawingIntent;
  selectionSource: DrawingSelectionSource;
  reasons: string[];
  divergenceStage: 'sampling' | 'projection' | 'attachment' | 'provider' | 'merge' | null;
  attachments: {
    drawnStart: DrawingAttachment | null;
    drawnEnd: DrawingAttachment | null;
    orderedStart: DrawingAttachment | null;
    orderedEnd: DrawingAttachment | null;
    crossingCount: number;
    ambiguous: boolean;
  };
  rawStroke: LngLat[];
  stabilizedStroke: LngLat[];
  providerGeometry: LngLat[] | null;
  selectedReplacement: LngLat[];
  finalGeometry: LngLat[];
  metrics: {
    raw: DrawingGeometryMetrics;
    provider: DrawingGeometryMetrics | null;
    selected: DrawingGeometryMetrics;
    final: DrawingGeometryMetrics;
  };
}

export interface ResolveRouteDrawingInput {
  originalRoute: LngLat[];
  rawStroke: LngLat[];
  providerGeometry?: LngLat[] | null;
  viewport: DrawingViewport;
}

interface LocalPoint { x: number; y: number }

function toLocal(point: LngLat, origin: LngLat): LocalPoint {
  const rad = Math.PI / 180;
  return {
    x: (point.lng - origin.lng) * rad * EARTH_RADIUS_M * Math.cos(origin.lat * rad),
    y: (point.lat - origin.lat) * rad * EARTH_RADIUS_M,
  };
}

export function routeDrawingDistanceM(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function routeDrawingLengthM(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += routeDrawingDistanceM(points[i - 1], points[i]);
  return total;
}

export function metersPerPixel(latitude: number, zoom: number): number {
  return Math.max(
    0.01,
    Math.cos(latitude * Math.PI / 180) * 2 * Math.PI * EARTH_RADIUS_M
      / (TILE_SIZE * Math.pow(2, zoom)),
  );
}

function pointToSegmentDistanceM(point: LngLat, a: LngLat, b: LngLat): number {
  const p = toLocal(point, a);
  const end = toLocal(b, a);
  const lengthSq = end.x * end.x + end.y * end.y;
  const t = lengthSq <= 1e-9
    ? 0
    : Math.max(0, Math.min(1, (p.x * end.x + p.y * end.y) / lengthSq));
  return Math.hypot(p.x - end.x * t, p.y - end.y * t);
}

function pointToPolylineDistanceM(point: LngLat, line: LngLat[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return routeDrawingDistanceM(point, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    best = Math.min(best, pointToSegmentDistanceM(point, line[i - 1], line[i]));
  }
  return best;
}

function deviationMetrics(source: LngLat[], candidate: LngLat[]): { mean: number; max: number } {
  if (source.length === 0 || candidate.length === 0) return { mean: Infinity, max: Infinity };
  const distances = candidate.map(point => pointToPolylineDistanceM(point, source));
  // Include the other direction so a shortcut that removes an intentional
  // corner cannot look faithful merely because its own vertices are nearby.
  distances.push(...source.map(point => pointToPolylineDistanceM(point, candidate)));
  return {
    mean: distances.reduce((sum, value) => sum + value, 0) / distances.length,
    max: Math.max(...distances),
  };
}

function turnAngleDeg(a: LngLat, b: LngLat, c: LngLat): number {
  const aa = toLocal(a, b);
  const cc = toLocal(c, b);
  const mag = Math.hypot(aa.x, aa.y) * Math.hypot(cc.x, cc.y);
  if (mag <= 1e-9) return 0;
  const interior = Math.acos(Math.max(-1, Math.min(1, (aa.x * cc.x + aa.y * cc.y) / mag))) * 180 / Math.PI;
  return 180 - interior;
}

function shapeStats(points: LngLat[]): {
  sharpTurns: number;
  reversals: number;
  spikes: number;
  maxTurnDeg: number;
} {
  let sharpTurns = 0;
  let reversals = 0;
  let spikes = 0;
  let maxTurnDeg = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const angle = turnAngleDeg(points[i - 1], points[i], points[i + 1]);
    maxTurnDeg = Math.max(maxTurnDeg, angle);
    if (angle >= 55) sharpTurns += 1;
    if (angle >= 145) reversals += 1;
    const ab = routeDrawingDistanceM(points[i - 1], points[i]);
    const bc = routeDrawingDistanceM(points[i], points[i + 1]);
    const ac = routeDrawingDistanceM(points[i - 1], points[i + 1]);
    if (Math.min(ab, bc) >= 3 && ac <= Math.min(ab, bc) * 0.35) spikes += 1;
  }
  return { sharpTurns, reversals, spikes, maxTurnDeg };
}

function angleAtSeam(a: LngLat | null, b: LngLat | null, c: LngLat | null): number {
  if (!a || !b || !c) return 0;
  return turnAngleDeg(a, b, c);
}

function metricsFor(
  reference: LngLat[],
  candidate: LngLat[],
  viewport: DrawingViewport,
  seam?: { before: LngLat | null; start: LngLat | null; end: LngLat | null; after: LngLat | null },
): DrawingGeometryMetrics {
  const deviation = deviationMetrics(reference, candidate);
  const refLength = Math.max(1, routeDrawingLengthM(reference));
  const length = routeDrawingLengthM(candidate);
  const mpp = metersPerPixel(viewport.center.lat, viewport.zoom);
  const shape = shapeStats(candidate);
  return {
    pathLengthM: length,
    pathLengthInflation: length / refLength,
    meanDeviationM: deviation.mean,
    maxDeviationM: deviation.max,
    meanDeviationPx: deviation.mean / mpp,
    maxDeviationPx: deviation.max / mpp,
    ...shape,
    seamEntryTurnDeg: angleAtSeam(seam?.before ?? null, seam?.start ?? null, candidate[1] ?? null),
    seamExitTurnDeg: angleAtSeam(candidate[candidate.length - 2] ?? null, seam?.end ?? null, seam?.after ?? null),
  };
}

function removeNearDuplicates(points: LngLat[], thresholdM = 0.35): LngLat[] {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (routeDrawingDistanceM(out[out.length - 1], points[i]) > thresholdM) out.push(points[i]);
  }
  return out;
}

function projectCandidates(point: LngLat, route: LngLat[]): DrawingAttachment[] {
  const result: DrawingAttachment[] = [];
  let arc = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    const localPoint = toLocal(point, a);
    const localEnd = toLocal(b, a);
    const lengthSq = localEnd.x * localEnd.x + localEnd.y * localEnd.y;
    const t = lengthSq <= 1e-9
      ? 0
      : Math.max(0, Math.min(1, (localPoint.x * localEnd.x + localPoint.y * localEnd.y) / lengthSq));
    const projected: LngLat = {
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    };
    const segmentLength = routeDrawingDistanceM(a, b);
    result.push({
      point: projected,
      arcM: arc + segmentLength * t,
      distanceM: routeDrawingDistanceM(point, projected),
      segmentIndex: i - 1,
    });
    arc += segmentLength;
  }
  return result.sort((left, right) => left.distanceM - right.distanceM);
}

function isProjectionAmbiguous(
  point: LngLat,
  route: LngLat[],
  viewport: DrawingViewport,
): boolean {
  const candidates = projectCandidates(point, route);
  if (candidates.length < 2) return false;
  const distanceWindow = Math.max(2, metersPerPixel(viewport.center.lat, viewport.zoom) * 2);
  const arcSeparation = Math.max(30, routeDrawingLengthM(route) * 0.08);
  return candidates.slice(1).some(candidate =>
    candidate.distanceM <= candidates[0].distanceM + distanceWindow
      && Math.abs(candidate.arcM - candidates[0].arcM) >= arcSeparation,
  );
}

function segmentIntersection(
  a: LngLat,
  b: LngLat,
  c: LngLat,
  d: LngLat,
): { t: number; u: number } | null {
  const origin = a;
  const bb = toLocal(b, origin);
  const cc = toLocal(c, origin);
  const dd = toLocal(d, origin);
  const rx = bb.x;
  const ry = bb.y;
  const sx = dd.x - cc.x;
  const sy = dd.y - cc.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-7) return null;
  const qx = cc.x;
  const qy = cc.y;
  const t = (qx * sy - qy * sx) / cross;
  const u = (qx * ry - qy * rx) / cross;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

function countInteriorRouteCrossings(stroke: LngLat[], route: LngLat[]): number {
  if (stroke.length < 2 || route.length < 2) return 0;
  const strokeLength = routeDrawingLengthM(stroke);
  const routeArcs: number[] = [];
  let strokeArc = 0;
  for (let i = 1; i < stroke.length; i += 1) {
    const strokeSegmentLength = routeDrawingDistanceM(stroke[i - 1], stroke[i]);
    let routeArc = 0;
    for (let j = 1; j < route.length; j += 1) {
      const routeSegmentLength = routeDrawingDistanceM(route[j - 1], route[j]);
      const hit = segmentIntersection(stroke[i - 1], stroke[i], route[j - 1], route[j]);
      if (hit) {
        const alongStroke = strokeArc + strokeSegmentLength * hit.t;
        // Attachment intersections at the first/last few metres are expected.
        if (alongStroke > Math.min(8, strokeLength * 0.08)
          && alongStroke < strokeLength - Math.min(8, strokeLength * 0.08)) {
          routeArcs.push(routeArc + routeSegmentLength * hit.u);
        }
      }
      routeArc += routeSegmentLength;
    }
    strokeArc += strokeSegmentLength;
  }
  routeArcs.sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const arc of routeArcs) {
    if (distinct.length === 0 || Math.abs(arc - distinct[distinct.length - 1]) > 8) distinct.push(arc);
  }
  return distinct.length;
}

function orientToRoute(
  points: LngLat[],
  start: DrawingAttachment,
  end: DrawingAttachment,
): LngLat[] {
  if (points.length < 2) return points.slice();
  const forward = routeDrawingDistanceM(points[0], start.point)
    + routeDrawingDistanceM(points[points.length - 1], end.point);
  const reverse = routeDrawingDistanceM(points[points.length - 1], start.point)
    + routeDrawingDistanceM(points[0], end.point);
  return forward <= reverse ? points.slice() : points.slice().reverse();
}

function stabilizeStroke(
  raw: LngLat[],
  start: DrawingAttachment,
  end: DrawingAttachment,
  viewport: DrawingViewport,
  forceStraight: boolean,
): LngLat[] {
  if (forceStraight) return [start.point, end.point];
  const oriented = orientToRoute(raw, start, end);
  const toleranceM = Math.max(1.25, Math.min(8, metersPerPixel(viewport.center.lat, viewport.zoom) * 2.5));
  const simplified = douglasPeucker(oriented, toleranceM);
  const anchored = simplified.length >= 2 ? simplified : oriented;
  anchored[0] = start.point;
  anchored[anchored.length - 1] = end.point;
  return removeNearDuplicates(anchored);
}

function routePointBefore(route: LngLat[], attachment: DrawingAttachment): LngLat | null {
  return route[Math.max(0, attachment.segmentIndex)] ?? null;
}

function routePointAfter(route: LngLat[], attachment: DrawingAttachment): LngLat | null {
  return route[Math.min(route.length - 1, attachment.segmentIndex + 1)] ?? null;
}

function appendUnique(target: LngLat[], points: LngLat[]): void {
  for (const point of points) {
    if (target.length === 0 || routeDrawingDistanceM(target[target.length - 1], point) > 0.35) {
      target.push(point);
    }
  }
}

function spliceAtDrawnInterval(
  route: LngLat[],
  start: DrawingAttachment,
  end: DrawingAttachment,
  replacement: LngLat[],
): LngLat[] {
  const total = routeDrawingLengthM(route);
  const out: LngLat[] = [];
  appendUnique(out, baselineSlice(route, 0, start.arcM));
  appendUnique(out, replacement);
  appendUnique(out, baselineSlice(route, end.arcM, total));
  return removeNearDuplicates(out);
}

function emptyMetrics(viewport: DrawingViewport): DrawingGeometryMetrics {
  return metricsFor([], [], viewport);
}

export function resolveRouteDrawing(input: ResolveRouteDrawingInput): RouteDrawingDecision {
  const route = input.originalRoute;
  const raw = removeNearDuplicates(input.rawStroke);
  const provider = input.providerGeometry && input.providerGeometry.length >= 2
    ? removeNearDuplicates(input.providerGeometry)
    : null;
  const reasons: string[] = [];

  const projectedStart = raw.length > 0 ? projectPointOntoBaseline(raw[0], route) : null;
  const projectedEnd = raw.length > 1 ? projectPointOntoBaseline(raw[raw.length - 1], route) : null;
  const drawnStart: DrawingAttachment | null = projectedStart ? {
    point: projectedStart.pt,
    arcM: projectedStart.arc,
    distanceM: projectedStart.dist,
    segmentIndex: projectedStart.segIdx,
  } : null;
  const drawnEnd: DrawingAttachment | null = projectedEnd ? {
    point: projectedEnd.pt,
    arcM: projectedEnd.arc,
    distanceM: projectedEnd.dist,
    segmentIndex: projectedEnd.segIdx,
  } : null;
  const orderedStart = drawnStart && drawnEnd
    ? (drawnStart.arcM <= drawnEnd.arcM ? drawnStart : drawnEnd)
    : drawnStart;
  const orderedEnd = drawnStart && drawnEnd
    ? (drawnStart.arcM <= drawnEnd.arcM ? drawnEnd : drawnStart)
    : drawnEnd;
  const crossingCount = countInteriorRouteCrossings(raw, route);
  const projectionAmbiguous = raw.length >= 2 && (
    isProjectionAmbiguous(raw[0], route, input.viewport)
      || isProjectionAmbiguous(raw[raw.length - 1], route, input.viewport)
  );
  const bothAttached = !!drawnStart && !!drawnEnd
    && drawnStart.distanceM <= ENDPOINT_LIMIT_M
    && drawnEnd.distanceM <= ENDPOINT_LIMIT_M;
  const oneAttached = !!drawnStart && !!drawnEnd
    && (drawnStart.distanceM <= ENDPOINT_LIMIT_M || drawnEnd.distanceM <= ENDPOINT_LIMIT_M);
  const intervalM = orderedStart && orderedEnd ? orderedEnd.arcM - orderedStart.arcM : 0;
  // Interior crossings are evidence about the shape being replaced, not new
  // attachment boundaries. Ambiguity belongs to the ordered endpoint
  // occurrence resolver; once S/T are unique, their complete interval wins.
  const ambiguous = raw.length < 2 || route.length < 2 || projectionAmbiguous
    || (bothAttached && intervalM < 5);

  const rawShape = shapeStats(raw);
  const chord = raw.length >= 2 ? [raw[0], raw[raw.length - 1]] : raw;
  const rawToChord = deviationMetrics(chord, raw);
  const rawLength = routeDrawingLengthM(raw);
  const straightToleranceM = Math.max(
    2.5,
    Math.min(rawLength * 0.12, metersPerPixel(input.viewport.center.lat, input.viewport.zoom) * 6),
  );
  const clearlyStraight = raw.length >= 2
    && rawToChord.max <= straightToleranceM
    && rawShape.maxTurnDeg < 48
    && rawShape.reversals === 0;

  let intent: RouteDrawingIntent;
  if (ambiguous || (!bothAttached && !oneAttached)) intent = 'ambiguous';
  else if (!bothAttached && oneAttached) intent = 'extension';
  else if (clearlyStraight) intent = 'straight-replacement';
  else if (rawShape.sharpTurns > 0 || rawShape.reversals > 0) intent = 'intentional-turn';
  else intent = 'shaped-replacement';

  if (intent === 'ambiguous' || intent === 'extension' || !orderedStart || !orderedEnd) {
    reasons.push(
      intent === 'extension'
        ? 'Only one attachment is clear; the current Route editor preserves the original until an ordered replacement interval exists.'
        : 'Attachment intent is ambiguous; the original Route is preserved.',
    );
    const rawMetrics = raw.length >= 2 ? metricsFor(raw, raw, input.viewport) : emptyMetrics(input.viewport);
    const preservedInterval = orderedStart && orderedEnd
      ? baselineSlice(route, orderedStart.arcM, orderedEnd.arcM)
      : route;
    const renderedVsInputMetrics = raw.length >= 2 && preservedInterval.length >= 2
      ? metricsFor(raw, preservedInterval, input.viewport)
      : emptyMetrics(input.viewport);
    const finalMetrics = route.length >= 2 ? metricsFor(route, route, input.viewport) : emptyMetrics(input.viewport);
    return {
      status: 'preserved',
      intent,
      selectionSource: 'original-preserved',
      reasons,
      divergenceStage: projectionAmbiguous ? 'attachment' : 'projection',
      attachments: { drawnStart, drawnEnd, orderedStart, orderedEnd, crossingCount, ambiguous: true },
      rawStroke: raw,
      stabilizedStroke: raw,
      providerGeometry: provider,
      selectedReplacement: [],
      finalGeometry: route.slice(),
      // `selected` always measures the geometry the person will actually see
      // over the edited interval. For a safety-preserved result that is the
      // old Route interval, not the raw stroke itself.
      metrics: { raw: rawMetrics, provider: provider ? metricsFor(raw, provider, input.viewport) : null, selected: renderedVsInputMetrics, final: finalMetrics },
    };
  }

  const stabilized = stabilizeStroke(
    raw,
    orderedStart,
    orderedEnd,
    input.viewport,
    intent === 'straight-replacement',
  );
  const seam = {
    before: routePointBefore(route, orderedStart),
    start: orderedStart.point,
    end: orderedEnd.point,
    after: routePointAfter(route, orderedEnd),
  };
  const rawMetrics = metricsFor(raw, raw, input.viewport, seam);
  const providerOriented = provider ? orientToRoute(provider, orderedStart, orderedEnd) : null;
  const providerMetrics = providerOriented ? metricsFor(raw, providerOriented, input.viewport, seam) : null;

  let selected = stabilized;
  let selectionSource: DrawingSelectionSource = 'drawn-intent';
  let divergenceStage: RouteDrawingDecision['divergenceStage'] = null;
  if (providerOriented && providerMetrics) {
    const allowedDeviationM = Math.max(
      10,
      Math.min(rawLength * 0.18, metersPerPixel(input.viewport.center.lat, input.viewport.zoom) * 12),
    );
    const addedTurns = providerMetrics.sharpTurns - rawShape.sharpTurns;
    const providerFaithful = providerMetrics.maxDeviationM <= allowedDeviationM
      && providerMetrics.pathLengthInflation <= 1.35
      && providerMetrics.spikes <= rawShape.spikes
      && providerMetrics.reversals <= rawShape.reversals
      && addedTurns <= 0
      && (intent !== 'intentional-turn' || providerMetrics.sharpTurns >= rawShape.sharpTurns);
    const straightProviderFaithful = intent !== 'straight-replacement'
      || (providerMetrics.maxTurnDeg < 48 && providerMetrics.sharpTurns === 0);
    if (providerFaithful && straightProviderFaithful) {
      selected = providerOriented.slice();
      selected[0] = orderedStart.point;
      selected[selected.length - 1] = orderedEnd.point;
      selected = removeNearDuplicates(selected);
      selectionSource = 'provider';
      reasons.push('Provider geometry stayed within the drawn intent envelope and was accepted.');
    } else {
      divergenceStage = 'provider';
      if (providerMetrics.maxDeviationM > allowedDeviationM) reasons.push('Provider moved too far from the finger stroke.');
      if (providerMetrics.pathLengthInflation > 1.35) reasons.push('Provider added a material detour.');
      if (providerMetrics.spikes > rawShape.spikes || providerMetrics.reversals > rawShape.reversals) reasons.push('Provider introduced a spike or reversal.');
      if (addedTurns > 0 || !straightProviderFaithful) reasons.push('Provider introduced an unexplained sharp turn.');
      if (intent === 'intentional-turn' && providerMetrics.sharpTurns < rawShape.sharpTurns) reasons.push('Provider removed a deliberate turn.');
      reasons.push('The stabilized finger stroke was used instead.');
    }
  } else {
    reasons.push('No usable provider geometry was available; the stabilized finger stroke was used.');
  }

  const finalGeometry = spliceAtDrawnInterval(route, orderedStart, orderedEnd, selected);
  const selectedMetrics = metricsFor(raw, selected, input.viewport, seam);
  const finalMetrics = metricsFor(route, finalGeometry, input.viewport, seam);
  const finalShape = shapeStats(finalGeometry);
  if (finalShape.spikes > shapeStats(route).spikes + rawShape.spikes) {
    // This should be unreachable with exact drawn anchors, but keeping it an
    // explainable safety gate makes a future merge regression non-destructive.
    reasons.push('The merged result introduced an unexplained spike; the original Route was preserved.');
    return {
      status: 'preserved',
      intent,
      selectionSource: 'original-preserved',
      reasons,
      divergenceStage: 'merge',
      attachments: { drawnStart, drawnEnd, orderedStart, orderedEnd, crossingCount, ambiguous: false },
      rawStroke: raw,
      stabilizedStroke: stabilized,
      providerGeometry: provider,
      selectedReplacement: selected,
      finalGeometry: route.slice(),
      metrics: { raw: rawMetrics, provider: providerMetrics, selected: selectedMetrics, final: metricsFor(route, route, input.viewport, seam) },
    };
  }

  if (intent === 'straight-replacement') reasons.unshift('The stroke clearly bypasses the old bend, so the ordered interval is replaced by a straight user-intended path.');
  else if (intent === 'intentional-turn') reasons.unshift('The stroke contains a deliberate turn, so its shape is preserved.');
  else reasons.unshift('The ordered Route interval is replaced by the stabilized drawn shape.');

  return {
    status: 'accepted',
    intent,
    selectionSource,
    reasons,
    divergenceStage,
    attachments: { drawnStart, drawnEnd, orderedStart, orderedEnd, crossingCount, ambiguous: false },
    rawStroke: raw,
    stabilizedStroke: stabilized,
    providerGeometry: provider,
    selectedReplacement: selected,
    finalGeometry,
    metrics: { raw: rawMetrics, provider: providerMetrics, selected: selectedMetrics, final: finalMetrics },
  };
}

/** Compose several independently classified strokes against one immutable
 * original Route. Attachment intervals, never provider landing points, own
 * ordering and replacement. Validation should reject overlaps before this
 * function; an overlap encountered here is preserved rather than guessed. */
export function composeRouteDrawingDecisions(
  originalRoute: LngLat[],
  decisions: RouteDrawingDecision[],
): LngLat[] {
  const accepted = decisions.flatMap(decision => {
    const start = decision.attachments.orderedStart;
    const end = decision.attachments.orderedEnd;
    return decision.status === 'accepted' && start && end && decision.selectedReplacement.length >= 2
      ? [{ start, end, replacement: decision.selectedReplacement }]
      : [];
  }).sort((left, right) => left.start.arcM - right.start.arcM);
  if (accepted.length === 0) return originalRoute.slice();
  const total = routeDrawingLengthM(originalRoute);
  const out: LngLat[] = [];
  let cursor = 0;
  for (const item of accepted) {
    if (item.start.arcM < cursor - 0.5) continue;
    appendUnique(out, baselineSlice(originalRoute, cursor, item.start.arcM));
    appendUnique(out, item.replacement);
    cursor = item.end.arcM;
  }
  appendUnique(out, baselineSlice(originalRoute, cursor, total));
  return removeNearDuplicates(out);
}

/**
 * The pre-O81 behavior cut the original Route where the provider happened to
 * land. Replay uses this comparator to make the sharp-corner root cause
 * visible beside the intent-aware result; production never calls it.
 */
export function resolveProviderOwnedLegacyGeometry(input: ResolveRouteDrawingInput): LngLat[] {
  const provider = input.providerGeometry;
  if (!provider || provider.length < 2 || input.originalRoute.length < 2) return input.originalRoute.slice();
  const first = projectPointOntoBaseline(provider[0], input.originalRoute);
  const last = projectPointOntoBaseline(provider[provider.length - 1], input.originalRoute);
  if (!first || !last) return input.originalRoute.slice();
  const start = Math.min(first.arc, last.arc);
  const end = Math.max(first.arc, last.arc);
  const oriented = first.arc <= last.arc ? provider : provider.slice().reverse();
  const out: LngLat[] = [];
  appendUnique(out, baselineSlice(input.originalRoute, 0, start));
  appendUnique(out, oriented);
  appendUnique(out, baselineSlice(input.originalRoute, end, routeDrawingLengthM(input.originalRoute)));
  return removeNearDuplicates(out);
}
