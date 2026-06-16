/**
 * worldMapPreloader.ts — Phase 4.4 RN-side prefetch of ARWorldMap blobs.
 *
 * When the user opens AR for a known space, this preloader pulls the saved
 * ARWorldMap blob from `/api/v025/worldmaps/:spaceId` and writes it to the
 * local file system via expo-file-system, ready for ArkitWorldMapPersistence
 * to deserialize on the iOS side.
 *
 * expo-file-system is pure JS API on top of native; no rebuild required for v0.2.5.
 *
 * Backend route /api/v025/worldmaps/:spaceId is provided by Phase 4.5
 * backend/src/routes/v025/worldmaps.js.
 */
import * as FileSystem from 'expo-file-system';

export interface PreloadResult {
    success: boolean;
    localUri?: string;
    sizeBytes?: number;
    diagnostic: string;
}

/**
 * Local path where the iOS side expects the .arworldmap blob:
 *   ${documentDirectory}v025/worldmaps/${spaceId}.arworldmap
 *
 * ArkitWorldMapPersistence.LoadAsync reads from the same path. Cairn_ExcludeFromBackup
 * is invoked on save (Phase 4.2 C# side) to keep the file out of iCloud.
 */
export function localBlobUri(spaceId: string): string {
    const dir = FileSystem.documentDirectory ?? '';
    return `${dir}v025/worldmaps/${encodeURIComponent(spaceId)}.arworldmap`;
}

export async function preloadWorldMap(
    backendBaseUrl: string,
    spaceId: string,
    bearerToken?: string
): Promise<PreloadResult> {
    if (!spaceId) {
        return { success: false, diagnostic: 'spaceId required' };
    }
    const remoteUrl = `${backendBaseUrl.replace(/\/+$/, '')}/api/v025/worldmaps/${encodeURIComponent(spaceId)}`;
    const localUri = localBlobUri(spaceId);

    try {
        // Ensure target directory exists
        const targetDir = localUri.substring(0, localUri.lastIndexOf('/'));
        await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true }).catch(() => { /* may exist */ });

        const headers: Record<string, string> = {};
        if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

        const dl = await FileSystem.downloadAsync(remoteUrl, localUri, { headers });
        if (dl.status === 404) {
            // Round-1 #4-2-B: delete any partial file written by downloadAsync so
            // next preload doesn't read a stale/empty body as a corrupt blob.
            await deleteLocalBlob(spaceId);
            return { success: false, diagnostic: 'no_world_map_for_space' };
        }
        if (dl.status < 200 || dl.status >= 300) {
            await deleteLocalBlob(spaceId);
            return { success: false, diagnostic: `http_${dl.status}` };
        }
        const info = await FileSystem.getInfoAsync(localUri);
        return {
            success: true,
            localUri,
            sizeBytes: info.exists ? (info.size ?? 0) : 0,
            diagnostic: 'preloaded',
        };
    } catch (err) {
        await deleteLocalBlob(spaceId);
        return { success: false, diagnostic: 'preload_error: ' + String(err) };
    }
}

/**
 * Delete a corrupt / version-mismatched local blob so the next preload starts fresh.
 */
export async function deleteLocalBlob(spaceId: string): Promise<void> {
    const localUri = localBlobUri(spaceId);
    try {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
        // best effort; file may not exist
    }
}
