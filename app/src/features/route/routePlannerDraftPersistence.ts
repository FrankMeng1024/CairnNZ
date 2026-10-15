import { storage } from '../../store/storage';
import {
  cloneOrderedDraft,
  validateOrderedDraft,
  type OrderedRouteDraft,
  type RouteDraftHistory,
} from './orderedRouteDraft';
import type { DrawTransactionIntent } from './routeEditTransactions';

const KEY_PREFIX = '@cairn:route-planner:v1:';
const ownerWriteTails = new Map<string, Promise<void>>();
const ownerGenerations = new Map<string, number>();
const draftGenerations = new Map<string, number>();

function draftGenerationKey(ownerId: string, draftId: string): string {
  return `${ownerId}\u0000${draftId}`;
}

export interface PersistedRoutePlannerDraft {
  schemaVersion: 1;
  ownerId: string;
  draftId: string;
  history: RouteDraftHistory;
  name: string;
  permission: 'personal' | 'friend';
  sourceActivityId?: string;
  sourceRouteId?: string;
  reconnectsActivityGap?: boolean;
  pendingDraw?: Extract<DrawTransactionIntent, { kind: 'pending-bridge' | 'pending-replace' }>;
  savedAt: number;
}

/**
 * Source-specific editors recover only their exact draft. A new
 * "Plan a route" flow may recover only a source-free plan draft because the
 * account's latest pointer can also refer to an Activity import or copy.
 */
export function plannerDraftMatchesRequest(
  record: PersistedRoutePlannerDraft,
  requestedDraftId?: string,
): boolean {
  if (record.sourceActivityId || requestedDraftId?.startsWith('activity:')) return false;
  if (requestedDraftId) return record.draftId === requestedDraftId;
  return record.history.present.origin === 'plan'
    && !record.sourceActivityId
    && !record.sourceRouteId;
}

function draftKey(ownerId: string, draftId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(draftId)}`;
}

function latestKey(ownerId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(ownerId)}:latest`;
}

function validPendingDraw(value: any): boolean {
  return value?.pendingDraw == null || (
    (value.pendingDraw.kind === 'pending-bridge' || value.pendingDraw.kind === 'pending-replace')
    && Array.isArray(value.pendingDraw.points)
    && value.pendingDraw.points.length >= 2
    && value.pendingDraw.points.every((point: any) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    && value.pendingDraw.draftId === value.history?.present?.draftId
    && value.pendingDraw.baseRevision === value.history?.present?.revision
  );
}

function validRecord(value: any, ownerId: string): value is PersistedRoutePlannerDraft {
  return value?.schemaVersion === 1
    && value.ownerId === ownerId
    && value.draftId === value.history?.present?.draftId
    && value.history.present.ownerId === ownerId
    && validateOrderedDraft(value.history.present).length === 0
    && Array.isArray(value.history.past);
}

export async function saveRoutePlannerDraft(
  record: Omit<PersistedRoutePlannerDraft, 'schemaVersion' | 'savedAt'>,
): Promise<void> {
  const snapshot: PersistedRoutePlannerDraft = {
    ...record,
    schemaVersion: 1,
    history: {
      present: cloneOrderedDraft(record.history.present),
      past: record.history.past.map(item => ({
        operation: item.operation,
        draft: cloneOrderedDraft(item.draft),
      })),
    },
    pendingDraw: record.pendingDraw ? {
      ...record.pendingDraw,
      points: record.pendingDraw.points.map(point => ({ ...point })),
    } : undefined,
    savedAt: Date.now(),
  };
  const generation = ownerGenerations.get(record.ownerId) ?? 0;
  const draftGeneration = draftGenerations.get(draftGenerationKey(record.ownerId, record.draftId)) ?? 0;
  const previous = ownerWriteTails.get(record.ownerId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    if ((ownerGenerations.get(record.ownerId) ?? 0) !== generation) return;
    if ((draftGenerations.get(draftGenerationKey(record.ownerId, record.draftId)) ?? 0) !== draftGeneration) return;
    await storage.setItem(draftKey(record.ownerId, record.draftId), JSON.stringify(snapshot), { strict: true });
    if ((ownerGenerations.get(record.ownerId) ?? 0) !== generation) return;
    if ((draftGenerations.get(draftGenerationKey(record.ownerId, record.draftId)) ?? 0) !== draftGeneration) return;
    await storage.setItem(latestKey(record.ownerId), record.draftId, { strict: true });
  });
  ownerWriteTails.set(record.ownerId, write);
  try { await write; } finally {
    if (ownerWriteTails.get(record.ownerId) === write) ownerWriteTails.delete(record.ownerId);
  }
}

export async function loadRoutePlannerDraft(
  ownerId: string,
  requestedDraftId?: string,
): Promise<PersistedRoutePlannerDraft | null> {
  if (!ownerId) return null;
  const draftId = requestedDraftId ?? await storage.getItemStrict(latestKey(ownerId));
  if (!draftId) return null;
  const raw = await storage.getItemStrict(draftKey(ownerId, draftId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!validRecord(parsed, ownerId)) return null;
    // Older pre-closure drafts may contain an unfenced pending stroke. Keep
    // the valid Route/history, but discard that unsafe uncommitted edit.
    if (!validPendingDraw(parsed)) delete parsed.pendingDraw;
    return parsed;
  } catch {
    return null;
  }
}

export async function removeRoutePlannerDraft(ownerId: string, draftId: string): Promise<void> {
  await ownerWriteTails.get(ownerId)?.catch(() => undefined);
  await storage.removeItem(draftKey(ownerId, draftId), { strict: true });
  const latest = await storage.getItemStrict(latestKey(ownerId));
  if (latest === draftId) await storage.removeItem(latestKey(ownerId), { strict: true });
}

/**
 * Explicitly abandoning one creation session invalidates writes that were
 * already queued when Back was pressed, without touching saved Routes or
 * drafts owned by another creation session. The editor separately fences any
 * later debounce/callback with its abandoned-session set.
 */
export async function abandonRoutePlannerDraft(ownerId: string, draftId: string): Promise<void> {
  const key = draftGenerationKey(ownerId, draftId);
  draftGenerations.set(key, (draftGenerations.get(key) ?? 0) + 1);
  await ownerWriteTails.get(ownerId)?.catch(() => undefined);
  await storage.removeItem(draftKey(ownerId, draftId), { strict: true });
  const latest = await storage.getItemStrict(latestKey(ownerId));
  if (latest === draftId) await storage.removeItem(latestKey(ownerId), { strict: true });
}

export async function purgeRoutePlannerDraftsForOwner(ownerId: string): Promise<void> {
  if (!ownerId) throw new Error('route_planner_owner_required');
  ownerGenerations.set(ownerId, (ownerGenerations.get(ownerId) ?? 0) + 1);
  await ownerWriteTails.get(ownerId)?.catch(() => undefined);
  ownerWriteTails.delete(ownerId);
  const prefix = plannerDraftStoragePrefix(ownerId);
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(prefix));
  await storage.removeItemsStrict(keys);
}

export function plannerDraftStoragePrefix(ownerId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(ownerId)}:`;
}

export function clonePlannerHistory(history: RouteDraftHistory): RouteDraftHistory {
  return {
    present: cloneOrderedDraft(history.present),
    past: history.past.map(item => ({ operation: item.operation, draft: cloneOrderedDraft(item.draft) })),
  };
}

export function plannerRecordForDraft(
  draft: OrderedRouteDraft,
  partial: Omit<PersistedRoutePlannerDraft, 'schemaVersion' | 'savedAt' | 'ownerId' | 'draftId' | 'history'>,
): Omit<PersistedRoutePlannerDraft, 'schemaVersion' | 'savedAt'> {
  return {
    ownerId: draft.ownerId,
    draftId: draft.draftId,
    history: { present: cloneOrderedDraft(draft), past: [] },
    ...partial,
  };
}
