import { AppState, Platform } from 'react-native';
import { storage } from '../../store/storage';
import { getPushPreferences, registerForPush, updatePushPreferences } from '../../services/pushService';

const ENABLED_PREFIX = 'cairn:encounter-notifications:v1:';
const OPENED_PREFIX = 'cairn:encounter-notification-open:v1:';

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

async function permissionStatus(): Promise<EncounterNotificationState['permission']> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const Notifications = await import('expo-notifications');
    const result = await Notifications.getPermissionsAsync();
    return result.status === 'granted' ? 'granted' : result.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export async function getEncounterNotificationState(ownerId: string): Promise<EncounterNotificationState> {
  const permission = await permissionStatus();
  const chosen = ownerId ? await storage.getItem(enabledKey(ownerId)).catch(() => null) : null;
  const serverPrefs = ownerId && Platform.OS !== 'web' ? await getPushPreferences() : null;
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
  if (!enabled) {
    const prefs = await updatePushPreferences({ memoryHits: false });
    if (prefs) await storage.setItem(enabledKey(ownerId), '0', { strict: true });
    return getEncounterNotificationState(ownerId);
  }
  const token = await registerForPush({ requestPermission: true });
  if (!token) {
    await storage.setItem(enabledKey(ownerId), '0');
    return getEncounterNotificationState(ownerId);
  }
  await storage.setItem(enabledKey(ownerId), '1', { strict: true });
  const prefs = await updatePushPreferences({ memoryHits: true });
  if (!prefs) {
    await storage.setItem(enabledKey(ownerId), '0', { strict: true });
    return getEncounterNotificationState(ownerId);
  }
  return getEncounterNotificationState(ownerId);
}

/** Refresh an existing opt-in at login without ever presenting a permission prompt. */
export async function resumeEncounterNotifications(ownerId: string): Promise<void> {
  if (!ownerId || Platform.OS === 'web') return;
  const chosen = await storage.getItem(enabledKey(ownerId)).catch(() => null);
  if (chosen !== '1') return;
  const prefs = await getPushPreferences();
  if (!prefs?.memoryHits) return;
  const token = await registerForPush({ requestPermission: false });
  if (token) await updatePushPreferences({ memoryHits: true });
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

export async function consumeCairnNotificationResponse(
  response: any,
  expectedOwnerId: string,
): Promise<CairnNotificationDestination | null> {
  const data = response?.notification?.request?.content?.data;
  if (data?.kind !== 'memory_hit') return null;
  const viewerId = String(data?.viewer_id ?? '');
  const notificationId = String(data?.notification_log_id ?? response?.notification?.request?.identifier ?? '');
  if (!expectedOwnerId || viewerId !== expectedOwnerId || !notificationId) return null;
  const prior = await storage.getItem(openedKey(expectedOwnerId)).catch(() => null);
  if (prior === notificationId) return null;
  await storage.setItem(openedKey(expectedOwnerId), notificationId, { strict: true });
  return {
    viewerId,
    presentationGroupId: data?.related_id == null ? null : String(data.related_id),
    notificationId,
  };
}

export const __encounterNotificationTest = { enabledKey, openedKey };
