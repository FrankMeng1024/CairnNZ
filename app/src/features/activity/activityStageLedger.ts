import { storage } from '../../store/storage';

export type ActivityStage =
  | 'activity-start'
  | 'observation-received'
  | 'observation-decision'
  | 'canonical-accepted'
  | 'wal-committed'
  | 'store-published'
  | 'presentation'
  | 'memory-responsibility'
  | 'memory-local-commit'
  | 'provider-state'
  | 'final-job'
  | 'final-selected'
  | 'completion-presented'
  | 'detail-selected';

export interface ActivityStageLedgerEvent {
  schema: 'cairn-activity-stage-ledger';
  version: 1;
  eventId: string;
  ownerUserId: string;
  clientActivityId: string;
  stage: ActivityStage;
  wallTimeMs: number;
  monotonicTimeMs: number | null;
  processOriginWallTimeMs: number | null;
  processId: string;
  evidenceId?: string | null;
  details: Record<string, unknown>;
}

export interface ActivityStageLedgerExport {
  schema: 'cairn-activity-stage-ledger-export';
  version: 1;
  exportedAt: string;
  ownerUserId: string;
  clientActivityId: string | null;
  installedIdentity: ReturnType<typeof installedIdentity>;
  privacy: {
    localOnly: true;
    coordinatesIncluded: false;
    automaticUpload: false;
  };
  presentationMeasurement: 'NOT_MEASURED';
  events: ActivityStageLedgerEvent[];
}

const ROOT = '@cairn:activity-stage-ledger:v1:';
const MAX_EVENTS_PER_ACTIVITY = 1_200;
const MAX_ACTIVITIES_PER_OWNER = 3;
const processMonotonicOrigin = typeof globalThis.performance?.now === 'function'
  ? Date.now() - globalThis.performance.now()
  : null;
const processId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let eventSequence = 0;
const writes = new Set<Promise<void>>();
const trimTails = new Map<string, Promise<void>>();

function encoded(value: string): string { return encodeURIComponent(value); }
function activityPrefix(ownerUserId: string, clientActivityId: string): string {
  return `${ROOT}${encoded(ownerUserId)}:${encoded(clientActivityId)}:`;
}
function ownerPrefix(ownerUserId: string): string { return `${ROOT}${encoded(ownerUserId)}:`; }

export function activityStageMonotonicNow(): number | null {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : null;
}

function installedIdentity() {
  let nativeApplicationVersion: string | null = null;
  let nativeBuildVersion: string | null = null;
  let applicationId: string | null = null;
  let updateId: string | null = null;
  let runtimeVersion: string | null = null;
  let channel: string | null = null;
  let updateGroup: string | null = null;
  let updateFingerprint: string | null = null;
  let isEmbeddedLaunch: boolean | null = null;
  let isEmergencyLaunch: boolean | null = null;
  try {
    // Headless/test runtimes may not install the native module. Identity is
    // optional evidence and must never prevent Activity recording.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Application = require('expo-application');
    nativeApplicationVersion = Application.nativeApplicationVersion ?? null;
    nativeBuildVersion = Application.nativeBuildVersion ?? null;
    applicationId = Application.applicationId ?? null;
  } catch { /* native identity unavailable */ }
  try {
    // Dynamic loading keeps headless and Jest runtimes usable when Updates is
    // intentionally absent. These are installed-binary facts, never source-HEAD claims.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates');
    updateId = Updates.updateId ?? null;
    runtimeVersion = Updates.runtimeVersion ?? null;
    channel = Updates.channel ?? null;
    const manifest = Updates.manifest as Record<string, any> | null | undefined;
    updateGroup = manifest?.metadata?.updateGroup ?? manifest?.extra?.updateGroup ?? null;
    updateFingerprint = manifest?.metadata?.fingerprint ?? manifest?.extra?.fingerprint ?? null;
    isEmbeddedLaunch = typeof Updates.isEmbeddedLaunch === 'boolean' ? Updates.isEmbeddedLaunch : null;
    isEmergencyLaunch = typeof Updates.isEmergencyLaunch === 'boolean' ? Updates.isEmergencyLaunch : null;
  } catch { /* installed native runtime may not expose expo-updates */ }
  return {
    nativeApplicationVersion,
    nativeBuildVersion,
    applicationId,
    updateId,
    runtimeVersion,
    channel,
    updateGroup,
    updateFingerprint,
    isEmbeddedLaunch,
    isEmergencyLaunch,
  };
}

function privacySafeDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 64).map(privacySafeDetails);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/(?:pk|sk)\.[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]')
      .replace(/([?&]access_token=)[^&\s]+/gi, '$1[REDACTED_TOKEN]')
      .slice(0, 180);
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (normalized === 'lat' || normalized === 'latitude'
      || normalized === 'lng' || normalized === 'lon' || normalized === 'longitude'
      || normalized.includes('coordinate') || normalized.includes('token')) continue;
    result[key] = privacySafeDetails(child);
  }
  return result;
}

async function strictKeys(): Promise<string[]> {
  return typeof storage.getAllKeysStrict === 'function' ? storage.getAllKeysStrict() : [];
}

async function trimOwner(ownerUserId: string): Promise<void> {
  const prefix = ownerPrefix(ownerUserId);
  const keys = (await strictKeys()).filter(key => key.startsWith(prefix)).sort();
  const byActivity = new Map<string, string[]>();
  for (const key of keys) {
    const remainder = key.slice(prefix.length);
    const separator = remainder.indexOf(':');
    if (separator < 0) continue;
    const activity = remainder.slice(0, separator);
    const activityKeys = byActivity.get(activity) ?? [];
    activityKeys.push(key);
    byActivity.set(activity, activityKeys);
  }
  const ordered = [...byActivity.entries()].sort((left, right) => {
    const leftLast = (left[1][left[1].length - 1] ?? '').split(':').pop() ?? '';
    const rightLast = (right[1][right[1].length - 1] ?? '').split(':').pop() ?? '';
    return rightLast.localeCompare(leftLast);
  });
  const remove = ordered.flatMap(([_, activityKeys], activityIndex) => {
    if (activityIndex >= MAX_ACTIVITIES_PER_OWNER) return activityKeys;
    return activityKeys.slice(0, Math.max(0, activityKeys.length - MAX_EVENTS_PER_ACTIVITY));
  });
  if (remove.length > 0) await storage.removeItemsStrict(remove);
}

function scheduleTrim(ownerUserId: string): void {
  if (eventSequence % 64 !== 0) return;
  const previous = trimTails.get(ownerUserId)?.catch(() => undefined) ?? Promise.resolve();
  const next = previous.then(() => trimOwner(ownerUserId)).catch(() => undefined);
  trimTails.set(ownerUserId, next);
  void next.finally(() => {
    if (trimTails.get(ownerUserId) === next) trimTails.delete(ownerUserId);
  });
}

/**
 * Persist one privacy-safe stage fact without joining the GPS ingest mutex.
 * Coordinates and credential-shaped fields are removed at this boundary.
 */
export function recordActivityStageEvent(input: {
  ownerUserId: string;
  clientActivityId: string;
  stage: ActivityStage;
  evidenceId?: string | null;
  wallTimeMs?: number;
  monotonicTimeMs?: number | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!input.ownerUserId || !input.clientActivityId) return Promise.resolve();
  const decisionWallTimeMs = input.details?.decisionWallTimeMs;
  const wallTimeMs = Math.floor(
    input.wallTimeMs
      ?? (typeof decisionWallTimeMs === 'number' && Number.isFinite(decisionWallTimeMs)
        ? decisionWallTimeMs
        : Date.now()),
  );
  const monotonicTimeMs = input.monotonicTimeMs === undefined
    ? activityStageMonotonicNow()
    : input.monotonicTimeMs;
  const sequence = eventSequence += 1;
  const eventId = `${wallTimeMs.toString().padStart(13, '0')}-${sequence.toString().padStart(8, '0')}`;
  const event: ActivityStageLedgerEvent = {
    schema: 'cairn-activity-stage-ledger',
    version: 1,
    eventId,
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    stage: input.stage,
    wallTimeMs,
    monotonicTimeMs: monotonicTimeMs == null ? null : Number(monotonicTimeMs.toFixed(3)),
    processOriginWallTimeMs: processMonotonicOrigin == null ? null : Math.round(processMonotonicOrigin),
    processId,
    evidenceId: input.evidenceId ?? null,
    details: privacySafeDetails(input.details ?? {}) as Record<string, unknown>,
  };
  const key = `${activityPrefix(input.ownerUserId, input.clientActivityId)}${eventId}`;
  let write!: Promise<void>;
  write = storage.setItem(key, JSON.stringify(event), { strict: true })
    .catch(() => undefined)
    .finally(() => writes.delete(write));
  writes.add(write);
  scheduleTrim(input.ownerUserId);
  return write;
}

/** Mandatory Finish/background boundary: queued ledger writes are not deadline-truncated. */
export async function flushActivityStageLedger(ownerUserId?: string): Promise<void> {
  await Promise.allSettled([...writes]);
  if (ownerUserId) await trimTails.get(ownerUserId)?.catch(() => undefined);
}

export async function exportLatestActivityStageLedger(
  ownerUserId: string,
): Promise<ActivityStageLedgerExport> {
  await flushActivityStageLedger(ownerUserId);
  const prefix = ownerPrefix(ownerUserId);
  const keys = (await strictKeys()).filter(key => key.startsWith(prefix)).sort();
  const latestKey = [...keys].sort((left, right) => {
    const leftEvent = left.split(':').pop() ?? '';
    const rightEvent = right.split(':').pop() ?? '';
    return rightEvent.localeCompare(leftEvent);
  })[0] ?? null;
  const latestEncodedActivity = latestKey
    ? latestKey.slice(prefix.length).split(':')[0]
    : null;
  const activityKeys = latestEncodedActivity
    ? keys.filter(key => key.startsWith(`${prefix}${latestEncodedActivity}:`)).slice(-MAX_EVENTS_PER_ACTIVITY)
    : [];
  const raw = await Promise.all(activityKeys.map(key => storage.getItemStrict(key)));
  const events = raw.flatMap(value => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as ActivityStageLedgerEvent;
      return parsed?.schema === 'cairn-activity-stage-ledger' ? [parsed] : [];
    } catch { return []; }
  }).sort((left, right) => left.wallTimeMs - right.wallTimeMs || left.eventId.localeCompare(right.eventId));
  return {
    schema: 'cairn-activity-stage-ledger-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    ownerUserId: 'current-owner',
    clientActivityId: events[0]?.clientActivityId ?? null,
    installedIdentity: installedIdentity(),
    privacy: { localOnly: true, coordinatesIncluded: false, automaticUpload: false },
    presentationMeasurement: 'NOT_MEASURED',
    events: events.map(event => ({ ...event, ownerUserId: 'current-owner' })),
  };
}

export async function purgeActivityStageLedgerForOwner(ownerUserId: string): Promise<void> {
  await flushActivityStageLedger(ownerUserId);
  const keys = (await strictKeys()).filter(key => key.startsWith(ownerPrefix(ownerUserId)));
  await storage.removeItemsStrict(keys);
}

export function activityStageLedgerOwnerPrefix(ownerUserId: string): string {
  return ownerPrefix(ownerUserId);
}
