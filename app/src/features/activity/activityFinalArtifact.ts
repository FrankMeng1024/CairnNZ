import { storage } from '../../store/storage';
import type { TrackPoint } from '../../store/useSessionStore';
import { segmentTrace } from './activityContracts';
import { buildBaseFinalGeometry } from '../../services/routing/pedestrianFinalRoute';

export type ActivityFinalSource = 'base' | 'matched' | 'hybrid' | 'limited' | 'server-restored';

export interface ActivityFinalArtifact {
  format: 'cairn-activity-final';
  version: 1;
  ownerUserId: string;
  clientActivityId: string;
  revision: number;
  parentRevision: number | null;
  algorithmVersion: 'pedestrian-final-v2-base';
  source: ActivityFinalSource;
  canonicalFingerprint: string;
  displayFingerprint: string;
  points: TrackPoint[];
  committedAt: number;
}

const keyFor = (ownerUserId: string, clientActivityId: string) => (
  `@cairn:activity_final:v1:${ownerUserId}:${clientActivityId}`
);
let artifactWriteTail: Promise<void> = Promise.resolve();

export function activityGeometryFingerprint(points: ReadonlyArray<Pick<TrackPoint, 'lat' | 'lng' | 'segmentId'>>): string {
  let hash = 0x811c9dc5;
  for (const point of points) {
    const value = `${point.lat.toFixed(6)},${point.lng.toFixed(6)},${point.segmentId ?? ''};`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

export function buildBaseFinalTrackPoints(points: TrackPoint[]): TrackPoint[] {
  return segmentTrace(points).segments.flatMap(segment => {
    const first = segment[0];
    const last = segment[segment.length - 1];
    const base = buildBaseFinalGeometry(segment.map(point => ({
      lat: point.lat,
      lng: point.lng,
      alt: point.alt,
      t: point.t,
      accuracy: point.accuracy,
    })));
    return base.points.map((point, index) => ({
      lat: point.lat,
      lng: point.lng,
      alt: point.alt,
      t: point.t ?? first.t + Math.round(
        ((last.t - first.t) * index) / Math.max(1, base.points.length - 1),
      ),
      segmentId: first.segmentId,
      ...(index === 0 && first.segmentStartReason
        ? { segmentStartReason: first.segmentStartReason }
        : {}),
    }));
  });
}

function validArtifact(value: any, ownerUserId: string, clientActivityId: string): value is ActivityFinalArtifact {
  return value?.format === 'cairn-activity-final'
    && value.version === 1
    && value.ownerUserId === ownerUserId
    && value.clientActivityId === clientActivityId
    && Number.isInteger(value.revision)
    && value.revision >= 1
    && Array.isArray(value.points)
    && activityGeometryFingerprint(value.points) === value.displayFingerprint;
}

export async function loadActivityFinalArtifact(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ActivityFinalArtifact | null> {
  await artifactWriteTail.catch(() => {});
  const raw = await storage.getItem(keyFor(ownerUserId, clientActivityId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return validArtifact(parsed, ownerUserId, clientActivityId) ? parsed : null;
  } catch {
    return null;
  }
}

export async function commitActivityFinalArtifact(input: {
  ownerUserId: string;
  clientActivityId: string;
  canonicalPoints: TrackPoint[];
  displayPoints: TrackPoint[];
  source: ActivityFinalSource;
  expectedRevision?: number | null;
}): Promise<{ committed: boolean; artifact: ActivityFinalArtifact }> {
  if (!input.ownerUserId || input.ownerUserId === 'guest' || !input.clientActivityId) {
    throw new Error('activity_final_owner_required');
  }
  let result!: { committed: boolean; artifact: ActivityFinalArtifact };
  const run = artifactWriteTail.then(async () => {
    const raw = await storage.getItem(keyFor(input.ownerUserId, input.clientActivityId));
    let current: ActivityFinalArtifact | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (validArtifact(parsed, input.ownerUserId, input.clientActivityId)) current = parsed;
      } catch { /* a verified replacement below repairs corrupt local metadata */ }
    }
    const canonicalFingerprint = activityGeometryFingerprint(input.canonicalPoints);
    const displayFingerprint = activityGeometryFingerprint(input.displayPoints);
    if (current && current.canonicalFingerprint === canonicalFingerprint
      && current.displayFingerprint === displayFingerprint) {
      result = { committed: false, artifact: current };
      return;
    }
    if (input.expectedRevision !== undefined
      && (current?.revision ?? null) !== input.expectedRevision) {
      if (!current) throw new Error('activity_final_revision_missing');
      result = { committed: false, artifact: current };
      return;
    }
    // A repeated Finish may encounter a newer accepted refinement. Never
    // replace it with the base representation for the same canonical truth.
    if (current && current.canonicalFingerprint === canonicalFingerprint && input.source === 'base') {
      result = { committed: false, artifact: current };
      return;
    }
    const artifact: ActivityFinalArtifact = {
      format: 'cairn-activity-final',
      version: 1,
      ownerUserId: input.ownerUserId,
      clientActivityId: input.clientActivityId,
      revision: (current?.revision ?? 0) + 1,
      parentRevision: current?.revision ?? null,
      algorithmVersion: 'pedestrian-final-v2-base',
      source: input.source,
      canonicalFingerprint,
      displayFingerprint,
      points: input.displayPoints.map(point => ({ ...point })),
      committedAt: Date.now(),
    };
    const encoded = JSON.stringify(artifact);
    await storage.setItem(keyFor(input.ownerUserId, input.clientActivityId), encoded, { strict: true });
    const verified = await storage.getItem(keyFor(input.ownerUserId, input.clientActivityId));
    if (verified !== encoded) throw new Error('activity_final_commit_verify_failed');
    result = { committed: true, artifact };
  });
  artifactWriteTail = run.then(() => undefined, () => undefined);
  await run;
  return result;
}

export async function deleteActivityFinalArtifact(ownerUserId: string, clientActivityId: string): Promise<void> {
  const run = artifactWriteTail.then(() => storage.removeItem(keyFor(ownerUserId, clientActivityId)));
  artifactWriteTail = run.then(() => undefined, () => undefined);
  await run;
}

export function activityFinalArtifactStorageKey(ownerUserId: string, clientActivityId: string): string {
  return keyFor(ownerUserId, clientActivityId);
}
