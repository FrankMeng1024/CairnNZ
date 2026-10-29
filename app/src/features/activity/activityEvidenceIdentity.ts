/**
 * Immutable correlation identity for one qualified Activity observation.
 *
 * `rawOrdinal` is only monotonic inside an Activity ownership generation. It
 * therefore cannot identify evidence on its own (or when combined only with a
 * mutable presentation segment). Keep the complete owner tuple everywhere the
 * observation crosses a process/storage boundary.
 */
export function activityObservationEvidenceId(input: {
  clientActivityId: string;
  ownerGeneration: string;
  rawOrdinal: number;
}): string {
  return [
    'activity-observation-v1',
    encodeURIComponent(input.clientActivityId),
    encodeURIComponent(input.ownerGeneration),
    Math.floor(input.rawOrdinal),
  ].join(':');
}

export interface ActivityEvidencePoint {
  observationId?: string;
  clientActivityId?: string;
  ownerGeneration?: string;
  rawOrdinal?: number;
  segmentId?: string;
  t?: number;
  lat?: number;
  lng?: number;
}

/** Storage/reducer key. Coordinates are a legacy-only fallback and must never
 * be emitted into owner-exportable diagnostic summaries. */
export function activityEvidencePointKey(point: ActivityEvidencePoint): string {
  if (typeof point.observationId === 'string' && point.observationId.length > 0) {
    return point.observationId;
  }
  if (typeof point.clientActivityId === 'string'
    && typeof point.ownerGeneration === 'string'
    && Number.isFinite(point.rawOrdinal)) {
    return activityObservationEvidenceId({
      clientActivityId: point.clientActivityId,
      ownerGeneration: point.ownerGeneration,
      rawOrdinal: Number(point.rawOrdinal),
    });
  }
  if (Number.isFinite(point.rawOrdinal)) {
    // Preserve the pre-O98 storage key so in-flight Memory/frontier intents
    // remain readable. New O98 observations always take the owner-scoped path
    // above; this fallback is only for historical artifacts.
    return `${point.segmentId ?? 'legacy'}:raw:${Number(point.rawOrdinal)}`;
  }
  return `${point.segmentId ?? 'legacy'}:${Math.floor(point.t ?? 0)}:${Number(point.lat).toFixed(7)}:${Number(point.lng).toFixed(7)}`;
}

/** Coordinate-free diagnostic identity for old records without a durable
 * observation id. */
export function activityLedgerEvidenceId(
  point: ActivityEvidencePoint,
  legacyIndex: number,
): string {
  if (typeof point.observationId === 'string' && point.observationId.length > 0) {
    return point.observationId;
  }
  if (typeof point.clientActivityId === 'string'
    && typeof point.ownerGeneration === 'string'
    && Number.isFinite(point.rawOrdinal)) {
    return activityObservationEvidenceId({
      clientActivityId: point.clientActivityId,
      ownerGeneration: point.ownerGeneration,
      rawOrdinal: Number(point.rawOrdinal),
    });
  }
  return `${point.segmentId ?? 'legacy'}:legacy-index:${legacyIndex}`;
}
