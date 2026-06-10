/**
 * buildTrailGraphFromMapbox — adapter from MapboxJunctionExtractor output to
 * a TrailGraph instance.
 *
 * Why this exists: TrailGraph already does densify + union-find junction
 * merge with a 30m radius and a MAX_GRAPH_NODES = 500 truncation cap. Re-using
 * it costs ~15 LOC vs ~300 LOC of bespoke graph-building code, and downstream
 * consumers (Dijkstra in candidateNodes, snap-to-graph in routeNodeAnchors)
 * stay completely unchanged.
 *
 * The MapboxJunction list returned by the extractor is informational only —
 * the actual edit-mode decisions all flow through TrailGraph.
 *
 * Sprint Mapbox-Migration §1.4.
 */

import { TrailGraph } from '../graph/TrailGraph';
import type { DOCTrailFeature } from '../doctrails/DOCTrailsTypes';
import type { ExtractResult } from './MapboxJunctionExtractor';

/**
 * Convert MapboxJunctionExtractor output into a TrailGraph by synthesising
 * the DOCTrailFeature shape that TrailGraph.fromTrails already accepts.
 *
 * The synthesised features are pure adapters — they never reach disk, never
 * hit the DOC ArcGIS network, and exist only in-process for the duration of
 * one buildEditContext call.
 */
export function buildTrailGraphFromMapbox(extract: ExtractResult): TrailGraph {
  const trails: DOCTrailFeature[] = extract.ways.map(w => ({
    trackId: w.id,
    name: `mb-${w.klass}-${w.id}`,
    objectType: w.klass,
    geometry: {
      type: 'LineString' as const,
      coordinates: w.coords.map(c => [c.lng, c.lat]),
    },
  }));
  return TrailGraph.fromTrails(trails);
}
