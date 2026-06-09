/**
 * DOCTrailsClient — Fetch DOC trail polylines from ArcGIS Feature Service.
 *
 * Endpoint:
 *   https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services/
 *   DOC_Tracks_EAM/FeatureServer/0/query
 *
 * outSR=4326 → server returns WGS84 coords (no proj4js needed client-side).
 *
 * Sprint 66 Wave 2.
 */

import type { BBox, DOCFetchResult, DOCTrailFeature, FeatureCollection } from './DOCTrailsTypes';
import { logDocApiCall } from '../editAnalytics';

const ENDPOINT =
  'https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services/DOC_Tracks_EAM/FeatureServer/0/query';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 200;

export interface DOCFetchOptions {
  timeoutMs?: number;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Fetch DOC trails intersecting the given bbox.
 *
 * Returns { ok: false, transient: true } for retryable errors (timeout, 5xx, 429).
 * Returns { ok: false, transient: false } for permanent errors (4xx, malformed).
 */
export async function fetchDOCTrailsInBbox(
  bbox: BBox,
  options: DOCFetchOptions = {},
): Promise<DOCFetchResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  // v3-audit (ARCH-009): pre-aborted signal returns 'aborted' before
  // setting up fetch (avoids 'timeout' miscategorization in telemetry).
  if (options.signal?.aborted) {
    return { ok: false, error: 'aborted', transient: false, durationMs: 0 };
  }

  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'OBJECTID,TechObjectName,ObjectType',
    returnGeometry: 'true',
    resultRecordCount: String(limit),
    f: 'geojson',
  });

  const ctrl = new AbortController();
  const timeoutHandle = setTimeout(() => ctrl.abort(), timeoutMs);
  // v2-audit (ARCH-011): capture listener so we can removeEventListener
  // on settle. Long-lived parent signals would otherwise accumulate one
  // closure per request.
  const onParentAbort = () => ctrl.abort();
  if (options.signal) {
    options.signal.addEventListener('abort', onParentAbort);
  }
  const detachParentListener = () => {
    if (options.signal) {
      options.signal.removeEventListener('abort', onParentAbort);
    }
  };

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal });
    clearTimeout(timeoutHandle);
    detachParentListener();
    const durationMs = Date.now() - start;
    const bboxArea = bboxAreaKm2(bbox);

    if (res.status === 429) {
      logDocApiCall({ bboxArea, durationMs, featuresReturned: 0, success: false });
      return { ok: false, error: 'rate-limited', transient: true, durationMs };
    }
    if (res.status >= 500) {
      logDocApiCall({ bboxArea, durationMs, featuresReturned: 0, success: false });
      return { ok: false, error: `http-${res.status}`, transient: true, durationMs };
    }
    if (!res.ok) {
      logDocApiCall({ bboxArea, durationMs, featuresReturned: 0, success: false });
      return { ok: false, error: `http-${res.status}`, transient: false, durationMs };
    }

    const data = (await res.json()) as FeatureCollection;
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      logDocApiCall({ bboxArea, durationMs, featuresReturned: 0, success: false });
      return { ok: false, error: 'malformed-response', transient: false, durationMs };
    }

    const trails: DOCTrailFeature[] = data.features
      .filter(f => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'))
      .map(f => ({
        trackId: String(f.properties?.OBJECTID ?? f.properties?.objectid ?? ''),
        name: String(f.properties?.TechObjectName ?? f.properties?.name ?? 'Unnamed'),
        objectType: f.properties?.ObjectType,
        geometry: {
          type: f.geometry.type as 'LineString' | 'MultiLineString',
          coordinates: f.geometry.coordinates,
        },
      }))
      .filter(t => t.trackId);

    logDocApiCall({ bboxArea, durationMs, featuresReturned: trails.length, success: true });
    return { ok: true, trails, cached: false, durationMs };
  } catch (err: any) {
    clearTimeout(timeoutHandle);
    detachParentListener();
    const durationMs = Date.now() - start;
    const bboxArea = bboxAreaKm2(bbox);
    logDocApiCall({ bboxArea, durationMs, featuresReturned: 0, success: false });
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'timeout', transient: true, durationMs };
    }
    return {
      ok: false,
      error: err?.message ?? 'network-error',
      transient: true,
      durationMs,
    };
  }
}

/**
 * Bbox area in km² (rough — for choosing whether to split into multiple queries).
 */
export function bboxAreaKm2(bbox: BBox): number {
  const meanLat = (bbox.north + bbox.south) / 2;
  const widthKm = (bbox.east - bbox.west) * 111 * Math.cos((meanLat * Math.PI) / 180);
  const heightKm = (bbox.north - bbox.south) * 111;
  return Math.abs(widthKm * heightKm);
}
