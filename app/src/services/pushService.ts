/**
 * pushService — Batch 6.5 push notification client wrapper.
 *
 * Responsibilities:
 *   - Request iOS/Android notification permissions
 *   - Get the Expo push token (bridges APNs/FCM under one API)
 *   - POST /api/push/register to store it server-side
 *   - Unregister on sign-out
 *   - Fetch + update preferences
 *   - Fetch the notification list for the in-app inbox
 *
 * Contract:
 *   - Request permission only from an explicit, informed user action.
 *   - On later authenticated boots, registerForPush({ requestPermission: false })
 *     may silently restore a previously granted, server-enabled registration.
 *     The same token is upserted server-side.
 *   - Call unregisterCurrent() on logout so the retired token stops
 *     receiving pushes.
 *
 * Web fallback: web push tokens are not yet wired; registerForPush()
 * returns null on web without side effects.
 */
import { Platform } from 'react-native';
import { authenticatedFetch } from './apiService';
import { crashLogger } from './crashLogger';

let cachedToken: string | null = null;

export async function registerForPush(options: {
  requestPermission?: boolean;
  expectedUserId?: string;
  isCurrent?: () => boolean;
} = {}): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const current = () => options.isCurrent?.() !== false;
  try {
    if (!current()) return null;
    const Notifications = await import('expo-notifications');
    if (!current()) return null;
    const Device = await import('expo-device');
    if (!current()) return null;

    // Simulator / emulator returns no token — bail early.
    if (!Device.isDevice) {
      crashLogger.breadcrumb('push:skip_simulator');
      return null;
    }

    // Ask permission. If already granted, existingStatus is 'granted'.
    const settings = await Notifications.getPermissionsAsync();
    if (!current()) return null;
    let status = settings.status;
    if (status !== 'granted') {
      if (options.requestPermission === false) return null;
      const req = await Notifications.requestPermissionsAsync();
      if (!current()) return null;
      status = req.status;
    }
    if (status !== 'granted') {
      crashLogger.breadcrumb(`push:permission_denied status=${status}`);
      return null;
    }

    // On Android 8+ the notification channel must exist before tokens are usable.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Cairn',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      if (!current()) return null;
    }

    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
      || (await import('expo-constants')).default.expoConfig?.extra?.eas?.projectId;
    if (!current()) return null;
    const tokenObj = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!current()) return null;
    const token = tokenObj?.data;
    if (!token) {
      crashLogger.breadcrumb('push:no_token_returned');
      return null;
    }
    cachedToken = token;

    // Ship to backend (best-effort).
    try {
      const registered = await authenticatedFetch('/api/push/register', {
        method: 'POST',
        expectedUserId: options.expectedUserId,
        body: JSON.stringify({
          token,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        }),
      });
      if (!current()) return null;
      if (!registered.ok) {
        crashLogger.breadcrumb(`push:register_failed status=${registered.status}`);
        return null;
      }
      crashLogger.breadcrumb(`push:registered platform=${Platform.OS}`);
    } catch (regErr: any) {
      crashLogger.breadcrumb(`push:register_failed ${String(regErr?.message || regErr).slice(0, 80)}`);
      return null;
    }
    return token;
  } catch (err: any) {
    crashLogger.breadcrumb(`push:setup_failed ${String(err?.message || err).slice(0, 80)}`);
    return null;
  }
}

export async function unregisterCurrent(): Promise<void> {
  // Sprint 6 round-13 R13B6 fix: cachedToken is module-level in-memory
  // and null after cold boot. If the user logs in briefly and then
  // logs out without triggering registerForPush to completion,
  // unregisterCurrent silently no-ops and the backend keeps sending
  // pushes until the 60-day sweep. Now: on null cachedToken, ask
  // expo-notifications for the CURRENT device token so we can still
  // unregister the correct row.
  let token = cachedToken;
  if (!token && Platform.OS !== 'web') {
    try {
      const Notifications = await import('expo-notifications');
      const Device = await import('expo-device');
      if (Device.isDevice) {
        const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
          || (await import('expo-constants')).default.expoConfig?.extra?.eas?.projectId;
        const tokenObj = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        token = tokenObj?.data ?? null;
      }
    } catch { /* silent — no token available */ }
  }
  if (!token) return;
  try {
    await authenticatedFetch('/api/push/unregister', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    crashLogger.breadcrumb('push:unregistered');
  } catch (err: any) {
    crashLogger.breadcrumb(`push:unregister_failed ${String(err?.message || err).slice(0, 80)}`);
  }
  cachedToken = null;
}

export interface PushPreferences {
  friendRequests: boolean;
  markerReplies: boolean;
  memoryHits: boolean;
  announcements: boolean;
}

export async function getPushPreferences(expectedUserId?: string): Promise<PushPreferences | null> {
  // Sprint 6 round-43 R43B5: log preference fetch failures so a
  // 401 (auth expired) or 500 (server issue) is diagnosable instead
  // of silently rendering defaults + overwriting server state on
  // next PATCH. Return value stays null on any failure — no behavior
  // change, purely observability.
  try {
    const res = await authenticatedFetch('/api/push/preferences', { expectedUserId });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('[pushService] getPushPreferences non-OK:', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pushService] getPushPreferences threw:', String(err).slice(0, 200));
    return null;
  }
}

export async function updatePushPreferences(
  update: Partial<PushPreferences>,
  expectedUserId?: string,
): Promise<PushPreferences | null> {
  try {
    const res = await authenticatedFetch('/api/push/preferences', {
      method: 'PATCH',
      expectedUserId,
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      // Sprint 6 R43B5: log so a 401 doesn't look like a no-op success.
      // eslint-disable-next-line no-console
      console.warn('[pushService] updatePushPreferences non-OK:', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pushService] updatePushPreferences threw:', String(err).slice(0, 200));
    return null;
  }
}

export interface NotificationLogEntry {
  id: number;
  recipient_user_id: number;
  actor_user_id: number | null;
  kind: string;
  related_id: number | null;
  title: string;
  body: string | null;
  status: string;
  created_at: string;
}

export async function fetchNotificationLog(limit = 50): Promise<NotificationLogEntry[]> {
  // Sprint 6 R43B5: log failures for diagnosability.
  try {
    const res = await authenticatedFetch(`/api/push/log?limit=${limit}`);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('[pushService] fetchNotificationLog non-OK:', res.status);
      return [];
    }
    return await res.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pushService] fetchNotificationLog threw:', String(err).slice(0, 200));
    return [];
  }
}
