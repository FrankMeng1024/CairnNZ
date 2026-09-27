import type { TrackPoint } from '../../store/useSessionStore';
import { storage } from '../../store/storage';
import { useAppStore } from '../../store/useAppStore';
import { recordMemoryEvidence } from '../memory/services/recordMemoryEvidence';
import { readActiveHikeTail } from '../../services/hikeTrackWriter';

const CHECKPOINT_PREFIX = 'cairn:activity-memory-projection:v1:';
const MAX_PENDING_POINTS_PER_ACTIVITY = 256;
const RETRY_MS = [1_000, 5_000, 15_000, 60_000];

interface ProjectionRequest {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  pending: Map<string, TrackPoint>;
  replayRequired: boolean;
  running: boolean;
  dirty: boolean;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  flight: Promise<void> | null;
}

const requests = new Map<string, ProjectionRequest>();
let metrics = {
  scheduledPoints: 0,
  projectedPoints: 0,
  deduplicatedPoints: 0,
  replayLoads: 0,
  failures: 0,
  maximumPendingPoints: 0,
};

function pointId(point: TrackPoint): string {
  const rawOrdinal = Number((point as any).rawOrdinal);
  return Number.isFinite(rawOrdinal)
    ? `raw:${rawOrdinal}`
    : `${Math.floor(point.t)}:${point.lat.toFixed(7)}:${point.lng.toFixed(7)}:${point.segmentId ?? ''}`;
}

function checkpointKey(request: ProjectionRequest): string {
  return `${CHECKPOINT_PREFIX}${request.ownerUserId}:${request.clientActivityId}`;
}

function ownerIsCurrent(request: ProjectionRequest): boolean {
  return String(useAppStore.getState().user?.id ?? '') === request.ownerUserId;
}

async function project(request: ProjectionRequest): Promise<void> {
  if (request.running) {
    request.dirty = true;
    return;
  }
  request.running = true;
  try {
    do {
      request.dirty = false;
      if (!ownerIsCurrent(request)) return;
      let points = [...request.pending.values()];
      request.pending.clear();
      if (request.replayRequired) {
        request.replayRequired = false;
        metrics.replayLoads += 1;
        // Some rollback/test bundles may not export the recovery adapter yet;
        // the already queued points remain sufficient and the next foreground
        // recovery pass will replay the durable Activity WAL.
        const journal = typeof readActiveHikeTail === 'function'
          ? await readActiveHikeTail(request.clientActivityId)
          : [];
        const merged = new Map(points.map(point => [pointId(point), point]));
        for (const point of journal) merged.set(pointId(point), point as TrackPoint);
        points = [...merged.values()];
      }
      points.sort((a, b) => a.t - b.t || pointId(a).localeCompare(pointId(b)));
      for (let index = 0; index < points.length; index += 1) {
        if (!ownerIsCurrent(request)) return;
        const point = points[index];
        try {
          const result = await recordMemoryEvidence({
            lat: point.lat,
            lng: point.lng,
            atMs: point.t,
            source: 'activity_real',
            ownerUserId: request.ownerUserId,
            durability: 'deferred',
            sourceActivityClientId: request.clientActivityId,
            sourceSegmentId: point.segmentId,
            horizontalAccuracyM: point.accuracy ?? undefined,
            continuityState: 'accepted',
          });
          metrics.projectedPoints += 1;
          if (result.deduplicated) metrics.deduplicatedPoints += 1;
          await storage.setItem(checkpointKey(request), JSON.stringify({
            v: 1,
            ownerUserId: request.ownerUserId,
            clientActivityId: request.clientActivityId,
            ownerGeneration: request.ownerGeneration,
            pointId: pointId(point),
            pointTimestampMs: point.t,
            projectedAtMs: Date.now(),
          }), { strict: true });
        } catch {
          metrics.failures += 1;
          request.replayRequired = true;
          for (const unprocessed of points.slice(index)) {
            if (request.pending.size >= MAX_PENDING_POINTS_PER_ACTIVITY) break;
            request.pending.set(pointId(unprocessed), unprocessed);
          }
          scheduleRetry(request);
          return;
        }
      }
      request.retryAttempt = 0;
    } while (request.dirty || request.pending.size > 0 || request.replayRequired);
  } finally {
    request.running = false;
  }
}

function scheduleRetry(request: ProjectionRequest): void {
  if (request.retryTimer || !ownerIsCurrent(request)) return;
  const delay = RETRY_MS[Math.min(request.retryAttempt, RETRY_MS.length - 1)];
  request.retryAttempt += 1;
  request.retryTimer = setTimeout(() => {
    request.retryTimer = null;
    void project(request);
  }, delay);
}

/**
 * Schedules projection only after the caller has committed these points to
 * the Activity WAL. The queue is coalesced and bounded; overflow reloads the
 * durable journal rather than retaining an unbounded promise/point chain.
 */
export function scheduleActivityMemoryProjection(args: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  points: TrackPoint[];
}): void {
  let request = requests.get(args.clientActivityId);
  if (!request
    || request.ownerUserId !== args.ownerUserId
    || request.ownerGeneration !== args.ownerGeneration) {
    if (request?.retryTimer) clearTimeout(request.retryTimer);
    request = {
      ownerUserId: args.ownerUserId,
      clientActivityId: args.clientActivityId,
      ownerGeneration: args.ownerGeneration,
      pending: new Map(),
      replayRequired: false,
      running: false,
      dirty: false,
      retryAttempt: 0,
      retryTimer: null,
      flight: null,
    };
    requests.set(args.clientActivityId, request);
  }
  for (const point of args.points) {
    metrics.scheduledPoints += 1;
    if (request.pending.size >= MAX_PENDING_POINTS_PER_ACTIVITY) {
      request.replayRequired = true;
      break;
    }
    request.pending.set(pointId(point), point);
  }
  metrics.maximumPendingPoints = Math.max(metrics.maximumPendingPoints, request.pending.size);
  request.dirty = true;
  if (!request.running) {
    const flight = project(request);
    const tracked = flight.finally(() => {
      if (request?.flight === tracked) request.flight = null;
    });
    request.flight = tracked;
  }
}

export async function waitForActivityMemoryProjection(clientActivityId: string): Promise<void> {
  const request = requests.get(clientActivityId);
  if (!request) return;
  while (request.running && request.flight) await request.flight;
}

export async function waitForAllActivityMemoryProjections(): Promise<void> {
  for (const request of requests.values()) {
    while (request.running && request.flight) await request.flight;
  }
}

export function getActivityMemoryProjectionMetrics(): typeof metrics {
  return { ...metrics };
}

export function resetActivityMemoryProjectionForTests(): void {
  for (const request of requests.values()) if (request.retryTimer) clearTimeout(request.retryTimer);
  requests.clear();
  metrics = {
    scheduledPoints: 0,
    projectedPoints: 0,
    deduplicatedPoints: 0,
    replayLoads: 0,
    failures: 0,
    maximumPendingPoints: 0,
  };
}
