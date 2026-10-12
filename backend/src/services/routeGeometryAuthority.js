'use strict';

const COORDINATE_EQUALITY_M = 0.35;

function distanceM(a, b) {
  const radius = 6371000;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const latA = radians(a.lat);
  const latB = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function geometryError(message, code = 'ROUTE_GEOMETRY_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function samePoint(a, b) {
  return a && b && distanceM(a, b) <= COORDINATE_EQUALITY_M
    && (a.alt == null || b.alt == null || Math.abs(Number(a.alt) - Number(b.alt)) <= 0.02);
}

function pathDistanceM(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = distanceM(points[index - 1], points[index]);
    if (!Number.isFinite(segment)) throw geometryError('Route contains an invalid coordinate.');
    total += segment;
  }
  return total;
}

function authorizeOrderedDraft(ownerId, orderedDraft) {
  if (!orderedDraft || typeof orderedDraft !== 'object') throw geometryError('Ordered Route geometry is required.');
  if (String(orderedDraft.ownerId) !== String(ownerId)) throw geometryError('Route draft belongs to another account.', 'ROUTE_DRAFT_OWNER_MISMATCH');
  const parts = Array.isArray(orderedDraft.parts) ? orderedDraft.parts : [];
  const gaps = Array.isArray(orderedDraft.gaps) ? orderedDraft.gaps : [];
  if (parts.length === 0) throw geometryError('Route has no usable sections.');
  const partIds = new Set();
  for (const part of parts) {
    if (!part?.id || partIds.has(part.id)) throw geometryError('Route section identities are invalid.');
    partIds.add(part.id);
    if (!Array.isArray(part.points) || part.points.length < 2) throw geometryError('Every Route section needs at least two points.');
  }
  const gapsAfter = new Set();
  const gapIds = new Set();
  for (const gap of gaps) {
    const index = parts.findIndex(part => part.id === gap?.afterPartId);
    if (!gap?.id || gapIds.has(gap.id) || gapsAfter.has(gap?.afterPartId)
      || index < 0 || index >= parts.length - 1) {
      throw geometryError('Route gap identities or order are invalid.');
    }
    gapIds.add(gap.id);
    gapsAfter.add(gap.afterPartId);
  }
  const points = [];
  let resolvedDistanceM = 0;
  parts.forEach((part, index) => {
    if (index > 0 && !gapsAfter.has(parts[index - 1].id)) {
      const prior = parts[index - 1].points[parts[index - 1].points.length - 1];
      if (!samePoint(prior, part.points[0])) throw geometryError('Continuous Route sections do not share a boundary.');
    }
    part.points.forEach((point, pointIndex) => {
      const previous = points[points.length - 1];
      if (index > 0 && pointIndex === 0 && previous && samePoint(previous, point)) return;
      points.push({ ...point });
    });
    // Each part is factual/planned geometry. A declared unknown gap between
    // parts is deliberately excluded rather than counted as a straight line.
    resolvedDistanceM += pathDistanceM(part.points);
  });
  if (orderedDraft.startPoint && !samePoint(orderedDraft.startPoint, parts[0].points[0])) {
    throw geometryError('Route start does not match its ordered geometry.');
  }
  return {
    points,
    resolutionState: gaps.length > 0 ? 'unresolved_gaps' : 'continuous',
    distanceM: resolvedDistanceM,
  };
}

function authorizeRouteGeometry({ ownerId, points, orderedDraft, resolutionState }) {
  if (!orderedDraft) {
    if (resolutionState === 'unresolved_gaps') {
      throw geometryError('Unresolved Route gaps require ordered geometry.', 'ROUTE_RESOLUTION_MISMATCH');
    }
    return {
      points,
      orderedDraft: null,
      resolutionState: 'continuous',
      distanceM: pathDistanceM(points),
    };
  }
  const derived = authorizeOrderedDraft(ownerId, orderedDraft);
  if (resolutionState && resolutionState !== derived.resolutionState) {
    throw geometryError('Route resolution state does not match its ordered gaps.', 'ROUTE_RESOLUTION_MISMATCH');
  }
  if (!Array.isArray(points) || points.length !== derived.points.length
    || points.some((point, index) => !samePoint(point, derived.points[index]))) {
    throw geometryError('Route points do not match the ordered path.', 'ROUTE_POINTS_MISMATCH');
  }
  return {
    points: derived.points,
    orderedDraft,
    resolutionState: derived.resolutionState,
    distanceM: derived.distanceM,
  };
}

module.exports = {
  COORDINATE_EQUALITY_M,
  authorizeOrderedDraft,
  authorizeRouteGeometry,
};
