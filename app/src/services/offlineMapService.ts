/**
 * Offline Map Manager — handles tile pack downloads using Mapbox offlineManager.
 *
 * Sprint 43 — STORY-00141
 * Gracefully degrades when Mapbox is not available (Expo Go).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NZ_OFFLINE_PACKS, type OfflinePack } from '../config/offlinePacks';

/**
 * O18 ROUTE-08: build an on-the-fly OfflinePack around a specific route's
 * geometry. Adds a small buffer (~1km) so the user gets the surrounding
 * context, not just the exact line. Returns null if the route has no
 * points (defensive — a route with 0 points is a UI bug).
 *
 * Uses `route-{routeId}` as the pack id so users can re-download the
 * same route without polluting the pack list, and can delete cleanly.
 */
export function packFromRoute(
  routeId: string,
  name: string,
  points: Array<{ lat: number; lng: number }>,
): OfflinePack | null {
  if (!points.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  // ~0.01deg ≈ 1.1km latitude / ~0.9km at NZ longitudes — enough context
  // without exploding tile count.
  const pad = 0.01;
  return {
    id: `route-${routeId}`,
    name: `Route: ${name}`,
    description: 'Offline tiles for this saved route.',
    bounds: [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad],
    minZoom: 10,
    maxZoom: 15,
    // Rough estimate — actual size depends on tile density; users see the
    // final size in the download progress.
    estimatedSizeMB: 25,
  };
}

// Mapbox offlineManager — conditional import
let offlineManager: any = null;
try {
  const Mapbox = require('@rnmapbox/maps');
  offlineManager = Mapbox.offlineManager;
} catch {
  // Mapbox not available
}

const STORAGE_KEY = 'cairn_offline_packs';

export interface DownloadedPackInfo {
  id: string;
  name: string;
  status: 'downloading' | 'complete' | 'paused' | 'error';
  progress: number; // 0-100
  downloadedAt?: number;
  sizeBytes?: number;
}

type DownloadProgressCallback = (packId: string, progress: number) => void;
type DownloadErrorCallback = (packId: string, error: string) => void;

/**
 * Get downloaded packs from persistent storage.
 */
export async function getDownloadedPacks(): Promise<DownloadedPackInfo[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save downloaded pack info to persistent storage.
 */
async function saveDownloadedPacks(packs: DownloadedPackInfo[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
}

/**
 * Start downloading an offline pack.
 */
export async function downloadPack(
  pack: OfflinePack,
  onProgress?: DownloadProgressCallback,
  onError?: DownloadErrorCallback,
): Promise<boolean> {
  if (!offlineManager) {
    onError?.(pack.id, 'Mapbox not available — use EAS development build');
    return false;
  }

  try {
    // Update status to downloading
    const packs = await getDownloadedPacks();
    const existing = packs.find(p => p.id === pack.id);
    if (existing) {
      existing.status = 'downloading';
      existing.progress = 0;
    } else {
      packs.push({ id: pack.id, name: pack.name, status: 'downloading', progress: 0 });
    }
    await saveDownloadedPacks(packs);

    // Create the offline pack
    await offlineManager.createPack(
      {
        name: pack.id,
        styleURL: 'mapbox://styles/mapbox/outdoors-v12',
        bounds: [
          [pack.bounds[2], pack.bounds[3]], // NE [lng, lat]
          [pack.bounds[0], pack.bounds[1]], // SW [lng, lat]
        ],
        minZoom: pack.minZoom,
        maxZoom: pack.maxZoom,
        metadata: {
          cairnPackId: pack.id,
          name: pack.name,
          createdAt: Date.now(),
        },
      },
      // Progress listener
      (_region: any, status: any) => {
        const progress = status.requiredResourceCount > 0
          ? (status.completedResourceCount / status.requiredResourceCount) * 100
          : 0;
        onProgress?.(pack.id, progress);

        // Update stored status
        if (progress >= 100) {
          updatePackStatus(pack.id, 'complete', 100, status.completedTileSize);
        }
      },
      // Error listener
      (_region: any, error: any) => {
        onError?.(pack.id, error.message || 'Download failed');
        updatePackStatus(pack.id, 'error', 0);
      },
    );

    return true;
  } catch (error: any) {
    onError?.(pack.id, error.message || 'Failed to create pack');
    return false;
  }
}

/**
 * Pause a downloading pack.
 */
export async function pausePack(packId: string): Promise<void> {
  if (!offlineManager) return;
  try {
    const pack = await offlineManager.getPack(packId);
    if (pack) await pack.pause();
    await updatePackStatus(packId, 'paused');
  } catch { /* ignore */ }
}

/**
 * Resume a paused pack download.
 */
export async function resumePack(packId: string): Promise<void> {
  if (!offlineManager) return;
  try {
    const pack = await offlineManager.getPack(packId);
    if (pack) await pack.resume();
    await updatePackStatus(packId, 'downloading');
  } catch { /* ignore */ }
}

/**
 * Delete a downloaded pack.
 */
export async function deletePack(packId: string): Promise<void> {
  if (offlineManager) {
    try {
      await offlineManager.deletePack(packId);
    } catch { /* may not exist */ }
  }

  const packs = await getDownloadedPacks();
  const filtered = packs.filter(p => p.id !== packId);
  await saveDownloadedPacks(filtered);
}

// Internal helper
async function updatePackStatus(
  packId: string,
  status: DownloadedPackInfo['status'],
  progress?: number,
  sizeBytes?: number,
): Promise<void> {
  const packs = await getDownloadedPacks();
  const pack = packs.find(p => p.id === packId);
  if (pack) {
    pack.status = status;
    if (progress !== undefined) pack.progress = progress;
    if (sizeBytes !== undefined) pack.sizeBytes = sizeBytes;
    if (status === 'complete') pack.downloadedAt = Date.now();
    await saveDownloadedPacks(packs);
  }
}
