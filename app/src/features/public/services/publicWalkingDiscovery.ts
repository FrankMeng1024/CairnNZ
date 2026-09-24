import { pushMemoryNow } from '../../../services/memorySync';
import { usePublicCairnStore } from './publicCairns';

const MIN_EVIDENCE_SPAN_MS = 10_000;
const PROBE_INTERVAL_MS = 60_000;

type PublicWalkingPoint = {
  lat: number;
  lng: number;
  t: number;
  segment_id?: string;
  segmentId?: string;
  accuracy?: number | null;
  alt?: number | null;
};

const attempts = new Map<string, { lastAttemptAt: number; inFlight: boolean }>();

/**
 * Bounded live-Activity Public probe. The server remains the sole authority:
 * this advances already accepted real witnesses, then asks the normal
 * encounter endpoint to re-establish identity,
 * provenance, continuity, distance, publication time and authorization.
 * Activity route points remain owned by the normal incremental uploader. Do
 * not append them here: a second writer with a new idempotency key would
 * duplicate track geometry and could manufacture a discontinuity.
 */
export async function maybeVerifyPublicWalkingDiscovery(input: {
  sourceActivityClientId: string;
  serverActivityId: number;
  points: PublicWalkingPoint[];
  nowMs?: number;
  isCurrent: () => boolean;
}): Promise<'skipped' | 'attempted'> {
  const publicState = usePublicCairnStore.getState();
  const nowMs = input.nowMs ?? Date.now();
  if (!publicState.enabled || !input.sourceActivityClientId || !input.serverActivityId
    || input.points.length < 2 || !input.isCurrent()) return 'skipped';
  const firstAt = Number(input.points[0]?.t);
  const lastAt = Number(input.points[input.points.length - 1]?.t);
  if (!Number.isFinite(firstAt) || !Number.isFinite(lastAt)
    || lastAt - firstAt < MIN_EVIDENCE_SPAN_MS) return 'skipped';
  const prior = attempts.get(input.sourceActivityClientId);
  if (prior?.inFlight || (prior && nowMs - prior.lastAttemptAt < PROBE_INTERVAL_MS)) return 'skipped';
  attempts.set(input.sourceActivityClientId, { lastAttemptAt: nowMs, inFlight: true });
  try {
    await pushMemoryNow();
    if (!input.isCurrent()) return 'attempted';
    await usePublicCairnStore.getState().verifyCompletedActivity(input.sourceActivityClientId);
    return 'attempted';
  } finally {
    const current = attempts.get(input.sourceActivityClientId);
    if (current?.lastAttemptAt === nowMs) attempts.set(input.sourceActivityClientId, { ...current, inFlight: false });
  }
}

export const __publicWalkingDiscoveryTest = {
  MIN_EVIDENCE_SPAN_MS,
  PROBE_INTERVAL_MS,
  reset() { attempts.clear(); },
};
