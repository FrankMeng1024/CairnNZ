export interface ActivityPresentationIdentityPoint {
  lat: number;
  lng: number;
  t?: number;
  segmentId?: string;
  observationId?: string;
  clientActivityId?: string;
  ownerGeneration?: string;
  rawOrdinal?: number;
}

export interface ActivityPresentationIdentity {
  key: string;
  durable: boolean;
  sourceFingerprint: string;
}

function finiteNumber(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : '__missing';
}

/**
 * Stable activity scope for display state. A partial owner tuple is not enough
 * to authorize reuse: both the immutable Activity id and owner generation are
 * required. Legacy points therefore stay conservatively unscoped.
 */
export function activityPresentationScopeKey(
  points: ReadonlyArray<ActivityPresentationIdentityPoint>,
): string | null {
  const latest = points.at(-1);
  return latest?.clientActivityId && latest.ownerGeneration
    ? `${latest.clientActivityId}\u0001${latest.ownerGeneration}`
    : null;
}

/**
 * Identity for presentation reconciliation only. Durable observation identity
 * wins. Legacy fallback deliberately includes segment, time, coordinates and
 * current occurrence index; it supports an exact clone without merging two
 * uncertain observations or carrying state across an unproven reconstruction.
 */
export function activityPresentationIdentity(
  point: ActivityPresentationIdentityPoint,
  occurrenceIndex: number,
): ActivityPresentationIdentity {
  const scope = point.clientActivityId && point.ownerGeneration
    ? `${point.clientActivityId}\u0001${point.ownerGeneration}`
    : '__unscoped';
  const segment = point.segmentId ?? '__legacy-segment';
  let key: string;
  let durable = false;
  if (point.observationId) {
    key = `${scope}\u0001${segment}\u0001observation\u0001${point.observationId}`;
    durable = true;
  } else if (
    point.clientActivityId
    && point.ownerGeneration
    && Number.isFinite(point.rawOrdinal)
  ) {
    key = `${scope}\u0001${segment}\u0001raw\u0001${Number(point.rawOrdinal)}`;
    durable = true;
  } else if (Number.isFinite(point.rawOrdinal) && point.segmentId) {
    key = `${scope}\u0001${segment}\u0001legacy-raw\u0001${Number(point.rawOrdinal)}`;
  } else {
    key = [
      scope,
      segment,
      'legacy-exact',
      finiteNumber(point.t),
      point.lat.toPrecision(15),
      point.lng.toPrecision(15),
      String(occurrenceIndex),
    ].join('\u0001');
  }
  return {
    key,
    durable,
    sourceFingerprint: [
      scope,
      segment,
      finiteNumber(point.t),
      finiteNumber(point.rawOrdinal),
      point.lat.toPrecision(15),
      point.lng.toPrecision(15),
    ].join('\u0001'),
  };
}

export function sameActivityPresentationPoint(
  left: ActivityPresentationIdentityPoint | undefined,
  right: ActivityPresentationIdentityPoint | undefined,
  occurrenceIndex: number,
): boolean {
  if (!left || !right) return false;
  const leftIdentity = activityPresentationIdentity(left, occurrenceIndex);
  const rightIdentity = activityPresentationIdentity(right, occurrenceIndex);
  return leftIdentity.key === rightIdentity.key
    && leftIdentity.sourceFingerprint === rightIdentity.sourceFingerprint;
}
