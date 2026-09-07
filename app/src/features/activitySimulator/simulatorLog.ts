import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useActivitySimulatorStore } from './useActivitySimulatorStore';

export type SimulatorLogCategory =
  | 'SIM_SESSION'
  | 'SIM_INPUT'
  | 'SIM_POSITION'
  | 'SIM_SAMPLE'
  | 'GPS_ACCEPT'
  | 'GPS_REJECT'
  | 'GPS_GAP'
  | 'GPS_SEGMENT'
  | 'ACTIVITY_STATE'
  | 'ACTIVITY_POINT'
  | 'ACTIVITY_METRICS'
  | 'ACTIVITY_RECOVERY'
  | 'ACTIVITY_COMPLETION'
  | 'MEMORY_EVIDENCE'
  | 'CAIRN_COMMIT'
  | 'CAIRN_ASSOCIATION'
  | 'SYNC_STATE'
  | 'SYNC_ACK'
  | 'SYNC_CLEANUP'
  | 'ACCOUNT_OWNER'
  | 'ERROR';

export interface SimulatorLogEvent {
  timestamp: number;
  eventName: string;
  category: SimulatorLogCategory;
  simulatorSessionId: string;
  clientActivityIdSuffix: string | null;
  ownerSuffix: string | null;
  virtualTimestamp: number | null;
  wallClockTimestamp: number;
  timeScale: number;
  effectiveVirtualElapsed: number;
  sampleSequence: number;
  batchSequence: number;
  fields: Record<string, unknown>;
}

const MAX_EVENTS_PER_SESSION = 5_000;
const MAX_BYTES_PER_SESSION = 2 * 1024 * 1024;
const MAX_SESSIONS = 5;
const INDEX_KEY = (userId: string) => `@cairn:activity_simulator_logs:index:v1:${userId}`;
const LOG_KEY = (userId: string, sessionId: string) =>
  `@cairn:activity_simulator_logs:v1:${userId}:${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}`;
const FORBIDDEN_FIELD = /(access|refresh)?token|password|passcode|reset.?code|email|authorization|cookie|secret/i;

const memory = new Map<string, SimulatorLogEvent[]>();
const loads = new Map<string, Promise<SimulatorLogEvent[]>>();
const dirty = new Set<string>();
const dirtyOwners = new Map<string, { userId: string; sessionId: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writeTail: Promise<void> = Promise.resolve();

function suffix(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? value : value.slice(-8);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 240);
  if (Array.isArray(value)) return value.slice(0, 24).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD.test(key)) continue;
      out[key] = sanitizeValue(nested, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 240);
}

export function sanitizeSimulatorLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(fields) as Record<string, unknown>;
}

function bounded(events: SimulatorLogEvent[]): SimulatorLogEvent[] {
  let result = events.length > MAX_EVENTS_PER_SESSION
    ? events.slice(events.length - MAX_EVENTS_PER_SESSION)
    : events;
  let serialized = JSON.stringify(result);
  while (serialized.length > MAX_BYTES_PER_SESSION && result.length > 1) {
    result = result.slice(Math.max(1, Math.floor(result.length * 0.1)));
    serialized = JSON.stringify(result);
  }
  return result;
}

export function boundSimulatorLogEvents(events: SimulatorLogEvent[]): SimulatorLogEvent[] {
  return bounded(events);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushSimulatorLogs();
  }, 1_500);
}

async function loadSession(userId: string, sessionId: string): Promise<SimulatorLogEvent[]> {
  const key = LOG_KEY(userId, sessionId);
  const existing = memory.get(key);
  if (existing) return existing;
  const inFlight = loads.get(key);
  if (inFlight) return inFlight;
  const load = (async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      const events = Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS_PER_SESSION) : [];
      memory.set(key, events);
      return events;
    } catch {
      memory.set(key, []);
      return [];
    } finally {
      loads.delete(key);
    }
  })();
  loads.set(key, load);
  return load;
}

async function updateIndex(userId: string, sessionId: string): Promise<void> {
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string');
  } catch { /* use an empty index */ }
  index = [sessionId, ...index.filter(item => item !== sessionId)];
  const evicted = index.slice(MAX_SESSIONS);
  index = index.slice(0, MAX_SESSIONS);
  await AsyncStorage.setItem(INDEX_KEY(userId), JSON.stringify(index));
  for (const oldSession of evicted) {
    const oldKey = LOG_KEY(userId, oldSession);
    memory.delete(oldKey);
    dirty.delete(oldKey);
    dirtyOwners.delete(oldKey);
    await AsyncStorage.removeItem(oldKey);
  }
}

/**
 * Simulator-only local logging. Full coordinates are permitted in `fields`
 * because callers use this function only for a build-gated synthetic source.
 * No event is forwarded to appLog, telemetryUploader, or the backend.
 */
export function appendSimulatorLog(
  category: SimulatorLogCategory,
  eventName: string,
  fields: Record<string, unknown> = {},
  context?: { userId?: string | null; clientActivityId?: string | null; simulatorSessionId?: string | null; virtualTimestamp?: number | null },
): void {
  const simulator = useActivitySimulatorStore.getState();
  const userId = String(context?.userId ?? simulator.hydratedUserId ?? '');
  const simulatorSessionId = String(context?.simulatorSessionId ?? simulator.simulatorSessionId ?? '');
  if (!userId || !simulatorSessionId) return;
  const key = LOG_KEY(userId, simulatorSessionId);
  const event: SimulatorLogEvent = {
    timestamp: Date.now(),
    eventName: eventName.slice(0, 96),
    category,
    simulatorSessionId,
    clientActivityIdSuffix: suffix(context?.clientActivityId ?? simulator.boundActivityClientId ?? simulator.latestActivityClientId),
    ownerSuffix: suffix(userId),
    virtualTimestamp: context?.virtualTimestamp ?? simulator.virtualTimestampMs ?? null,
    wallClockTimestamp: Date.now(),
    timeScale: simulator.timeScale,
    effectiveVirtualElapsed: simulator.effectiveVirtualElapsedMs,
    sampleSequence: simulator.sampleSequence,
    batchSequence: simulator.batchSequence,
    fields: sanitizeSimulatorLogFields(fields),
  };
  void loadSession(userId, simulatorSessionId).then((events) => {
    const next = bounded([...events, event]);
    memory.set(key, next);
    dirty.add(key);
    dirtyOwners.set(key, { userId, sessionId: simulatorSessionId });
    if (category === 'ERROR' || category === 'GPS_REJECT') void flushSimulatorLogs(userId);
    else scheduleFlush();
  });
}

export async function flushSimulatorLogs(requestedUserId?: string): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const entries = [...dirty]
    .map(key => ({ key, owner: dirtyOwners.get(key), events: bounded(memory.get(key) ?? []) }))
    .filter(entry => entry.owner && (!requestedUserId || entry.owner.userId === requestedUserId));
  if (entries.length === 0) return;
  const run = writeTail.then(async () => {
    for (const entry of entries) {
      await AsyncStorage.setItem(entry.key, JSON.stringify(entry.events));
      dirty.delete(entry.key);
      dirtyOwners.delete(entry.key);
      await updateIndex(entry.owner!.userId, entry.owner!.sessionId);
    }
  });
  writeTail = run.catch(() => {});
  await run;
}

export async function readSimulatorDiagnostics(userId: string): Promise<string> {
  await flushSimulatorLogs(userId);
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string').slice(0, MAX_SESSIONS);
  } catch { /* empty export */ }
  const lines: string[] = [];
  for (const sessionId of index) {
    const events = await loadSession(userId, sessionId);
    for (const event of events) lines.push(JSON.stringify(event));
  }
  return lines.join('\n');
}

export async function clearSimulatorLogs(userId: string): Promise<void> {
  await flushSimulatorLogs(userId);
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string');
  } catch { /* empty */ }
  for (const sessionId of index) {
    const key = LOG_KEY(userId, sessionId);
    memory.delete(key);
    loads.delete(key);
    dirty.delete(key);
    dirtyOwners.delete(key);
    await AsyncStorage.removeItem(key);
  }
  await AsyncStorage.removeItem(INDEX_KEY(userId));
}

export const SIMULATOR_LOG_LIMITS = {
  maxEventsPerSession: MAX_EVENTS_PER_SESSION,
  maxBytesPerSession: MAX_BYTES_PER_SESSION,
  maxSessions: MAX_SESSIONS,
} as const;

AppState.addEventListener('change', state => {
  if (state === 'background' || state === 'inactive') void flushSimulatorLogs();
});
