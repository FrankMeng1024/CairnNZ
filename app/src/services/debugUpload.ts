/**
 * debugUpload — user-initiated screenshot upload to /api/debug-snapshot.
 *
 * Settings screen exposes a "Upload debug screenshots" entry that lets a
 * user pick images from their device and POST them to the backend for
 * developer triage.
 *
 * Design decisions:
 *   - Returns a discriminated union (PickOutcome) instead of throwing for
 *     expected user paths (canceled, permission_denied). Callers don't
 *     need try/catch around normal flows.
 *   - Sequential uploads (NOT Promise.all) — the dev backend has rate
 *     limits per IP, parallel uploads risk 429.
 *   - Web platform short-circuits to error — expo-file-system uploadAsync
 *     is native-only.
 *   - No client-side size check — iOS screenshots top out ~5MB which the
 *     backend accepts; if too large, server 413 surfaces as upload error.
 *   - meta.source distinguishes 'ar' vs 'settings' for backend SQL
 *     debug-snapshot triage.
 *
 * Why not a hook: the upload itself is a one-shot async op, not a
 * subscription. State (idle/uploading/done) is owned by the calling
 * screen which manages its own UI; service is stateless.
 */

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Application from 'expo-application';
import { API_BASE_URL } from '../config/api';
import { OTA_VERSION } from '../components/OtaBadge';
import { crashLogger } from './crashLogger';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

export type UploadOrigin = 'ar' | 'settings';

export interface UploadProgress {
  index: number; // 1-based; matches the user-visible "i/N…" string
  total: number;
  ok: boolean;
}

export interface UploadResult {
  okCount: number;
  total: number;
  lastError: string | null;
}

/**
 * Discriminated union — callers handle each path explicitly. Throwing
 * for cancel/perm-denied would force every caller into try/catch which
 * obscures the intended flow.
 */
export type PickOutcome =
  | { kind: 'photos'; photos: PickedPhoto[] }
  | { kind: 'canceled' }
  | { kind: 'permission_denied' }
  | { kind: 'error'; message: string };

interface PickOpts {
  selectionLimit?: number; // default 3
}

export async function pickDebugScreenshots(opts: PickOpts = {}): Promise<PickOutcome> {
  const limit = opts.selectionLimit ?? 3;
  if (Platform.OS === 'web') {
    return { kind: 'error', message: 'Web upload not supported' };
  }
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return { kind: 'permission_denied' };
    }
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      quality: 1,
    });
    if (pick.canceled || !pick.assets?.length) {
      return { kind: 'canceled' };
    }
    return {
      kind: 'photos',
      photos: pick.assets.map((a) => ({
        uri: a.uri,
        width: a.width ?? 0,
        height: a.height ?? 0,
      })),
    };
  } catch (e: any) {
    return { kind: 'error', message: e?.message ?? 'pick failed' };
  }
}

export async function uploadDebugScreenshots(
  photos: PickedPhoto[],
  origin: UploadOrigin,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadResult> {
  const total = photos.length;
  if (Platform.OS === 'web') {
    return { okCount: 0, total, lastError: 'Web upload not supported' };
  }
  let okCount = 0;
  let lastError: string | null = null;
  for (let i = 0; i < total; i++) {
    const asset = photos[i];
    try {
      const id = `${origin}-${Date.now()}-${i}`;
      const meta = btoa(
        JSON.stringify({
          ota_v: OTA_VERSION,
          screen_w: asset.width,
          screen_h: asset.height,
          ts: Date.now(),
          batch_idx: i,
          batch_total: total,
          source: origin,
        }),
      );
      const url = `${API_BASE_URL}/api/debug-snapshot?id=${id}&meta=${encodeURIComponent(meta)}`;
      const uploadResult = await FileSystem.uploadAsync(url, asset.uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': 'image/png',
          'X-Cairn-Device-Os': Platform.OS,
          'X-Cairn-App-Version': Application.nativeApplicationVersion ?? 'unknown',
          'X-Cairn-Upload-Source': origin,
        },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        let errText = `HTTP ${uploadResult.status}`;
        try {
          const j = JSON.parse(uploadResult.body || '{}');
          if (j?.error) errText = j.error;
        } catch {
          /* keep code */
        }
        throw new Error(errText);
      }
      okCount++;
      crashLogger.breadcrumb(`debug-snapshot[${origin}] uploaded ${i + 1}/${total}: ${id}`);
      onProgress?.({ index: i + 1, total, ok: true });
    } catch (e: any) {
      lastError = e?.message ?? 'upload failed';
      crashLogger.breadcrumb(
        `debug-snapshot[${origin}] upload failed ${i + 1}/${total}: ${lastError}`,
      );
      onProgress?.({ index: i + 1, total, ok: false });
      // continue trying remaining photos
    }
  }
  return { okCount, total, lastError };
}
