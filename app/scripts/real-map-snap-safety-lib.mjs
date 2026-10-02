import { hav, resamplePhysicalSegments, splitPhysicalSegments } from './real-map-snap-evaluation-lib.mjs';

const EARTH = 111_320;
const local = (point, origin) => ({
  x: (point.lng - origin.lng) * EARTH * Math.cos(origin.lat * Math.PI / 180),
  y: (point.lat - origin.lat) * EARTH,
});
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function pointToSegmentDistance(point, left, right) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator <= 1e-9
    ? 0
    : Math.max(0, Math.min(1, ((point.x - left.x) * dx + (point.y - left.y) * dy) / denominator));
  return distance(point, { x: left.x + fraction * dx, y: left.y + fraction * dy });
}

function nearestLineDistanceM(point, line) {
  if (!line?.length) return Infinity;
  if (line.length === 1) return hav(point, line[0]);
  const origin = line[0];
  const target = local(point, origin);
  const projected = line.map(item => local(item, origin));
  let best = Infinity;
  for (let index = 1; index < projected.length; index += 1) {
    best = Math.min(best, pointToSegmentDistance(target, projected[index - 1], projected[index]));
  }
  return best;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function segmentsIntersect(a, b, c, d) {
  return orientation(a, b, c) !== orientation(a, b, d)
    && orientation(c, d, a) !== orientation(c, d, b);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let left = 0, right = polygon.length - 1; left < polygon.length; right = left++) {
    const a = polygon[left];
    const b = polygon[right];
    if (((a.y > point.y) !== (b.y > point.y))
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function edgeCrossesPolygon(edge, polygonCoordinates) {
  const origin = polygonCoordinates[0];
  const polygon = polygonCoordinates.map(point => local(point, origin));
  const left = local(edge.left, origin);
  const right = local(edge.right, origin);
  if (pointInPolygon(left, polygon) || pointInPolygon(right, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (segmentsIntersect(left, right, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  return false;
}

function edgeNearPassage(edge, passage) {
  const midpoint = {
    lat: (edge.left.lat + edge.right.lat) / 2,
    lng: (edge.left.lng + edge.right.lng) / 2,
  };
  return nearestLineDistanceM(midpoint, passage.line) <= (passage.radiusM ?? 4);
}

export function renderedEdges(points, respectSegmentIds = true) {
  const edges = [];
  for (let index = 1; index < (points ?? []).length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const segmentChanged = (left.segmentId ?? 'legacy') !== (right.segmentId ?? 'legacy');
    if (respectSegmentIds && segmentChanged) continue;
    edges.push({ index: index - 1, left, right, crossesDeclaredSegmentBoundary: segmentChanged });
  }
  return edges;
}

function introducedBySelected(edge, localPoints, thresholdM = 1) {
  const midpoint = {
    lat: (edge.left.lat + edge.right.lat) / 2,
    lng: (edge.left.lng + edge.right.lng) / 2,
  };
  return splitPhysicalSegments(localPoints).every(segment => nearestLineDistanceM(midpoint, segment) > thresholdM);
}

function referenceCoverage(reference, selected, thresholdM, referenceFractions = [[0, 1]]) {
  const allReferenceSamples = resamplePhysicalSegments(reference, 5).flat();
  const totalM = allReferenceSamples.at(-1)?.globalDistanceM ?? 0;
  const referenceSamples = allReferenceSamples.filter(point => {
    const fraction = totalM <= 0 ? 0 : point.globalDistanceM / totalM;
    return referenceFractions.some(([start, end]) => fraction >= start && fraction <= end);
  });
  const selectedSegments = splitPhysicalSegments(selected);
  const covered = referenceSamples.filter(point => (
    selectedSegments.some(segment => nearestLineDistanceM(point, segment) <= thresholdM)
  ));
  return referenceSamples.length ? covered.length / referenceSamples.length : null;
}

function orderedReferenceCheckpoints(reference, selected, thresholdM, referenceFractions = [[0, 1]]) {
  const allReferenceSamples = resamplePhysicalSegments(reference, 5).flat();
  const totalM = allReferenceSamples.at(-1)?.globalDistanceM ?? 0;
  const eligible = allReferenceSamples.filter(point => {
    const fraction = totalM <= 0 ? 0 : point.globalDistanceM / totalM;
    return referenceFractions.some(([start, end]) => fraction >= start && fraction <= end);
  });
  if (eligible.length === 0) return null;
  const checkpointCount = Math.min(12, eligible.length);
  const checkpoints = Array.from({ length: checkpointCount }, (_unused, index) => (
    eligible[Math.round(index * (eligible.length - 1) / Math.max(1, checkpointCount - 1))]
  ));
  const selectedSamples = resamplePhysicalSegments(selected, 5).flat();
  let minimumSelectedIndex = 0;
  const matches = checkpoints.map(checkpoint => {
    let best = { selectedIndex: -1, distanceM: Infinity };
    for (let index = minimumSelectedIndex; index < selectedSamples.length; index += 1) {
      const distanceM = hav(checkpoint, selectedSamples[index]);
      if (distanceM < best.distanceM) best = { selectedIndex: index, distanceM };
    }
    const matched = best.selectedIndex >= 0 && best.distanceM <= thresholdM;
    if (matched) minimumSelectedIndex = best.selectedIndex;
    return { matched, ...best };
  });
  const matchedCount = matches.filter(item => item.matched).length;
  return {
    checkpointCount,
    matchedCheckpointCount: matchedCount,
    matchedCheckpointFraction: matchedCount / checkpointCount,
    orderPreserved: matchedCount === checkpointCount,
    maximumCheckpointDeviationM: Math.max(...matches.map(item => item.distanceM)),
  };
}

export function evaluateRouteSafety({
  selected,
  localFinal,
  reference,
  context = {},
  respectSegmentIds = true,
}) {
  const edges = renderedEdges(selected, respectSegmentIds);
  const obstacles = context.obstacles ?? [];
  const validPassages = context.validPassages ?? [];
  const obstacleCrossings = [];
  for (const edge of edges) {
    for (const obstacle of obstacles) {
      if (!edgeCrossesPolygon(edge, obstacle.polygon)) continue;
      const allowed = validPassages.some(passage => edgeNearPassage(edge, passage));
      if (!allowed) {
        obstacleCrossings.push({
          edgeIndex: edge.index,
          obstacleId: obstacle.id,
          introducedVersusLocal: introducedBySelected(edge, localFinal),
        });
      }
    }
  }

  const gapBridgeEdges = edges.filter(edge => edge.crossesDeclaredSegmentBoundary);
  const permittedCorridors = context.permittedCorridors ?? [];
  const competingCorridors = context.competingCorridors ?? [];
  const corridorSamples = resamplePhysicalSegments(selected, 5).flat();
  const outsidePermitted = permittedCorridors.length === 0 ? [] : corridorSamples.filter(point => (
    permittedCorridors.every(corridor => (
      nearestLineDistanceM(point, corridor.line) > (corridor.radiusM ?? 12)
    ))
  ));
  const onCompeting = competingCorridors.length === 0 ? [] : corridorSamples.filter(point => (
    competingCorridors.some(corridor => (
      nearestLineDistanceM(point, corridor.line) <= (corridor.radiusM ?? 8)
    ))
  ));
  const topologyCoverageFraction = reference?.length >= 2
    ? referenceCoverage(
      reference,
      selected,
      context.topologyToleranceM ?? 15,
      context.topologyReferenceFractions ?? [[0, 1]],
    )
    : null;
  const topologyThreshold = context.topologyCoverageThreshold ?? 0.95;
  const orderedCheckpoints = reference?.length >= 2
    ? orderedReferenceCheckpoints(
      reference,
      selected,
      context.topologyToleranceM ?? 15,
      context.topologyReferenceFractions ?? [[0, 1]],
    )
    : null;

  return {
    finalAssembledEdgeCount: edges.length,
    obstacleOrBarrier: obstacles.length === 0
      ? { status: 'NOT_VERIFIED', reason: 'OBSTACLE_GEOMETRY_UNAVAILABLE', crossingCount: null }
      : { status: obstacleCrossings.length === 0 ? 'VERIFIED_CLEAR' : 'FINDING', crossingCount: obstacleCrossings.length, crossings: obstacleCrossings },
    movementGap: {
      status: gapBridgeEdges.length === 0 ? 'VERIFIED_CLEAR' : 'FINDING',
      renderedBridgeEdgeCount: gapBridgeEdges.length,
      respectedSegmentIds: respectSegmentIds,
    },
    corridorIdentity: permittedCorridors.length === 0 || competingCorridors.length === 0
      ? {
        status: 'NOT_VERIFIED',
        reason: 'PERMITTED_AND_COMPETING_CORRIDOR_GEOMETRY_REQUIRED',
        outsidePermittedSampleCount: permittedCorridors.length ? outsidePermitted.length : null,
        competingCorridorSampleCount: competingCorridors.length ? onCompeting.length : null,
      }
      : {
        status: outsidePermitted.length === 0 && onCompeting.length === 0 ? 'VERIFIED_CLEAR' : 'FINDING',
        outsidePermittedSampleCount: outsidePermitted.length,
        competingCorridorSampleCount: onCompeting.length,
      },
    orderedReferenceTopology: topologyCoverageFraction == null || orderedCheckpoints == null
      ? { status: 'NOT_VERIFIED', reason: 'ORDERED_REFERENCE_UNAVAILABLE' }
      : {
        status: topologyCoverageFraction >= topologyThreshold
          && orderedCheckpoints.matchedCheckpointFraction >= topologyThreshold
          && orderedCheckpoints.orderPreserved
          ? 'PARTIAL_REFERENCE_PASS'
          : 'FINDING',
        referenceCoverageFraction: topologyCoverageFraction,
        threshold: topologyThreshold,
        ...orderedCheckpoints,
        limitation: 'Reference coverage checks erased geometry but is not a surveyed connectivity or layer proof.',
      },
  };
}
