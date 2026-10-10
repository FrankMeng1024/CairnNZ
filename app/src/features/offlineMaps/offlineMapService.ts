import { Platform } from 'react-native';
import { getPrimaryMapStyle } from '../../config/mapbox';
import {
  isCairnOfflineMapPack,
  makeOfflineMapPackName,
  offlineMapBounds,
  validateOfflineMapDraft,
  type OfflineMapPackDraft,
  type OfflineMapPackRecord,
  type OfflineMapPackStatus,
} from './offlineMapContracts';

type NativePackStatus = {
  name?: string;
  state?: number;
  percentage?: number;
  completedResourceSize?: number;
  completedTileCount?: number;
  completedResourceCount?: number;
  requiredResourceCount?: number;
};

type NativePack = {
  name?: string;
  metadata?: Record<string, unknown> | null;
  status: () => Promise<NativePackStatus>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
};

export type OfflineManagerBridge = {
  createPack: (
    options: {
      name: string;
      styleURL: string;
      bounds: [[number, number], [number, number]];
      minZoom: number;
      maxZoom: number;
      metadata: Record<string, unknown>;
    },
    onProgress: (pack: NativePack, status: NativePackStatus) => void,
    onError?: (pack: NativePack, error: { message?: string }) => void,
  ) => Promise<void>;
  getPacks: () => Promise<NativePack[]>;
  getPack: (name: string) => Promise<NativePack | undefined>;
  deletePack: (name: string) => Promise<void>;
  invalidatePack: (name: string) => Promise<void>;
  unsubscribe?: (name: string) => void;
  setProgressEventThrottle?: (milliseconds: number) => void;
};

export type OfflineMapProgressListener = (status: OfflineMapPackStatus) => void;

export type OfflineMapActivityPauseResult = {
  inspected: number;
  paused: number;
  alreadyComplete: number;
  failed: number;
};

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStatus(name: string, status: NativePackStatus): OfflineMapPackStatus {
  return {
    name,
    state: safeNumber(status.state),
    percentage: Math.max(0, Math.min(100, safeNumber(status.percentage) ?? 0)),
    completedResourceSize: safeNumber(status.completedResourceSize),
    completedTileCount: safeNumber(status.completedTileCount),
    completedResourceCount: safeNumber(status.completedResourceCount),
    requiredResourceCount: safeNumber(status.requiredResourceCount),
  };
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  return safeNumber(metadata?.[key]);
}

export class OfflineMapService {
  constructor(private readonly manager: OfflineManagerBridge | null) {}

  get supported(): boolean {
    return this.manager !== null;
  }

  async list(): Promise<OfflineMapPackRecord[]> {
    if (!this.manager) return [];
    const packs = await this.manager.getPacks();
    const records = await Promise.all(packs.filter(pack => isCairnOfflineMapPack(pack.name)).map(async pack => {
      const name = String(pack.name);
      const status = toStatus(name, await pack.status());
      const metadata = pack.metadata;
      const lat = metadataNumber(metadata, 'centerLat');
      const lng = metadataNumber(metadata, 'centerLng');
      return {
        ...status,
        center: lat !== null && lng !== null ? { lat, lng } : null,
        radiusKm: metadataNumber(metadata, 'radiusKm'),
        minZoom: metadataNumber(metadata, 'minZoom'),
        maxZoom: metadataNumber(metadata, 'maxZoom'),
        createdAt: metadataNumber(metadata, 'createdAt'),
      };
    }));
    return records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  async create(
    draft: OfflineMapPackDraft,
    onProgress: OfflineMapProgressListener,
    onError: (message: string) => void,
    now = Date.now(),
  ): Promise<string> {
    if (!this.manager) throw new Error('Offline maps require a native Cairn build.');
    const value = validateOfflineMapDraft(draft);
    const bounds = offlineMapBounds(value);
    const name = makeOfflineMapPackName(now);
    this.manager.setProgressEventThrottle?.(1_000);
    await this.manager.createPack({
      name,
      styleURL: getPrimaryMapStyle(),
      // rnmapbox 10.3.1 expects [north-east, south-west].
      bounds: [bounds.northEast, bounds.southWest],
      minZoom: value.minZoom,
      maxZoom: value.maxZoom,
      metadata: {
        schemaVersion: 1,
        owner: 'cairn-device',
        centerLat: value.center.lat,
        centerLng: value.center.lng,
        radiusKm: value.radiusKm,
        minZoom: value.minZoom,
        maxZoom: value.maxZoom,
        createdAt: now,
      },
    }, (_pack, status) => onProgress(toStatus(name, status)), (_pack, error) => {
      onError(error?.message || 'Mapbox could not download this area.');
    });
    return name;
  }

  async pause(name: string): Promise<void> {
    await this.requireCairnPack(name).then(pack => pack.pause());
  }

  async resume(name: string): Promise<void> {
    await this.requireCairnPack(name).then(pack => pack.resume());
  }

  async refresh(name: string): Promise<void> {
    if (!this.manager) throw new Error('Offline maps require a native Cairn build.');
    if (!isCairnOfflineMapPack(name)) throw new Error('Cairn will only change maps it created.');
    await this.manager.invalidatePack(name);
  }

  async remove(name: string): Promise<void> {
    if (!this.manager) throw new Error('Offline maps require a native Cairn build.');
    if (!isCairnOfflineMapPack(name)) throw new Error('Cairn will only change maps it created.');
    this.manager.unsubscribe?.(name);
    await this.manager.deletePack(name);
  }

  /**
   * Best-effort resource handoff after Activity GPS/WAL ownership is already
   * live. Completed packs are untouched; only Cairn-owned in-progress packs
   * are paused. Callers must not await this from Activity Start.
   */
  async pauseForActivityStart(): Promise<OfflineMapActivityPauseResult> {
    const result: OfflineMapActivityPauseResult = {
      inspected: 0,
      paused: 0,
      alreadyComplete: 0,
      failed: 0,
    };
    if (!this.manager) return result;
    // Reduce callback pressure immediately while asynchronous pause requests
    // settle. This does not alter GPS, WAL or Activity lifecycle ownership.
    this.manager.setProgressEventThrottle?.(5_000);
    let packs: NativePack[];
    try {
      packs = (await this.manager.getPacks()).filter(pack => isCairnOfflineMapPack(pack.name));
    } catch {
      result.failed = 1;
      return result;
    }
    result.inspected = packs.length;
    await Promise.all(packs.map(async pack => {
      try {
        const status = await pack.status();
        const required = safeNumber(status.requiredResourceCount);
        const complete = (safeNumber(status.percentage) ?? 0) >= 100
          || (required !== null && required > 0
            && safeNumber(status.completedResourceCount) === required);
        if (complete) {
          result.alreadyComplete += 1;
          return;
        }
        await pack.pause();
        result.paused += 1;
      } catch {
        result.failed += 1;
      }
    }));
    return result;
  }

  release(name: string): void {
    if (isCairnOfflineMapPack(name)) this.manager?.unsubscribe?.(name);
  }

  private async requireCairnPack(name: string): Promise<NativePack> {
    if (!this.manager) throw new Error('Offline maps require a native Cairn build.');
    if (!isCairnOfflineMapPack(name)) throw new Error('Cairn will only change maps it created.');
    const pack = await this.manager.getPack(name);
    if (!pack) throw new Error('This offline map is no longer stored on this device.');
    return pack;
  }
}

function resolveNativeManager(): OfflineManagerBridge | null {
  if (Platform.OS === 'web') return null;
  try {
    // Dynamic loading keeps the web and unit-test bundles independent of the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@rnmapbox/maps').offlineManager as OfflineManagerBridge;
  } catch {
    return null;
  }
}

export const offlineMapService = new OfflineMapService(resolveNativeManager());
