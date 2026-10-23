import { AppState } from 'react-native';
import { authenticatedFetch } from '../../../services/apiService';
import { API_BASE_URL } from '../../../config/api';
import { getHeadlessTokenForOwner } from '../../../services/tokenStore';
import networkMonitor from '../../../services/networkMonitor';
import { useAppStore } from '../../../store/useAppStore';
import { storage } from '../../../store/storage';
import {
  AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION,
  useMemorySettingsStore,
} from '../../memory/store/useMemorySettingsStore';

const KEY_PREFIX = '@cairn:walking-encounter:v1:';
const MAX_EVENTS_PER_OWNER = 512;
const MAX_WITNESSES_PER_REQUEST = 100;
const PASSIVE_RETENTION_MS = 2 * 60_000;
const ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const MIN_SPAN_MS = 10_000;
const MAX_SPAN_MS = 30 * 60_000;
const MIN_WALKING_DISPLACEMENT_M = 0.75;
const MAX_WALKING_SPEED_MPS = 15;
const MAX_ACCURACY_M = 50;
const RETRY_MIN_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const PASSIVE_AUTO_FLUSH_DELAY_MS = 60_000;

export type WalkingEvidenceSource = 'activity_real' | 'passive_real';

export interface WalkingEncounterObservation {
  lat: number;
  lng: number;
  t: number;
  accuracy?: number | null;
  sourceSegmentId: string;
}

interface DurableWalkingObservation extends WalkingEncounterObservation {
  v: 1;
  id: string;
  ownerUserId: string;
  source: WalkingEvidenceSource;
  sourceActivityClientId?: string;
}

interface WalkingWitness {
  cid: string;
  first_lat: number;
  first_lng: number;
  first_observed_at_ms: number;
  lat: number;
  lng: number;
  observed_at_ms: number;
  evidence_source: WalkingEvidenceSource;
  source_activity_client_id: string | null;
  source_segment_id: string;
  horizontal_accuracy_m: number;
  continuity_state: 'accepted';
}

interface WitnessPair {
  witness: WalkingWitness;
  first: DurableWalkingObservation;
  latest: DurableWalkingObservation;
}

export interface WalkingEncounterFlushResult {
  status: 'acknowledged' | 'nothing_to_push' | 'offline' | 'auth_unavailable'
    | 'authority_changed' | 'route_pending' | 'failed';
  processedWitnessCount: number;
  acquiredCount: number;
}

let mutationTail: Promise<void> = Promise.resolve();
const flights = new Map<string, Promise<WalkingEncounterFlushResult>>();
const retryAttempts = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function withMutation<T>(work: () => Promise<T>): Promise<T> {
  const previous = mutationTail.catch(() => undefined);
  let release!: () => void;
  mutationTail = new Promise<void>(resolve => { release = resolve; });
  return previous.then(work).finally(release);
}

function hash(value: string, seed = 0x811c9dc5): string {
  let result = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}

function deterministicUuid(value: string): string {
  const raw = [
    hash(value),
    hash(value, 0x9e3779b9),
    hash(value, 0x85ebca6b),
    hash(value, 0xc2b2ae35),
  ].join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

function ownerPrefix(ownerUserId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(ownerUserId)}:`;
}

function eventKey(event: DurableWalkingObservation): string {
  return `${ownerPrefix(event.ownerUserId)}${event.id}`;
}

function validCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function validEvent(value: any, ownerUserId: string): value is DurableWalkingObservation {
  return value?.v === 1
    && value.ownerUserId === ownerUserId
    && typeof value.id === 'string'
    && (value.source === 'activity_real' || value.source === 'passive_real')
    && validCoordinate(Number(value.lat), Number(value.lng))
    && Number.isSafeInteger(value.t) && value.t > 0
    && typeof value.sourceSegmentId === 'string' && value.sourceSegmentId.length > 0
    && value.sourceSegmentId.length <= 80
    && Number.isFinite(Number(value.accuracy))
    && Number(value.accuracy) > 0 && Number(value.accuracy) <= MAX_ACCURACY_M
    && (value.source !== 'activity_real'
      || (typeof value.sourceActivityClientId === 'string'
        && value.sourceActivityClientId.length > 0
        && value.sourceActivityClientId.length <= 36));
}

function retentionMs(source: WalkingEvidenceSource): number {
  return source === 'activity_real' ? ACTIVITY_RETENTION_MS : PASSIVE_RETENTION_MS;
}

async function readOwnerEvents(ownerUserId: string, nowMs = Date.now()): Promise<DurableWalkingObservation[]> {
  const prefix = ownerPrefix(ownerUserId);
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(prefix));
  const events: DurableWalkingObservation[] = [];
  const remove: string[] = [];
  for (const key of keys) {
    try {
      const raw = await storage.getItemStrict(key);
      const value = raw ? JSON.parse(raw) : null;
      if (!validEvent(value, ownerUserId)
        || value.t > nowMs + FUTURE_SKEW_MS
        || value.t < nowMs - retentionMs(value.source)) {
        remove.push(key);
      } else {
        events.push(value);
      }
    } catch {
      // A malformed owner-scoped entry can never become valid evidence. Drop
      // it so one corrupt record cannot block later real observations.
      remove.push(key);
    }
  }
  events.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  if (events.length > MAX_EVENTS_PER_OWNER) {
    const overflow = events.splice(0, events.length - MAX_EVENTS_PER_OWNER);
    remove.push(...overflow.map(eventKey));
  }
  if (remove.length > 0) await storage.removeItemsStrict([...new Set(remove)]);
  return events;
}

function distanceMeters(a: WalkingEncounterObservation, b: WalkingEncounterObservation): number {
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function contextKey(event: DurableWalkingObservation): string {
  return [event.source, event.sourceActivityClientId ?? '', event.sourceSegmentId].join(':');
}

function buildWitnessPairs(events: DurableWalkingObservation[]): WitnessPair[] {
  const byContext = new Map<string, DurableWalkingObservation[]>();
  for (const event of events) {
    const list = byContext.get(contextKey(event)) ?? [];
    list.push(event);
    byContext.set(contextKey(event), list);
  }
  const pairs: WitnessPair[] = [];
  for (const contextEvents of byContext.values()) {
    const ordered = [...contextEvents].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    let first = ordered[0];
    for (let index = 1; first && index < ordered.length; index += 1) {
      const latest = ordered[index];
      const spanMs = latest.t - first.t;
      if (spanMs > MAX_SPAN_MS) {
        first = latest;
        continue;
      }
      if (spanMs < MIN_SPAN_MS) continue;
      const displacementM = distanceMeters(first, latest);
      const speedMps = displacementM / (spanMs / 1000);
      if (displacementM < MIN_WALKING_DISPLACEMENT_M || speedMps > MAX_WALKING_SPEED_MPS) continue;
      const cid = deterministicUuid(`witness|${first.id}|${latest.id}`);
      pairs.push({
        first,
        latest,
        witness: {
          cid,
          first_lat: first.lat,
          first_lng: first.lng,
          first_observed_at_ms: first.t,
          lat: latest.lat,
          lng: latest.lng,
          observed_at_ms: latest.t,
          evidence_source: latest.source,
          source_activity_client_id: latest.sourceActivityClientId ?? null,
          source_segment_id: latest.sourceSegmentId,
          horizontal_accuracy_m: Math.max(Number(first.accuracy), Number(latest.accuracy)),
          continuity_state: 'accepted',
        },
      });
      first = latest;
      if (pairs.length >= MAX_WITNESSES_PER_REQUEST) return pairs;
    }
  }
  return pairs.sort((a, b) => a.latest.t - b.latest.t || a.witness.cid.localeCompare(b.witness.cid));
}

function currentOwnerIs(ownerUserId: string): boolean {
  const app = useAppStore.getState();
  return app.isLoggedIn === true && String(app.user?.id ?? '') === ownerUserId;
}

export function automaticExplorationAndEncountersEnabled(): boolean {
  const settings = useMemorySettingsStore.getState();
  return settings.passiveExplorationEnabled
    && !settings.memoryLocationTransitionRequired
    && settings.automaticExplorationDisclosureVersion >= AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION;
}

function clearRetry(ownerUserId: string): void {
  const timer = retryTimers.get(ownerUserId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(ownerUserId);
  retryAttempts.delete(ownerUserId);
}

export function scheduleWalkingEncounterFlush(ownerUserId: string, delayMs = 2_000): void {
  if (!ownerUserId || !currentOwnerIs(ownerUserId)) return;
  const existing = retryTimers.get(ownerUserId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    retryTimers.delete(ownerUserId);
    if (AppState.currentState === 'active' && currentOwnerIs(ownerUserId)) {
      void flushWalkingEncounterEvidence(ownerUserId);
    }
  }, Math.max(0, delayMs));
  (timer as any)?.unref?.();
  retryTimers.set(ownerUserId, timer);
}

function scheduleRetry(ownerUserId: string): void {
  const attempt = Math.min(8, (retryAttempts.get(ownerUserId) ?? 0) + 1);
  retryAttempts.set(ownerUserId, attempt);
  scheduleWalkingEncounterFlush(
    ownerUserId,
    Math.min(RETRY_MAX_MS, RETRY_MIN_MS * (2 ** (attempt - 1))),
  );
}

export async function recordWalkingEncounterObservations(args: {
  ownerUserId: string;
  source: WalkingEvidenceSource;
  sourceActivityClientId?: string;
  observations: WalkingEncounterObservation[];
}): Promise<number> {
  if (!args.ownerUserId) throw new Error('walking_evidence_owner_required');
  if (args.source === 'activity_real' && !args.sourceActivityClientId) {
    throw new Error('walking_evidence_activity_required');
  }
  const valid = args.observations.filter(observation => (
    validCoordinate(observation.lat, observation.lng)
    && Number.isSafeInteger(observation.t) && observation.t > 0
    && typeof observation.sourceSegmentId === 'string'
    && observation.sourceSegmentId.length > 0 && observation.sourceSegmentId.length <= 80
    && Number.isFinite(Number(observation.accuracy))
    && Number(observation.accuracy) > 0 && Number(observation.accuracy) <= MAX_ACCURACY_M
  ));
  if (valid.length === 0) return 0;
  await withMutation(async () => {
    for (const observation of valid) {
      const identity = [
        args.ownerUserId,
        args.source,
        args.sourceActivityClientId ?? '',
        observation.sourceSegmentId,
        observation.t,
        observation.lat.toFixed(7),
        observation.lng.toFixed(7),
      ].join('|');
      const event: DurableWalkingObservation = {
        ...observation,
        accuracy: Number(observation.accuracy),
        v: 1,
        id: deterministicUuid(identity),
        ownerUserId: args.ownerUserId,
        source: args.source,
        ...(args.sourceActivityClientId
          ? { sourceActivityClientId: args.sourceActivityClientId }
          : {}),
      };
      await storage.setItem(eventKey(event), JSON.stringify(event), { strict: true });
    }
    await readOwnerEvents(args.ownerUserId);
  });
  if (args.source === 'passive_real'
    && currentOwnerIs(args.ownerUserId)
    && automaticExplorationAndEncountersEnabled()
    && !retryTimers.has(args.ownerUserId)) {
    // Coalesce ordinary foreground walking into a low-rate upload. Activity
    // uses its existing 60 s route-flush authority (and Finish/Save wakeups),
    // so recording a point never creates a parallel per-fix network cadence.
    scheduleWalkingEncounterFlush(args.ownerUserId, PASSIVE_AUTO_FLUSH_DELAY_MS);
  }
  return valid.length;
}

async function removeProcessedPairs(pairs: WitnessPair[], processed: Set<string>): Promise<void> {
  const keys = pairs
    .filter(pair => processed.has(pair.witness.cid))
    .map(pair => eventKey(pair.first));
  if (keys.length > 0) await storage.removeItemsStrict([...new Set(keys)]);
}

async function parseWalkingResponse(
  response: Response,
  pairs: WitnessPair[],
): Promise<{ processed: Set<string>; acquiredCount: number; routePending: boolean }> {
  const body = await response.json().catch(() => null);
  const sent = new Set(pairs.map(pair => pair.witness.cid));
  const processedList: string[] = Array.isArray(body?.processed_witness_cids)
    ? body.processed_witness_cids.map((cid: unknown) => String(cid ?? ''))
    : [];
  const processed = new Set<string>(processedList.filter(cid => sent.has(cid)));
  return {
    processed,
    acquiredCount: Array.isArray(body?.acquired) ? body.acquired.length : 0,
    routePending: body?.reason === 'activity_route_pending',
  };
}

async function normalDelivery(ownerUserId: string): Promise<WalkingEncounterFlushResult> {
  if (!currentOwnerIs(ownerUserId)) return { status: 'authority_changed', processedWitnessCount: 0, acquiredCount: 0 };
  if (networkMonitor.getState()?.state === 'offline') {
    return { status: 'offline', processedWitnessCount: 0, acquiredCount: 0 };
  }
  await mutationTail.catch(() => undefined);
  const includePassive = automaticExplorationAndEncountersEnabled();
  const events = (await readOwnerEvents(ownerUserId)).filter(event => (
    event.source === 'activity_real' || includePassive
  ));
  const pairs = buildWitnessPairs(events);
  if (pairs.length === 0) return { status: 'nothing_to_push', processedWitnessCount: 0, acquiredCount: 0 };
  const response = await authenticatedFetch('/api/cairn-memory/walking-evidence', {
    method: 'POST',
    skipLogoutOn401: true,
    expectedUserId: ownerUserId,
    body: JSON.stringify({ witnesses: pairs.map(pair => pair.witness) }),
  });
  if (!currentOwnerIs(ownerUserId)) return { status: 'authority_changed', processedWitnessCount: 0, acquiredCount: 0 };
  if (response.status === 401) return { status: 'auth_unavailable', processedWitnessCount: 0, acquiredCount: 0 };
  if (!response.ok) throw new Error(`walking_evidence_http_${response.status}`);
  const parsed = await parseWalkingResponse(response, pairs);
  await removeProcessedPairs(pairs, parsed.processed);
  if (parsed.acquiredCount > 0 && currentOwnerIs(ownerUserId)) {
    try {
      // Presentation refresh is a consumer of committed acquisition only. It
      // never participates in evidence ACK or queue removal.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      void require('../../cairns/cairnPresentationStore')
        .useCairnPresentationStore.getState().refresh();
    } catch { /* the normal poller remains the durable presentation fallback */ }
  }
  if (parsed.processed.size > 0) clearRetry(ownerUserId);
  if (pairs.length >= MAX_WITNESSES_PER_REQUEST && parsed.processed.size > 0) {
    scheduleWalkingEncounterFlush(ownerUserId, 0);
  }
  return {
    status: parsed.processed.size > 0 ? 'acknowledged' : parsed.routePending ? 'route_pending' : 'nothing_to_push',
    processedWitnessCount: parsed.processed.size,
    acquiredCount: parsed.acquiredCount,
  };
}

export function flushWalkingEncounterEvidence(ownerUserId: string): Promise<WalkingEncounterFlushResult> {
  const existing = flights.get(ownerUserId);
  if (existing) return existing;
  const flight = normalDelivery(ownerUserId).catch(() => {
    if (currentOwnerIs(ownerUserId)) scheduleRetry(ownerUserId);
    return { status: 'failed', processedWitnessCount: 0, acquiredCount: 0 } as WalkingEncounterFlushResult;
  }).finally(() => {
    if (flights.get(ownerUserId) === flight) flights.delete(ownerUserId);
  });
  flights.set(ownerUserId, flight);
  return flight;
}

export async function deliverHeadlessWalkingEncounters(args: {
  ownerUserId: string;
  passiveEpoch: string;
  authorityIsCurrent: () => Promise<boolean>;
}): Promise<WalkingEncounterFlushResult> {
  try {
    if (!await args.authorityIsCurrent()) return { status: 'authority_changed', processedWitnessCount: 0, acquiredCount: 0 };
    await mutationTail.catch(() => undefined);
    const events = (await readOwnerEvents(args.ownerUserId)).filter(event => (
      event.source === 'passive_real' && event.sourceSegmentId === args.passiveEpoch
    ));
    const pairs = buildWitnessPairs(events);
    if (pairs.length === 0) return { status: 'nothing_to_push', processedWitnessCount: 0, acquiredCount: 0 };
    const token = await getHeadlessTokenForOwner(args.ownerUserId);
    if (!token) return { status: 'auth_unavailable', processedWitnessCount: 0, acquiredCount: 0 };
    if (!await args.authorityIsCurrent()) return { status: 'authority_changed', processedWitnessCount: 0, acquiredCount: 0 };
    const response = await fetch(`${API_BASE_URL}/api/cairn-memory/walking-evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ witnesses: pairs.map(pair => pair.witness) }),
    });
    if (!await args.authorityIsCurrent()) return { status: 'authority_changed', processedWitnessCount: 0, acquiredCount: 0 };
    if (response.status === 401) return { status: 'auth_unavailable', processedWitnessCount: 0, acquiredCount: 0 };
    if (!response.ok) return { status: 'failed', processedWitnessCount: 0, acquiredCount: 0 };
    const parsed = await parseWalkingResponse(response, pairs);
    await removeProcessedPairs(pairs, parsed.processed);
    return {
      status: parsed.processed.size > 0 ? 'acknowledged' : parsed.routePending ? 'route_pending' : 'nothing_to_push',
      processedWitnessCount: parsed.processed.size,
      acquiredCount: parsed.acquiredCount,
    };
  } catch {
    return { status: 'failed', processedWitnessCount: 0, acquiredCount: 0 };
  }
}

export async function dropPassiveWalkingEncounterEvidence(ownerUserId: string): Promise<void> {
  await withMutation(async () => {
    const events = await readOwnerEvents(ownerUserId);
    await storage.removeItemsStrict(events.filter(event => event.source === 'passive_real').map(eventKey));
  });
}

export async function purgeWalkingEncounterEvidenceForActivity(
  ownerUserId: string,
  sourceActivityClientId: string,
): Promise<void> {
  await withMutation(async () => {
    const events = await readOwnerEvents(ownerUserId);
    await storage.removeItemsStrict(events
      .filter(event => event.sourceActivityClientId === sourceActivityClientId)
      .map(eventKey));
  });
}

export async function purgeWalkingEncounterEvidenceForOwner(ownerUserId: string): Promise<void> {
  clearRetry(ownerUserId);
  await flights.get(ownerUserId)?.catch(() => undefined);
  await withMutation(async () => {
    const prefix = ownerPrefix(ownerUserId);
    const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(prefix));
    await storage.removeItemsStrict(keys);
  });
}

export const __walkingEncounterEvidenceTest = {
  buildWitnessPairs,
  readOwnerEvents,
  reset() {
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    retryAttempts.clear();
    flights.clear();
    mutationTail = Promise.resolve();
  },
};
