import {
  bboxClip,
  booleanPointInPolygon,
  multiPolygon,
  point,
  pointOnFeature,
} from '@turf/turf';
import type { MultiPolygon } from 'geojson';

export type MemoryCityCoverageSource = {
  source: 'mine' | 'friends';
  sourceId: string;
  regionId: string;
  regionAnchor?: [number, number] | null;
  geometry: MultiPolygon;
};

export type MemoryCityCameraTarget = {
  center: [number, number];
  source: 'mine' | 'friends';
  sourceId: string;
  zoom: number;
};

function finiteCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function coordinateInsideBbox(
  coordinate: [number, number],
  bbox: [number, number, number, number],
): boolean {
  return coordinate[0] >= bbox[0] && coordinate[0] <= bbox[2]
    && coordinate[1] >= bbox[1] && coordinate[1] <= bbox[3];
}

/**
 * Resolve a point that is visibly inside privacy-safe prepared coverage.
 * A region centroid is not sufficient: it can fall outside a concave shape,
 * and Friends region anchors are deliberately coarse rather than raw GPS.
 */
export function visibleCoverageAnchor(
  geometry: MultiPolygon,
  bbox: [number, number, number, number],
  preferred?: [number, number] | null,
): [number, number] | null {
  const geometryFeature = multiPolygon(geometry.coordinates);
  if (preferred
    && finiteCoordinate(preferred)
    && coordinateInsideBbox(preferred, bbox)
    && booleanPointInPolygon(point(preferred), geometryFeature)) {
    return preferred;
  }
  try {
    const clipped = bboxClip(geometryFeature, bbox);
    if (clipped.geometry.coordinates.length === 0) return null;
    const candidate = pointOnFeature(clipped).geometry.coordinates;
    if (!finiteCoordinate(candidate)) return null;
    const center: [number, number] = [Number(candidate[0]), Number(candidate[1])];
    return coordinateInsideBbox(center, bbox)
      && booleanPointInPolygon(point(center), geometryFeature)
      ? center
      : null;
  } catch {
    return null;
  }
}

/** Mine always wins. Friend sources are sorted so the same authorized input
 * always chooses the same visible cluster, independent of object insertion. */
export function resolveMemoryCityCameraTarget(input: {
  cityId: string;
  bbox: [number, number, number, number];
  sources: MemoryCityCoverageSource[];
}): MemoryCityCameraTarget | null {
  const candidates = input.sources
    .filter(source => source.regionId === input.cityId)
    .sort((left, right) => {
      if (left.source !== right.source) return left.source === 'mine' ? -1 : 1;
      return left.sourceId.localeCompare(right.sourceId);
    });
  for (const candidate of candidates) {
    const center = visibleCoverageAnchor(
      candidate.geometry,
      input.bbox,
      candidate.source === 'mine' ? candidate.regionAnchor : null,
    );
    if (!center) continue;
    return {
      center,
      source: candidate.source,
      sourceId: candidate.sourceId,
      zoom: 14,
    };
  }
  return null;
}
