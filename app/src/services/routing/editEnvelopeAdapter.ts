/**
 * editEnvelopeAdapter — convert server EditEnvelope into the shapes the
 * existing on-device editing pipeline expects.
 *
 * v234 fix: STOP feeding envelope.ways through buildTrailGraphFromMapbox.
 * That function does a 30m union-find merge that destroyed the precise
 * server-side junction coordinates, leaving anchors offset from the
 * actual road centerline. The server envelope already contains the
 * curated junction list (`env.junctions`). We just need to turn each
 * junction into a TrailGraph node directly. No densify, no union-find,
 * no merging.
 */
import { TrailGraph } from './graph/TrailGraph';
import { PointCloudIndex, IndexedPoint } from './corridor/PointCloudIndex';
import type { LngLat } from './corridor/PolylineSampler';
import type { EditEnvelope } from './editEnvelopeTypes';

export interface AdaptedEnvelope {
  trailGraph: TrailGraph;
  walkedIndex: PointCloudIndex;
}

/**
 * Adapt a server envelope + the route's originalPoints into the
 * { trailGraph, walkedIndex } pair that useRouteEditStore.beginEdit
 * accepts.
 *
 * Direct construction:
 *   - Each `env.junctions[i]` becomes a graph node at its real lng/lat.
 *   - Edges between same-way junctions are inferred from `wayIds`.
 *   - No vertex merge, no truncation cap.
 *
 * walkedIndex still includes originalPoints + dedup'd way vertices so
 * corridor enforcement keeps working.
 */
export function adaptEnvelope(
  env: EditEnvelope,
  originalPoints: LngLat[],
  routeId: string,
): AdaptedEnvelope {
  const trailGraph = new TrailGraph();

  // Step 1: each junction becomes a graph node at its real coord
  for (const j of env.junctions) {
    trailGraph.nodes.set(j.id, { id: j.id, edges: [] });
    trailGraph.meta.set(j.id, {
      id: j.id,
      lng: j.lng,
      lat: j.lat,
      trailIds: j.wayIds.slice(),
    });
  }

  // Step 2: edges. Two junctions are connected if they share a wayId.
  // Edge weight = haversine distance between them.
  const wayToJunctions = new Map<string, string[]>();
  for (const j of env.junctions) {
    for (const wid of j.wayIds) {
      let list = wayToJunctions.get(wid);
      if (!list) {
        list = [];
        wayToJunctions.set(wid, list);
      }
      list.push(j.id);
    }
  }
  function haversineM(a: LngLat, b: LngLat): number {
    const R = 6_371_000;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  for (const [, jids] of wayToJunctions) {
    for (let i = 0; i < jids.length; i++) {
      for (let k = i + 1; k < jids.length; k++) {
        const a = trailGraph.meta.get(jids[i]);
        const b = trailGraph.meta.get(jids[k]);
        if (!a || !b) continue;
        const w = haversineM(a, b);
        const ne = trailGraph.nodes.get(jids[i]);
        const ne2 = trailGraph.nodes.get(jids[k]);
        if (ne && !ne.edges.find(e => e.to === jids[k])) {
          ne.edges.push({ to: jids[k], weight: w });
        }
        if (ne2 && !ne2.edges.find(e => e.to === jids[i])) {
          ne2.edges.push({ to: jids[i], weight: w });
        }
      }
    }
  }

  // Step 3: corridor index for drag enforcement.
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
        source: 'doc' as const,
        refId: `env:${w.id}:${i}`,
      });
    }
  }

  return {
    trailGraph,
    walkedIndex: new PointCloudIndex(indexedPoints),
  };
}

