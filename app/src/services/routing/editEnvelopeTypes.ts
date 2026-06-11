/**
 * Wire-form types for the EditEnvelope server response.
 *
 * The envelope is a server-precomputed graph of road junctions and ways
 * within ~1.5km of a route, built by backend mvtEnvelopeBuilder using
 * Mapbox Vector Tiles. App fetches it on edit-mode entry and skips the
 * on-device extractor.
 *
 * v224 — Sprint MVT-Envelope.
 */

export interface EnvelopeWay {
  /** Stable id: `way_<z>_<x>_<y>_<featureId>_<ringIdx>` from the MVT. */
  id: string;
  /** Densified vertices in WGS-84 lng/lat. */
  coords: Array<{ lng: number; lat: number }>;
  /** Mapbox Streets v8 `class` (street, path, service, etc). */
  klass?: string;
}

export interface EnvelopeJunction {
  /** Stable id: `j_<lng5>_<lat5>` — survives regenerations. */
  id: string;
  lng: number;
  lat: number;
  /** Number of unique ways meeting at this point (≥3). */
  degree: number;
  /** Way ids meeting here (capped to 12). */
  wayIds: string[];
}

export interface EditEnvelope {
  version: 1;
  routeId: string;
  bbox: { west: number; south: number; east: number; north: number };
  padKm: number;
  source: 'mapbox-mvt';
  generatedAt: number;
  generatorV: number;
  ways: EnvelopeWay[];
  junctions: EnvelopeJunction[];
  diagnostics?: {
    rawFeatureCount?: number;
    rawVertexCount?: number;
    extractMs?: number;
    bboxAreaKm2?: number;
    waysAfterSubsample?: number;
    waysSubsampled?: boolean;
    tilesRequested?: number;
    tilesTotal?: number;
  };
}

/**
 * Validate basic envelope schema invariants. Returns null on first problem.
 */
export function validateEnvelope(env: any): EditEnvelope | null {
  if (!env || typeof env !== 'object') return null;
  if (env.version !== 1) return null;
  if (!env.bbox || typeof env.bbox.west !== 'number') return null;
  if (!Array.isArray(env.ways) || !Array.isArray(env.junctions)) return null;
  return env as EditEnvelope;
}
