/**
 * LocalRouteExtras — AsyncStorage 存 originalPoints + segments
 *
 * Will move to: app/src/services/LocalRouteExtras.ts
 *
 * 后端 RoutePayload 不接受 originalPoints/segments，本地单独存。
 * Schema version 字段为 Sprint 67 后端 schema 升级后的迁移做准备。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = '@cairn:route_extras:v1:';
const BACKUP_KEY_PREFIX = '@cairn:route_extras_backup:';
const BACKUP_TTL_DAYS = 30;

type SegmentSource = 'original' | 'doc' | 'mapbox' | 'straight' | 'mixed';

/**
 * EditSegment — segment metadata for an edit-aware Route geometry.
 *
 * Sprint 66 Fix-21 (C5): renamed from `RouteSegment` to avoid collision
 * with `useRouteStore.RouteSegment` (different shape: type|startIndex|endIndex|snapRate).
 * The two co-existed silently because TypeScript matches by structure, not name.
 *
 * v4 cleanup: deprecated `RouteSegment` alias removed. All consumers have
 * migrated to `EditSegment`.
 */
export interface EditSegment {
  startIdx: number;          // index into route.points
  endIdx: number;
  source: SegmentSource;
  isEdited: boolean;
  /** 'confident' | 'approximate' (per Plan v3.1 §2.2 simplification) */
  confidence?: 'confident' | 'approximate';
}

/**
 * Sprint 67 v236: persist via-point edit intent so re-opening the editor
 * resumes user's vias instead of starting blank. Additive — pre-v236
 * records simply lack these fields, treated as "no vias, full route".
 */
interface PersistedVia {
  id: string;
  lng: number;
  lat: number;
}

interface RouteExtras {
  routeId: string;
  schemaVersion: 1;
  /** Immutable original GPS trace. Set once at first edit; never mutated. */
  originalPoints: Array<{ lat: number; lng: number; alt?: number | null }>;
  /**
   * Latest edited geometry. Equal to originalPoints for unedited routes.
   * Sprint 66 Fix-9 (B1): saveAndExit must persist this so edits survive
   * across sessions. Optional for forward-compat with v1 records that
   * predate the field — readers should fall back to originalPoints.
   */
  workingPoints?: Array<{ lat: number; lng: number; alt?: number | null }>;
  segments: EditSegment[];
  /** Sprint 67 v236: latest user-placed via points. Empty/absent => no vias. */
  viaPoints?: PersistedVia[];
  /** Sprint 67 v236: trim slider positions in [0..1]. */
  trimStartFrac?: number;
  trimEndFrac?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * v3-audit (FUNC-011): map a SegmentSource to its inherent confidence
 * level. Sprint 66's runtime classifies fresh DOC + Mapbox routes as
 * 'confident'; the read-time backfill should match so legacy 'doc'/
 * 'mapbox' segments don't get demoted to dashed amber.
 *   original / doc / mapbox  → 'confident'   (trustworthy known sources)
 *   mixed / straight         → 'approximate' (composed or unknown)
 */
function inherentConfidence(source: SegmentSource): 'confident' | 'approximate' {
  switch (source) {
    case 'original':
    case 'doc':
    case 'mapbox':
      return 'confident';
    case 'mixed':
    case 'straight':
      return 'approximate';
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

export async function loadExtras(routeId: string): Promise<RouteExtras | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + routeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RouteExtras;
    if (parsed.schemaVersion !== 1) {
      // Future: schema migration
      console.warn(`[LocalRouteExtras] Unknown schema version ${parsed.schemaVersion} for route ${routeId}`);
      return null;
    }
    // v8-audit (V7-BUG-009): produce a truly immutable result —
    // return a new object via spread instead of mutating parsed.
    const segments = parsed.segments
      ? parsed.segments.map(s =>
          s.confidence ? s : { ...s, confidence: inherentConfidence(s.source) },
        )
      : parsed.segments;
    return { ...parsed, segments };
  } catch (err) {
    console.error('[LocalRouteExtras] loadExtras failed', err);
    return null;
  }
}

/**
 * v3-audit (ARCH-017): per-routeId promise chain so concurrent saveExtras
 * calls for the SAME routeId serialize. Without this, two parallel writes
 * read the same `existing`, both write, last-write-wins on the entire
 * record — losing the other's workingPoints / segments.
 */
const saveExtrasChains = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export async function saveExtras(extras: Omit<RouteExtras, 'createdAt' | 'updatedAt' | 'schemaVersion'>): Promise<{ ok: boolean; error?: string }> {
  const prev = saveExtrasChains.get(extras.routeId) ?? Promise.resolve<{ ok: boolean; error?: string }>({ ok: true });
  const next = prev.then(async () => {
    const now = Date.now();
    const existing = await loadExtras(extras.routeId);
    // v3-audit (ARCH-015): mirror the read-time backfill on write so the
    // schema invariant holds in both directions. A caller that constructs
    // an EditSegment without confidence should not produce a record that
    // reads back differently than they intended.
    const normalizedSegments: EditSegment[] = (extras.segments ?? []).map(s => ({
      ...s,
      confidence: s.confidence ?? inherentConfidence(s.source),
    }));
    const payload: RouteExtras = {
      ...extras,
      segments: normalizedSegments,
      schemaVersion: 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await AsyncStorage.setItem(KEY_PREFIX + extras.routeId, JSON.stringify(payload));
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'AsyncStorage write failed' };
    }
  });
  saveExtrasChains.set(extras.routeId, next);
  // Auto-cleanup so the Map doesn't grow unbounded.
  next.finally(() => {
    if (saveExtrasChains.get(extras.routeId) === next) {
      saveExtrasChains.delete(extras.routeId);
    }
  });
  return next;
}

export async function deleteExtras(routeId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + routeId);
    // Also delete backup (privacy: review angle 8 of v3 review)
    await AsyncStorage.removeItem(BACKUP_KEY_PREFIX + routeId);
  } catch {
    // ignore
  }
}

/**
 * Backup before migration (LegacyRouteMigrator dry-run support).
 * TTL 30 days, key = `@cairn:route_extras_backup:{routeId}`
 */
export async function backupExtras(routeId: string, snapshot: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = {
      routeId,
      backedUpAt: Date.now(),
      ttlMs: BACKUP_TTL_DAYS * 24 * 60 * 60 * 1000,
      snapshot,
    };
    await AsyncStorage.setItem(BACKUP_KEY_PREFIX + routeId, JSON.stringify(payload));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Backup write failed' };
  }
}

// O1: loadBackup removed — never called anywhere. Restore-from-backup
// flow was planned in Sprint 67 but never implemented. capBackups /
// deleteExtras still manage the write-only backup lifecycle (privacy).

const CAPBACKUPS_TIMESTAMP_KEY = '@cairn:route_extras_capbackups_at';
const RECONCILE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Cap on backup count per user (review v3.1 angle 10 low #2).
 * Max 50 backups, oldest evicted.
 *
 * v2-audit (ARCH-016): same debounce as reconcileOrphans. Use
 * AsyncStorage.multiRemove for batch eviction.
 */
export async function capBackups(maxCount: number = 50, options?: { force?: boolean }): Promise<number> {
  try {
    if (!options?.force) {
      const last = await AsyncStorage.getItem(CAPBACKUPS_TIMESTAMP_KEY);
      if (last) {
        const lastAt = parseInt(last, 10);
        if (!Number.isNaN(lastAt) && Date.now() - lastAt < RECONCILE_MIN_INTERVAL_MS) {
          return 0;
        }
      }
    }
    const allKeys = await AsyncStorage.getAllKeys();
    const backupKeys = allKeys.filter(k => k.startsWith(BACKUP_KEY_PREFIX));
    if (backupKeys.length === 0) {
      // v7-audit (ARCH-018): no backups → no work; return without
      // updating timestamp.
      return 0;
    }
    // Note: don't early-return when backupKeys.length <= maxCount —
    // there may still be expired backups under the count threshold
    // that should be cleaned up.

    // Load all to get backedUpAt, sort, evict oldest
    // v7-audit (ARCH-018): also drop backups past their TTL, even
    // when count is below the cap.
    // v8-audit (V7-BUG-007): also drop backups whose backedUpAt is
    // future-dated beyond CLOCK_SKEW_TOLERANCE_MS (5 min) — clock
    // rollback or corrupted timestamps shouldn't be preserved
    // forever just because (now - skewedFuture) is negative.
    const ttlMs = BACKUP_TTL_DAYS * 24 * 60 * 60 * 1000;
    const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
    const now = Date.now();
    const expiredKeys: string[] = [];
    const entries: Array<{ key: string; backedUpAt: number }> = [];
    const pairs = await AsyncStorage.multiGet(backupKeys);
    for (const [key, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const at = parsed.backedUpAt ?? 0;
        const delta = now - at;
        if (delta < -CLOCK_SKEW_TOLERANCE_MS || delta > ttlMs) {
          expiredKeys.push(key);
        } else {
          entries.push({ key, backedUpAt: at });
        }
      } catch {
        // Unparseable — treat as expired to drop bad data.
        expiredKeys.push(key);
      }
    }
    if (expiredKeys.length > 0) {
      await AsyncStorage.multiRemove(expiredKeys);
    }
    entries.sort((a, b) => a.backedUpAt - b.backedUpAt);
    const toEvict = entries.slice(0, Math.max(0, entries.length - maxCount));
    if (toEvict.length > 0) {
      await AsyncStorage.multiRemove(toEvict.map(e => e.key));
    }
    if (expiredKeys.length > 0 || toEvict.length > 0) {
      await AsyncStorage.setItem(CAPBACKUPS_TIMESTAMP_KEY, String(Date.now()));
    }
    return expiredKeys.length + toEvict.length;
  } catch {
    return 0;
  }
}
