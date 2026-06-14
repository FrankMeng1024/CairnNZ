/**
 * v0.2.4 R2.3 — Origin propagation helper.
 *
 * 抽出来让 UnityAROverlay 真调 + jest 真测同一函数 (反 self-licking)。
 *
 * 用法:
 *   const projOrigin = projectOrigin(props.arOrigin, props.userPos);
 *   buildSpawnRequest(marker, projOrigin, groundY);
 */

export interface PersistedOrigin {
  lat: number;
  lng: number;
  alt: number | null;
  /** v0.2.4 R2.3: 标记此 origin 是否在低 GPS 精度 (10-25m) 锁的 */
  lowAccuracy?: boolean;
}

export interface LiveOrigin {
  lat: number;
  lng: number;
}

export interface ProjOrigin {
  lat: number;
  lng: number;
  /** Carries through from PersistedOrigin if present */
  lowAccuracy?: boolean;
}

/**
 * 选 persisted (已锁定 origin,跨 session 稳定) 或 live (当前 GPS) 作为
 * spawn projection origin。**保留 lowAccuracy 字段**,让下游 buildSpawnRequest
 * 收紧低精度 origin 的 Tier-A 阈值 (5m → 2m)。
 */
export function projectOrigin(
  persisted: PersistedOrigin | null | undefined,
  live: LiveOrigin,
): ProjOrigin {
  if (persisted) {
    return {
      lat: persisted.lat,
      lng: persisted.lng,
      lowAccuracy: persisted.lowAccuracy,
    };
  }
  return { lat: live.lat, lng: live.lng };
}

/**
 * v0.2.4 R2.3 — 计算用户当前 GPS 距 origin 的米数 (XZ 平面 cosLat 近似)。
 * 用 ARScreen.tsx:514-518 的算法。
 */
export function distanceMeters(
  origin: { lat: number; lng: number },
  current: { lat: number; lng: number },
): number {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const dN = (current.lat - origin.lat) * 111000;
  const dE = (current.lng - origin.lng) * 111000 * cosLat;
  return Math.hypot(dN, dE);
}

/**
 * v0.2.4 R2.3 — 判断 origin 是否过期 (用户走出 50m,需重锁)。
 * 让 ARScreen + jest 共用同一阈值规则,反 self-licking。
 */
export const ORIGIN_STALE_DISTANCE_M = 50;

export function isOriginStale(
  origin: { lat: number; lng: number },
  current: { lat: number; lng: number },
  staleThresholdM: number = ORIGIN_STALE_DISTANCE_M,
): boolean {
  return distanceMeters(origin, current) > staleThresholdM;
}

/**
 * v0.2.4 R2.3 — GPS accuracy gate. <=10m = high, 10-25m = low (lock with flag),
 * >25m = reject。
 */
export const GPS_HIGH_ACC_M = 10;
export const GPS_MAX_ACC_M = 25;

export type GpsLockDecision =
  | { action: 'lock'; lowAccuracy: false }
  | { action: 'lock'; lowAccuracy: true }
  | { action: 'reject'; reason: 'too-noisy' };

export function decideGpsLock(accuracy: number | null | undefined): GpsLockDecision {
  const acc = accuracy ?? 999;
  if (acc > GPS_MAX_ACC_M) return { action: 'reject', reason: 'too-noisy' };
  return { action: 'lock', lowAccuracy: acc > GPS_HIGH_ACC_M } as GpsLockDecision;
}

