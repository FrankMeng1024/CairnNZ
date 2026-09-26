import { appendPoints as remoteAppendPoints } from '../../services/sessionService';
import type { SegmentStartReason } from './activityContracts';

export interface FlushableActivityPoint {
  lat: number;
  lng: number;
  t: number;
  segment_id?: string;
  segment_start_reason?: SegmentStartReason;
}

export interface ActivityRouteFlushIdentity {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  serverActivityId: number;
}

interface FlushState {
  tail: Promise<void>;
  acknowledgedCount: number;
  acknowledgedPrefixFingerprint: string;
}

const states = new Map<string, FlushState>();

function identityKey(identity: ActivityRouteFlushIdentity): string {
  return `${identity.ownerUserId}:${identity.clientActivityId}:${identity.ownerGeneration}:${identity.serverActivityId}`;
}

function pointKey(point: FlushableActivityPoint): string {
  return `${Math.floor(point.t)}:${point.lat.toFixed(6)}:${point.lng.toFixed(6)}:${point.segment_id ?? ''}`;
}

function prefixFingerprint(points: ReadonlyArray<FlushableActivityPoint>, count: number): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < Math.min(count, points.length); index += 1) {
    const value = pointKey(points[index]);
    for (let offset = 0; offset < value.length; offset += 1) {
      hash ^= value.charCodeAt(offset);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function stateFor(key: string): FlushState {
  const existing = states.get(key);
  if (existing) return existing;
  const state: FlushState = {
    tail: Promise.resolve(),
    acknowledgedCount: 0,
    acknowledgedPrefixFingerprint: prefixFingerprint([], 0),
  };
  states.set(key, state);
  return state;
}

/**
 * The only live route uploader. Periodic backup, foreground recovery and
 * walking discovery all enter this per-Activity serial tail. The full
 * canonical prefix is supplied each time; only the server-acknowledged suffix
 * is mutable. A prefix mismatch fails safe by replaying the full route, whose
 * backend point-identity dedupe prevents duplication.
 */
export async function flushActivityRoutePrefix(input: {
  identity: ActivityRouteFlushIdentity;
  points: FlushableActivityPoint[];
  isCurrent: () => boolean;
}): Promise<{ acknowledged: boolean; acknowledgedCount: number; appendedCount: number }> {
  const key = identityKey(input.identity);
  const state = stateFor(key);
  let result = { acknowledged: false, acknowledgedCount: state.acknowledgedCount, appendedCount: 0 };
  const points = input.points.map(point => ({ ...point }));
  const run = state.tail.catch(() => {}).then(async () => {
    if (!input.isCurrent()) return;
    if (state.acknowledgedCount > points.length
      || prefixFingerprint(points, state.acknowledgedCount) !== state.acknowledgedPrefixFingerprint) {
      state.acknowledgedCount = 0;
      state.acknowledgedPrefixFingerprint = prefixFingerprint([], 0);
    }
    if (state.acknowledgedCount >= points.length) {
      result = { acknowledged: true, acknowledgedCount: state.acknowledgedCount, appendedCount: 0 };
      return;
    }
    const from = state.acknowledgedCount;
    const suffix = points.slice(from);
    const acknowledged = await remoteAppendPoints(input.identity.serverActivityId, suffix, {
      userId: input.identity.ownerUserId,
      clientActivityId: input.identity.clientActivityId,
    });
    if (!acknowledged || !input.isCurrent()) {
      result = { acknowledged: false, acknowledgedCount: state.acknowledgedCount, appendedCount: 0 };
      return;
    }
    state.acknowledgedCount = points.length;
    state.acknowledgedPrefixFingerprint = prefixFingerprint(points, points.length);
    result = { acknowledged: true, acknowledgedCount: points.length, appendedCount: suffix.length };
  });
  state.tail = run.then(() => undefined, () => undefined);
  await run;
  return result;
}

export function resetActivityRouteFlush(identity: ActivityRouteFlushIdentity): void {
  states.delete(identityKey(identity));
}

export const __activityRouteFlushTest = {
  reset() { states.clear(); },
};
