/**
 * Internal-only, non-product review projection for the immutable Activity
 * "almost done". The clone lives under a dedicated QA storage key and is
 * never inserted into useSessionStore, pending sync, Memory, or the backend.
 */
import { activitySimulatorBuildCapable } from '../activitySimulator/capability';
import { readPendingReadonly, type PendingHike } from '../../services/pendingSyncStore';
import { storage } from '../../store/storage';
import type { TrackingSession, TrackPoint } from '../../store/useSessionStore';
import { haversineM } from '../../utils/geo';

export const ALMOST_DONE_SOURCE_CLIENT_ID = '99e48b0d-ad87-4aba-a94f-0d033393d0e6';
export const ALMOST_DONE_CLONE_V1_ID = `qa-snap-review:${ALMOST_DONE_SOURCE_CLIENT_ID}:v1`;
export const ALMOST_DONE_CLONE_V1_ROUTE = 'almost-done-v1' as const;

type ServerPoint = PendingHike['payload']['route_points'][number] & {
  alt?: number | null;
  acc?: number | null;
  v_acc?: number | null;
  speed_mps?: number | null;
  course_deg?: number | null;
  raw_ordinal?: number | null;
};

export interface AlmostDoneCloneV1Provenance {
  schemaVersion: 1;
  reviewOnly: true;
  label: 'QA / SNAP REVIEW CLONE';
  cloneId: string;
  sourceClientActivityId: string;
  sourceServerActivityId: 2072;
  sourceRawCount: number;
  sourceCanonicalCount: number;
  selectedCanonicalCount: number;
  displayPointCount: number;
  rawOrdinalsUsedByCanonicalAuthority: number[];
  rawOrdinalsExcludedByCanonicalAuthority: number[];
  impossibleHorizontalAccuracyRawOrdinals: number[];
  stationaryTraversalRemovedRawOrdinals: number[];
  boundedSmoothingRawOrdinals: number[];
  matchedRawOrdinals: number[];
  unmatchedRawOrdinals: number[];
  canonicalFallbackRawOrdinals: number[];
  matchedSubsections: Array<{ rawOrdinalStart: number; rawOrdinalEnd: number }>;
  canonicalFallbackRawOrdinalRanges: Array<[number, number]>;
  negativeVerticalAccuracyRawOrdinals: number[];
  sourceMemoryPointCount: number;
  sideEffectContract: {
    sessionStore: false;
    pendingSync: false;
    backend: false;
    memory: false;
    stats: false;
    gameplay: false;
    social: false;
    analytics: false;
  };
  builtAt: number;
}

export interface AlmostDoneCloneV1 {
  session: TrackingSession;
  provenance: AlmostDoneCloneV1Provenance;
}

const storageKey = (ownerUserId: string) => `cairn_qa_snap_review_clone_v1_${ownerUserId}`;
const stationaryTraversalOrdinals = new Set([10, 11, 12, 13, 14, 225, 226]);

function toTrackPoint(point: ServerPoint): TrackPoint {
  return {
    lat: Number(point.lat),
    lng: Number(point.lng),
    alt: point.alt == null ? null : Number(point.alt),
    accuracy: point.acc == null ? null : Number(point.acc),
    verticalAccuracy: point.v_acc == null ? null : Number(point.v_acc),
    speed: point.speed_mps == null ? null : Number(point.speed_mps),
    course: point.course_deg == null ? null : Number(point.course_deg),
    t: Number(point.t),
    rawOrdinal: point.raw_ordinal == null ? undefined : Number(point.raw_ordinal),
    segmentId: point.segment_id ?? 'legacy-0',
    segmentStartReason: point.segment_start_reason,
  } as TrackPoint;
}

function bearingDeg(a: TrackPoint, b: TrackPoint): number {
  const rad = (value: number) => value * Math.PI / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
    - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function headingDeltaDeg(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/**
 * One conservative, chronology-preserving pass. It can replace only a nearly
 * collinear middle fix with its timestamp-weighted chord position, only when
 * that move is <=1.5 m. Turns, U-turns, segment boundaries, long lifecycle
 * intervals, source endpoints, timestamps and point order remain untouched.
 */
export function boundedCloneDisplaySmoothing(points: TrackPoint[]): {
  points: TrackPoint[];
  changedRawOrdinals: number[];
} {
  if (points.length < 3) return { points: points.map(point => ({ ...point })), changedRawOrdinals: [] };
  const source = points.map(point => ({ ...point }));
  const out = source.map(point => ({ ...point }));
  const changedRawOrdinals: number[] = [];
  for (let index = 1; index < source.length - 1; index += 1) {
    const previous = source[index - 1];
    const point = source[index];
    const next = source[index + 1];
    if (previous.segmentId !== point.segmentId || point.segmentId !== next.segmentId) continue;
    if (point.t <= previous.t || next.t <= point.t || next.t - previous.t > 10_000) continue;
    if (headingDeltaDeg(bearingDeg(previous, point), bearingDeg(point, next)) > 18) continue;
    const fraction = (point.t - previous.t) / (next.t - previous.t);
    const candidate = {
      lat: previous.lat + (next.lat - previous.lat) * fraction,
      lng: previous.lng + (next.lng - previous.lng) * fraction,
    };
    const displacementM = haversineM(point, candidate);
    if (displacementM > 1.5) continue;
    out[index] = { ...point, ...candidate };
    if (point.rawOrdinal != null) changedRawOrdinals.push(point.rawOrdinal);
  }
  return { points: out, changedRawOrdinals };
}

function validateSource(pending: PendingHike, ownerUserId: string): void {
  if (pending.localId !== ALMOST_DONE_SOURCE_CLIENT_ID || String(pending.userId) !== String(ownerUserId)) {
    throw new Error('almost_done_clone_source_owner_mismatch');
  }
  if (pending.payload.name !== 'almost done') throw new Error('almost_done_clone_source_name_mismatch');
  if (pending.payload.route_points_raw.length !== 239 || pending.payload.route_points.length !== 222) {
    throw new Error('almost_done_clone_source_evidence_mismatch');
  }
}

function buildFromPending(pending: PendingHike): AlmostDoneCloneV1 {
  const canonical = (pending.payload.route_points as ServerPoint[]).map(toTrackPoint);
  const selected = canonical.filter(point => point.rawOrdinal == null || !stationaryTraversalOrdinals.has(point.rawOrdinal));
  const smoothed = boundedCloneDisplaySmoothing(selected);
  const raw = pending.payload.route_points_raw as ServerPoint[];
  const canonicalRawOrdinals = new Set(canonical
    .map(point => point.rawOrdinal)
    .filter((rawOrdinal): rawOrdinal is number => rawOrdinal != null));
  const rawOrdinals = raw
    .map(point => point.raw_ordinal == null ? null : Number(point.raw_ordinal))
    .filter((rawOrdinal): rawOrdinal is number => rawOrdinal != null && Number.isFinite(rawOrdinal));
  const selectedRawOrdinals = selected
    .map(point => point.rawOrdinal)
    .filter((rawOrdinal): rawOrdinal is number => rawOrdinal != null);
  const summary = pending.summary;
  const startedAt = pending.startedAt ?? summary?.startedAt ?? canonical[0]?.t ?? pending.createdAt;
  const endedAt = summary?.endedAt ?? Date.parse(pending.payload.end_time);
  return {
    session: {
      id: ALMOST_DONE_CLONE_V1_ID,
      clientActivityId: ALMOST_DONE_CLONE_V1_ID,
      activityMode: pending.activityMode,
      regionCode: 'nz',
      startedAt,
      endedAt,
      durationS: summary?.durationS ?? pending.payload.duration_s,
      distanceM: summary?.distanceM ?? pending.payload.distance_m,
      elevationGainM: summary?.elevationGainM ?? 0,
      trackPoints: smoothed.points,
      markerIds: [],
      name: 'almost done clone v1',
      syncState: 'synced',
    },
    provenance: {
      schemaVersion: 1,
      reviewOnly: true,
      label: 'QA / SNAP REVIEW CLONE',
      cloneId: ALMOST_DONE_CLONE_V1_ID,
      sourceClientActivityId: ALMOST_DONE_SOURCE_CLIENT_ID,
      sourceServerActivityId: 2072,
      sourceRawCount: raw.length,
      sourceCanonicalCount: canonical.length,
      selectedCanonicalCount: selected.length,
      displayPointCount: smoothed.points.length,
      rawOrdinalsUsedByCanonicalAuthority: [...canonicalRawOrdinals],
      rawOrdinalsExcludedByCanonicalAuthority: rawOrdinals.filter(rawOrdinal => !canonicalRawOrdinals.has(rawOrdinal)),
      impossibleHorizontalAccuracyRawOrdinals: raw
        .filter(point => point.acc != null && (!Number.isFinite(Number(point.acc)) || Number(point.acc) < 0 || Number(point.acc) > 25))
        .map(point => Number(point.raw_ordinal))
        .filter(Number.isFinite),
      stationaryTraversalRemovedRawOrdinals: canonical
        .filter(point => point.rawOrdinal != null && stationaryTraversalOrdinals.has(point.rawOrdinal))
        .map(point => point.rawOrdinal as number),
      boundedSmoothingRawOrdinals: smoothed.changedRawOrdinals,
      matchedRawOrdinals: [],
      unmatchedRawOrdinals: selectedRawOrdinals,
      canonicalFallbackRawOrdinals: selectedRawOrdinals,
      matchedSubsections: [],
      canonicalFallbackRawOrdinalRanges: [[9, 241]],
      negativeVerticalAccuracyRawOrdinals: raw
        .filter(point => point.v_acc != null && Number(point.v_acc) < 0)
        .map(point => Number(point.raw_ordinal))
        .filter(Number.isFinite),
      sourceMemoryPointCount: pending.payload.memory_points.length,
      sideEffectContract: {
        sessionStore: false,
        pendingSync: false,
        backend: false,
        memory: false,
        stats: false,
        gameplay: false,
        social: false,
        analytics: false,
      },
      builtAt: Date.now(),
    },
  };
}

export async function loadOrBuildAlmostDoneCloneV1(
  ownerUserId: string,
  debugMode: boolean,
): Promise<AlmostDoneCloneV1> {
  if (!activitySimulatorBuildCapable || !debugMode) throw new Error('qa_snap_review_not_authorized');
  const key = storageKey(ownerUserId);
  const existing = await storage.getItem(key);
  if (existing) {
    const parsed = JSON.parse(existing) as AlmostDoneCloneV1;
    if (parsed?.provenance?.cloneId === ALMOST_DONE_CLONE_V1_ID
      && parsed?.provenance?.reviewOnly === true
      && parsed?.provenance?.sourceClientActivityId === ALMOST_DONE_SOURCE_CLIENT_ID) {
      return parsed;
    }
  }
  const pending = await readPendingReadonly(ALMOST_DONE_SOURCE_CLIENT_ID);
  if (!pending) throw new Error('almost_done_pending_evidence_not_found');
  validateSource(pending, ownerUserId);
  const clone = buildFromPending(pending);
  await storage.setItem(key, JSON.stringify(clone), { strict: true });
  return clone;
}
