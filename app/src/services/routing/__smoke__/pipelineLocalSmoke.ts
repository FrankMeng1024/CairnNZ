/**
 * Local E2E pipeline test simulating Shanghai 0.7km route in dense urban
 * grid. Reproduces user telemetry id=4 shape (5843 ways, 742 junctions
 * in extractor) and runs through buildTrailGraphFromMapbox +
 * computeRouteNodeAnchors to see where junctions die before reaching
 * the anchor list.
 *
 * Run: cd app && npx tsx src/services/routing/__tests__/pipelineLocalSmoke.ts
 *  (or rename to .test.ts to integrate with jest)
 */
import { buildTrailGraphFromMapbox } from '../mapbox/buildTrailGraphFromMapbox';
import { computeRouteNodeAnchors } from '../routeNodeAnchors';
import type { ExtractResult, MapboxWay } from '../mapbox/MapboxJunctionExtractor';

// Build a synthetic city grid: 50 east-west streets × 50 north-south
// streets crossing on a 100m grid, centered on Shanghai CAOJIADU
// (121.434, 31.232). Each crossing is a real junction.
//
// 50 × 50 = 2500 junctions. Each EW street crosses 50 NS streets = 50
// segments. Each NS street same. So 50 EW + 50 NS = 100 streets, but
// we split each at every junction → 50 streets × 50 segments = 2500
// "ways". Combined with diagonal sidewalks/back-alleys ≈ 5800 ways
// matching telemetry.
function buildCityGrid(): MapboxWay[] {
  const ways: MapboxWay[] = [];
  const ORIGIN_LNG = 121.434;
  const ORIGIN_LAT = 31.232;
  const STEP_DEG = 0.001;          // ~111m N-S, ~95m E-W at this lat
  const GRID = 50;

  // East-west streets, each split into GRID segments.
  for (let row = 0; row < GRID; row++) {
    const lat = ORIGIN_LAT + row * STEP_DEG;
    for (let col = 0; col < GRID - 1; col++) {
      const lng0 = ORIGIN_LNG + col * STEP_DEG;
      const lng1 = ORIGIN_LNG + (col + 1) * STEP_DEG;
      ways.push({
        id: `ew_r${row}_c${col}`,
        klass: 'street',
        coords: [
          { lng: lng0, lat },
          { lng: (lng0 + lng1) / 2, lat },
          { lng: lng1, lat },
        ],
      });
    }
  }
  // North-south streets, same.
  for (let col = 0; col < GRID; col++) {
    const lng = ORIGIN_LNG + col * STEP_DEG;
    for (let row = 0; row < GRID - 1; row++) {
      const lat0 = ORIGIN_LAT + row * STEP_DEG;
      const lat1 = ORIGIN_LAT + (row + 1) * STEP_DEG;
      ways.push({
        id: `ns_c${col}_r${row}`,
        klass: 'street',
        coords: [
          { lng, lat: lat0 },
          { lng, lat: (lat0 + lat1) / 2 },
          { lng, lat: lat1 },
        ],
      });
    }
  }
  // Add ~800 short alleys & footways to push count to ~5800.
  for (let i = 0; i < 800; i++) {
    const baseRow = (i * 7) % (GRID - 1);
    const baseCol = (i * 11) % (GRID - 1);
    const lng = ORIGIN_LNG + baseCol * STEP_DEG;
    const lat = ORIGIN_LAT + baseRow * STEP_DEG;
    ways.push({
      id: `alley_${i}`,
      klass: 'service',
      coords: [
        { lng, lat },
        { lng: lng + STEP_DEG / 2, lat: lat + STEP_DEG / 2 },
      ],
    });
  }
  return ways;
}

function main() {
  const t0 = Date.now();
  const ways = buildCityGrid();
  console.log('grid ways:', ways.length);

  const extract: ExtractResult = {
    ok: true,
    junctions: [],
    ways,
    diagnostics: {
      rawFeatureCount: 382,
      rawVertexCount: ways.reduce((s, w) => s + w.coords.length, 0),
      extractMs: 306,
      bboxArea: 0.001,
    },
  };
  console.log('rawVertexCount:', extract.diagnostics.rawVertexCount);

  const t1 = Date.now();
  let graph;
  try {
    graph = buildTrailGraphFromMapbox(extract);
  } catch (e: any) {
    console.error('buildTrailGraph THREW:', e?.name, e?.message);
    return;
  }
  const t2 = Date.now();
  console.log(`buildTrailGraph: ${t2 - t1}ms, nodes=${graph.nodes.size} truncated=${graph.truncated}`);

  // Degree histogram
  const degHist: Record<number, number> = {};
  for (const n of graph.nodes.values()) {
    const d = n.edges.length;
    degHist[d] = (degHist[d] ?? 0) + 1;
  }
  console.log('degHist:', degHist);

  // Synthesize a 0.7km route along EW street row 25 from col 5 to col 12.
  // Route runs ON the actual road centerline (every junction is on the path).
  const ORIGIN_LNG = 121.434;
  const ORIGIN_LAT = 31.232;
  const STEP_DEG = 0.001;
  const ROUTE_LAT = ORIGIN_LAT + 25 * STEP_DEG;
  const route: { lng: number; lat: number }[] = [];
  for (let col = 5; col <= 12; col++) {
    route.push({ lng: ORIGIN_LNG + col * STEP_DEG, lat: ROUTE_LAT });
    // intermediate GPS samples between junctions
    if (col < 12) {
      for (let s = 1; s < 5; s++) {
        route.push({
          lng: ORIGIN_LNG + col * STEP_DEG + (s / 5) * STEP_DEG,
          lat: ROUTE_LAT,
        });
      }
    }
  }
  console.log('route GPS points:', route.length);
  console.log('route should pass through junctions at row=25, col=5..12');

  // Sample 5 graph nodes near the route to see their actual lat/lng:
  console.log('--- graph nodes near route midpoint ---');
  const targetLng = ORIGIN_LNG + 8.5 * STEP_DEG;
  const targetLat = ROUTE_LAT;
  console.log(`target lng=${targetLng.toFixed(5)} lat=${targetLat.toFixed(5)}`);
  let nearest: Array<{ id: string; dist: number; lng: number; lat: number; deg: number }> = [];
  for (const [id, meta] of graph.meta) {
    if (id === 'tnTRUNC') continue;
    const dLat = (meta.lat - targetLat) * 111000;
    const dLng = (meta.lng - targetLng) * 111000 * Math.cos((targetLat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    const node = graph.nodes.get(id);
    nearest.push({ id, dist, lng: meta.lng, lat: meta.lat, deg: node?.edges.length ?? 0 });
  }
  nearest.sort((a, b) => a.dist - b.dist);
  for (const n of nearest.slice(0, 10)) {
    console.log(`  ${n.id} dist=${n.dist.toFixed(1)}m  ${n.lng.toFixed(5)},${n.lat.toFixed(5)} deg=${n.deg}`);
  }
  // Lat histogram across all graph nodes
  const latHist: Record<string, number> = {};
  for (const meta of graph.meta.values()) {
    const k = meta.lat.toFixed(3);
    latHist[k] = (latHist[k] ?? 0) + 1;
  }
  const latKeys = Object.keys(latHist).sort();
  console.log('--- lat distribution across all graph nodes ---');
  for (const k of latKeys.slice(0, 30)) {
    console.log(`  lat=${k}  count=${latHist[k]}`);
  }
  console.log(`  ... (${latKeys.length} distinct lat bands)`);

  const t3 = Date.now();
  const anchors = computeRouteNodeAnchors({
    workingPoints: route,
    originalPoints: route,
    trailGraph: graph,
  });
  const t4 = Date.now();
  console.log(`computeRouteNodeAnchors: ${t4 - t3}ms, anchors=${anchors.length}`);

  const intersections = anchors.filter(a => a.kind === 'intersection');
  console.log(`  endpoints: ${anchors.filter(a => a.kind.startsWith('endpoint')).length}`);
  console.log(`  intersections: ${intersections.length}`);
  console.log(`  trim-restore: ${anchors.filter(a => a.kind.startsWith('trim-restore')).length}`);
  if (intersections.length > 0) {
    console.log('  first 5 intersections:');
    intersections.slice(0, 5).forEach(a => {
      console.log(`    ${a.id} @ ${a.lng.toFixed(5)},${a.lat.toFixed(5)}`);
    });
  }

  console.log(`TOTAL: ${Date.now() - t0}ms`);
}

main();
