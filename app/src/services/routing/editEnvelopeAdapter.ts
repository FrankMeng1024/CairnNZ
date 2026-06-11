/**
 * editEnvelopeAdapter — convert server EditEnvelope into the shapes the
 * existing on-device editing pipeline expects.
 *
 * Goal: zero changes to TrailGraph, Dijkstra, candidateNodes, routeNodeAnchors,
 * useRouteEditStore. We fan the envelope into:
 *   - a TrailGraph (via existing buildTrailGraphFromMapbox)
 *   - a PointCloudIndex of corridor anchor points
 *
 * v224 — Sprint MVT-Envelope.
 */
import { TrailGraph } from './graph/TrailGraph';
import { PointCloudIndex, IndexedPoint } from './corridor/PointCloudIndex';
import { buildTrailGraphFromMapbox } from './mapbox/buildTrailGraphFromMapbox';
import type { LngLat } from './corridor/PolylineSampler';
import type { EditEnvelope } from './editEnvelopeTypes';
import type { ExtractResult, MapboxWay } from './mapbox/MapboxJunctionExtractor';

/**
 * Synthesize an ExtractResult-shaped object from an envelope so we can
 * reuse buildTrailGraphFromMapbox unchanged.
 */
function envelopeToExtractResult(env: EditEnvelope): ExtractResult {
  const ways: MapboxWay[] = env.ways.map(w => ({
    id: w.id,
    klass: w.klass || 'street',
    coords: w.coords,
  }));
  return {
    ok: true,
    junctions: env.junctions.map(j => ({
      id: j.id,
      lng: j.lng,
      lat: j.lat,
      degree: j.degree,
      wayFeatureIds: j.wayIds,
    })),
    ways,
    diagnostics: {
      rawFeatureCount: env.diagnostics?.rawFeatureCount ?? 0,
      rawVertexCount: env.diagnostics?.rawVertexCount ?? 0,
      extractMs: env.diagnostics?.extractMs ?? 0,
      bboxArea:
        (env.bbox.east - env.bbox.west) * (env.bbox.north - env.bbox.south),
    },
  };
}

export interface AdaptedEnvelope {
  trailGraph: TrailGraph;
  walkedIndex: PointCloudIndex;
}

/**
 * Adapt a server envelope + the route's originalPoints into the
 * { trailGraph, walkedIndex } pair that useRouteEditStore.beginEdit
 * accepts.
 *
 * - trailGraph: synthesized from envelope ways (corridor culled
 *   server-side already).
 * - walkedIndex: kdbush over originalPoints + envelope way vertices,
 *   deduped at 5dp fingerprint to keep size bounded.
 */
export function adaptEnvelope(
  env: EditEnvelope,
  originalPoints: LngLat[],
  routeId: string,
): AdaptedEnvelope {
  const extract = envelopeToExtractResult(env);
  let trailGraph: TrailGraph;
  try {
    trailGraph = buildTrailGraphFromMapbox(extract);
  } catch {
    // even if union-find OOMs (shouldn't with capped envelope), fall back
    // to an empty graph. Caller still gets endpoints and trim anchors.
    trailGraph = new TrailGraph();
  }

  // Build corridor index: originals + dedupe envelope way vertices
  const indexedPoints: IndexedPoint[] = originalPoints.map((p, i) => ({
    lng: p.lng,
    lat: p.lat,
    source: 'original' as const,
    refId: `${routeId}:original:${i}`,
  }));
  const seen = new Set<string>();
  for (const w of env.ways) {
    for (let i = 0; i < w.coords.length; i++) {
      const c = w.coords[i];
      const fp = `${c.lng.toFixed(5)}_${c.lat.toFixed(5)}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      indexedPoints.push({
        lng: c.lng,
        lat: c.lat,
        source: 'doc' as const, // PointSource enum reuse — see PointCloudIndex.ts
        refId: `env:${w.id}:${i}`,
      });
    }
  }

  return {
    trailGraph,
    walkedIndex: new PointCloudIndex(indexedPoints),
  };
}
