import { AppState, Platform } from 'react-native';
import { storage } from '../../store/storage';
import { getPushPreferences, registerForPush, updatePushPreferences } from '../../services/pushService';
import { useAppStore } from '../../store/useAppStore';

const ENABLED_PREFIX = 'cairn:encounter-notifications:v1:';
const OPENED_PREFIX = 'cairn:encounter-notification-open:v1:';
const MAX_OPEN_ENTRIES = 32;
const OPEN_ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 2 * 60 * 1000;

type OpenLifecycleState = 'pending' | 'processing' | 'completed';
type OpenLifecycleEntry = {
  notificationId: string;
  presentationGroupId: string | null;
  state: OpenLifecycleState;
  updatedAtMs: number;
  attempts: number;
};
type OpenLifecycle = { v: 2; entries: OpenLifecycleEntry[] };

let preferenceSequence = 0;
const preferenceIntents = new Map<string, { sequence: number; enabled: boolean }>();
const preferenceTails = new Map<string, Promise<EncounterNotificationState>>();
const openTails = new Map<string, Promise<unknown>>();

export type EncounterNotificationState = {
  supported: boolean;
  enabled: boolean;
  permission: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  detail: string;
};

export type CairnNotificationDestination = {
  viewerId: string;
  presentationGroupId: string | null;
  notificationId: string;
};

export function shouldShowCairnNotificationSurface(kind: unknown, appState: string): boolean {
  return kind !== 'memory_hit' || appState !== 'active';
}

const enabledKey = (ownerId: string) => `${ENABLED_PREFIX}${encodeURIComponent(ownerId)}`;
const openedKey = (ownerId: string) => `${OPENED_PREFIX}${encodeURIComponent(ownerId)}`;

function ownerIsCurrent(ownerId: string): boolean {
  const app = useAppStore.getState();
  return Boolean(ownerId && app.isLoggedIn && String(app.user?.id ?? '') === ownerId);
}

async function permissionStatus(isCurrent: () => boolean = () => true): Promise<EncounterNotificationState['permission']> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    if (!isCurrent()) return 'unavailable';
    const Notifications = await import('expo-notifications');
    if (!isCurrent()) return 'unavailable';
    const result = await Notifications.getPermissionsAsync();
    if (!isCurrent()) return 'unavailable';
    return result.status === 'granted' ? 'granted' : result.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export async function getEncounterNotificationState(ownerId: string): Promise<EncounterNotificationState> {
  const isCurrent = () => ownerIsCurrent(ownerId);
  const permission = await permissionStatus(isCurrent);
  if (Platform.OS !== 'web' && !isCurrent()) return {
    supported: false, enabled: false, permission: 'unavailable',
    detail: 'Notification state belongs to the currently signed-in account.',
  };
  const chosen = ownerId ? await storage.getItem(enabledKey(ownerId)).catch(() => null) : null;
  if (Platform.OS !== 'web' && !isCurrent()) return {
    supported: false, enabled: false, permission: 'unavailable',
    detail: 'Notification state belongs to the currently signed-in account.',
  };
  const serverPrefs = ownerId && Platform.OS !== 'web' ? await getPushPreferences(ownerId) : null;
  if (Platform.OS !== 'web' && !isCurrent()) return {
    supported: false, enabled: false, permission: 'unavailable',
    detail: 'Notification state belongs to the currently signed-in account.',
  };
  const enabled = chosen === '1' && permission === 'granted' && serverPrefs?.memoryHits === true;
  return {
    supported: Platform.OS !== 'web' && permission !== 'unavailable',
    enabled,
    permission,
    detail: Platform.OS === 'web'
      ? 'System encounter notifications are available only in the installed iPhone or Android app.'
      : permission === 'denied'
        ? 'Notifications are off in system Settings. Encounters still appear in Memory.'
        : chosen === '1' && serverPrefs == null
          ? 'Could not confirm the server setting. Encounters still save to Memory; try again when online.'
        : enabled
          ? 'A private system alert may appear after the server confirms a new encounter. Delivery timing is controlled by the device.'
          : 'Off. Encountered Cairns still save to Memory and appear in the app.',
  };
}

export async function setEncounterNotificationsEnabled(ownerId: string, enabled: boolean): Promise<EncounterNotificationState> {
  if (!ownerId || Platform.OS === 'web') return getEncounterNotificationState(ownerId);
  const intent = { sequence: ++preferenceSequence, enabled };
  preferenceIntents.set(ownerId, intent);
  const previous = preferenceTails.get(ownerId) ?? Promise.resolve({
    supported: false, enabled: false, permission: 'unavailable' as const, detail: '',
  });
  const work = previous.catch(() => ({ supported: false, enabled: false, permission: 'unavailable' as const, detail: '' })).then(async () => {
    const isCurrent = () => ownerIsCurrent(ownerId)
      && preferenceIntents.get(ownerId)?.sequence === intent.sequence
      && preferenceIntents.get(ownerId)?.enabled === enabled;
    if (!isCurrent()) return getEncounterNotificationState(ownerId);
    if (!enabled) {
      const prefs = await updatePushPreferences({ memoryHits: false }, ownerId);
      if (!isCurrent()) return getEncounterNotificationState(ownerId);
      if (prefs) await storage.setItem(enabledKey(ownerId), '0', { strict: true });
      if (!isCurrent()) return getEncounterNotificationState(ownerId);
      return getEncounterNotificationState(ownerId);
    }
    const token = await registerForPush({ requestPermission: true, expectedUserId: ownerId, isCurrent });
    if (!isCurrent()) return getEncounterNotificationState(ownerId);
    if (!token) {
      await storage.setItem(enabledKey(ownerId), '0');
      return getEncounterNotificationState(ownerId);
    }
    await storage.setItem(enabledKey(ownerId), '1', { strict: true });
    if (!isCurrent()) return getEncounterNotificationState(ownerId);
    const prefs = await updatePushPreferences({ memoryHits: true }, ownerId);
    if (!isCurrent()) return getEncounterNotificationState(ownerId);
    if (!prefs) await storage.setItem(enabledKey(ownerId), '0', { strict: true });
    return getEncounterNotificationState(ownerId);
  });
  preferenceTails.set(ownerId, work);
  try { return await work; } finally {
    if (preferenceTails.get(ownerId) === work) preferenceTails.delete(ownerId);
  }
}

/** Refresh an existing opt-in at login without ever presenting a permission prompt. */
export async function resumeEncounterNotifications(ownerId: string): Promise<void> {
  if (!ownerId || Platform.OS === 'web') return;
  const isCurrent = () => ownerIsCurrent(ownerId) && preferenceIntents.get(ownerId)?.enabled !== false;
  if (!isCurrent()) return;
  const chosen = await storage.getItem(enabledKey(ownerId)).catch(() => null);
  if (!isCurrent() || chosen !== '1') return;
  const prefs = await getPushPreferences(ownerId);
  if (!isCurrent() || !prefs?.memoryHits) return;
  const token = await registerForPush({ requestPermission: false, expectedUserId: ownerId, isCurrent });
  if (!isCurrent() || !token) return;
  await updatePushPreferences({ memoryHits: true }, ownerId);
}

export async function configureCairnNotificationPresentation(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async notification => {
        // Only a Cairn encounter has the in-app presentation channel that can
        // replace a foreground banner. Preserve the established presentation
        // of every unrelated notification kind.
        const showSystemSurface = shouldShowCairnNotificationSurface(
          notification.request.content.data?.kind,
          AppState.currentState,
        );
        return {
          shouldShowAlert: showSystemSurface,
          shouldShowBanner: showSystemSurface,
          shouldShowList: showSystemSurface,
          shouldPlaySound: showSystemSurface,
          shouldSetBadge: false,
        };
      },
    });
  } catch { /* installed native capability is verified separately */ }
}

function normalizeOpenLifecycle(raw: string | null, now = Date.now()): OpenLifecycle {
  if (!raw) return { v: 2, entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && Array.isArray(parsed.entries)) {
      return {
        v: 2,
        entries: parsed.entries.filter((entry: any) => entry
          && typeof entry.notificationId === 'string'
          && ['pending', 'processing', 'completed'].includes(entry.state)
          && Number.isFinite(entry.updatedAtMs)
          && now - entry.updatedAtMs <= OPEN_ENTRY_TTL_MS)
          .slice(-MAX_OPEN_ENTRIES),
      };
    }
  } catch { /* deployed v1 was a plain notification id */ }
  return {
    v: 2,
    entries: [{
      notificationId: raw,
      presentationGroupId: null,
      state: 'completed',
      updatedAtMs: now,
      attempts: 1,
    }],
  };
}

async function withOpenLifecycle<T>(ownerId: string, operation: (lifecycle: OpenLifecycle) => Promise<T>): Promise<T> {
  const previous = openTails.get(ownerId) ?? Promise.resolve();
  let resolveTail!: () => void;
  const tail = new Promise<void>(resolve => { resolveTail = resolve; });
  const currentTail = previous.catch(() => undefined).then(() => tail);
  openTails.set(ownerId, currentTail);
  await previous.catch(() => undefined);
  try {
    const raw = await storage.getItem(openedKey(ownerId)).catch(() => null);
    const lifecycle = normalizeOpenLifecycle(raw);
    return await operation(lifecycle);
  } finally {
    resolveTail();
    if (openTails.get(ownerId) === currentTail) openTails.delete(ownerId);
  }
}

async function saveOpenLifecycle(ownerId: string, lifecycle: OpenLifecycle): Promise<void> {
  lifecycle.entries = lifecycle.entries
    .sort((a, b) => a.updatedAtMs - b.updatedAtMs)
    .slice(-MAX_OPEN_ENTRIES);
  await storage.setItem(openedKey(ownerId), JSON.stringify(lifecycle), { strict: true });
}

export async function consumeCairnNotificationResponse(
  response: any,
  expectedOwnerId: string,
): Promise<CairnNotificationDestination | null> {
  const data = response?.notification?.request?.content?.data;
  if (data?.kind !== 'memory_hit') return null;
  const viewerId = String(data?.viewer_id ?? '');
  const notificationId = String(data?.notification_log_id ?? response?.notification?.request?.identifier ?? '');
  if (!expectedOwnerId || viewerId !== expectedOwnerId || !notificationId) return null;
  if (!ownerIsCurrent(expectedOwnerId)) return null;
  const presentationGroupId = data?.related_id == null ? null : String(data.related_id);
  return withOpenLifecycle(expectedOwnerId, async lifecycle => {
    if (!ownerIsCurrent(expectedOwnerId)) return null;
    const now = Date.now();
    const prior = lifecycle.entries.find(entry => entry.notificationId === notificationId);
    if (prior?.state === 'completed') return null;
    if (prior?.state === 'processing' && now - prior.updatedAtMs < PROCESSING_STALE_MS) return null;
    const next: OpenLifecycleEntry = {
      notificationId,
      presentationGroupId,
      state: 'processing',
      updatedAtMs: now,
      attempts: Math.max(0, Number(prior?.attempts) || 0) + 1,
    };
    lifecycle.entries = [...lifecycle.entries.filter(entry => entry.notificationId !== notificationId), next];
    await saveOpenLifecycle(expectedOwnerId, lifecycle);
    if (!ownerIsCurrent(expectedOwnerId)) return null;
    return { viewerId, presentationGroupId, notificationId };
  });
}

export async function completeCairnNotificationResponse(destination: CairnNotificationDestination): Promise<void> {
  if (!ownerIsCurrent(destination.viewerId)) return;
  await withOpenLifecycle(destination.viewerId, async lifecycle => {
    if (!ownerIsCurrent(destination.viewerId)) return;
    const now = Date.now();
    const prior = lifecycle.entries.find(entry => entry.notificationId === destination.notificationId);
    const completed: OpenLifecycleEntry = {
      notificationId: destination.notificationId,
      presentationGroupId: destination.presentationGroupId,
      state: 'completed',
      updatedAtMs: now,
      attempts: Math.max(1, Number(prior?.attempts) || 1),
    };
    lifecycle.entries = [...lifecycle.entries.filter(entry => entry.notificationId !== destination.notificationId), completed];
    await saveOpenLifecycle(destination.viewerId, lifecycle);
  });
}

export async function releaseCairnNotificationResponse(destination: CairnNotificationDestination): Promise<void> {
  if (!ownerIsCurrent(destination.viewerId)) return;
  await withOpenLifecycle(destination.viewerId, async lifecycle => {
    if (!ownerIsCurrent(destination.viewerId)) return;
    const prior = lifecycle.entries.find(entry => entry.notificationId === destination.notificationId);
    if (!prior || prior.state === 'completed') return;
    lifecycle.entries = lifecycle.entries.map(entry => entry.notificationId === destination.notificationId
      ? { ...entry, state: 'pending' as const, updatedAtMs: Date.now() }
      : entry);
    await saveOpenLifecycle(destination.viewerId, lifecycle);
  });
}

export const __encounterNotificationTest = {
  enabledKey,
  openedKey,
  reset() {
    preferenceSequence = 0;
    preferenceIntents.clear();
    preferenceTails.clear();
    openTails.clear();
  },
};
