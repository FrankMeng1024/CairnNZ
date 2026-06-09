/**
 * LegacyRouteMigrator — Migrate routes that lack originalPoints/segments.
 *
 * Will move to: app/src/services/LegacyRouteMigrator.ts
 *
 * Strategy: Lazy migration on first edit (per Plan v3.1 §0).
 *
 * Workflow (review v3 C3 fix):
 *   1. Backup current schema_v(N) to AsyncStorage `legacy_backup_v{N}_route_{routeId}` (TTL 30d)
 *   2. In-memory dry-run: build newOriginalPoints + newSegments
 *   3. Assert invariants:
 *      - newOriginalPoints.length === route.points.length
 *      - newSegments[0].endIdx === n-1
 *      - All segments cover full range [0, n-1] without gaps
 *   4. Write schema_v(N+1) via LocalRouteExtras.saveExtras()
 *   5. Verify: read back, assert data integrity
 *   6. On any failure: surface to user via retry UI (NOT silent)
 *
 * Read-safety invariant (review v3.1 angle 1):
 *   Migrator NEVER deletes legacy fields. Old code paths that read
 *   route.points still work even if migration is in progress.
 *   originalPoints + segments are PURELY ADDITIVE — no destructive change.
 */

import { saveExtras, loadExtras, backupExtras, EditSegment } from './LocalRouteExtras';

interface LegacyRoute {
  id: string;
  points: Array<{ lat: number; lng: number; alt?: number | null }>;
  // ...other route fields, untouched by migrator
}

export type MigrationResult =
  | { ok: true; migrated: boolean }                          // migrated successfully OR already migrated
  | { ok: false; error: string; retry: boolean };            // failed, may retry

/**
 * Idempotent migration: safe to call multiple times.
 *
 * Returns:
 *   { ok: true, migrated: false }  — already had extras (no-op)
 *   { ok: true, migrated: true }   — successfully migrated
 *   { ok: false, error, retry }   — failed; retry=true means try again
 */
export async function migrateRouteIfNeeded(route: LegacyRoute): Promise<MigrationResult> {
  // Step 0: Already migrated?
  const existing = await loadExtras(route.id);
  if (existing) {
    return { ok: true, migrated: false };
  }

  // Step 1: Validate input
  if (!route.points || route.points.length === 0) {
    return { ok: false, error: 'Route has no points to migrate', retry: false };
  }

  // Step 2: Backup (Schema version snapshot)
  const backupResult = await backupExtras(route.id, {
    routeId: route.id,
    pointCount: route.points.length,
    timestamp: Date.now(),
    note: 'Pre-migration snapshot (no extras existed)',
  });
  if (!backupResult.ok) {
    // Backup failure is recoverable — proceed but warn
    console.warn('[LegacyMigrator] backup failed, proceeding anyway:', backupResult.error);
  }

  // Step 3: In-memory dry-run
  const newOriginalPoints = route.points.map(p => ({
    lat: p.lat,
    lng: p.lng,
    alt: p.alt ?? null,
  }));
  const newSegments: EditSegment[] = [
    {
      startIdx: 0,
      endIdx: route.points.length - 1,
      source: 'original',
      isEdited: false,
      confidence: 'confident',
    },
  ];

  // Step 4: Invariant assertions (dry-run validation)
  if (newOriginalPoints.length !== route.points.length) {
    return { ok: false, error: 'Dry-run assertion failed: point count mismatch', retry: false };
  }
  if (newSegments[0].endIdx !== route.points.length - 1) {
    return { ok: false, error: 'Dry-run assertion failed: segment endIdx mismatch', retry: false };
  }
  // Coverage check: segments must cover full range [0, n-1] without gaps/overlap
  const totalCovered = newSegments.reduce((sum, s) => sum + (s.endIdx - s.startIdx + 1), 0);
  if (totalCovered !== route.points.length) {
    return { ok: false, error: 'Dry-run assertion failed: segments coverage mismatch', retry: false };
  }

  // Step 5: Write to AsyncStorage
  const saveResult = await saveExtras({
    routeId: route.id,
    originalPoints: newOriginalPoints,
    segments: newSegments,
  });
  if (!saveResult.ok) {
    // v4-audit (ARCH-009): detect AsyncStorage quota errors and try
    // to free space before giving up. SQLite-backed AsyncStorage on
    // iOS hits a 6MB limit; the user shouldn't be locked out
    // permanently when tooling can clean up old backups.
    const errStr = String(saveResult.error ?? '');
    const isQuota =
      errStr.includes('SQLITE_FULL') ||
      errStr.toLowerCase().includes('quota') ||
      errStr.toLowerCase().includes('exceeded') ||
      errStr.toLowerCase().includes('disk');
    if (isQuota) {
      try {
        const { capBackups } = await import('./LocalRouteExtras');
        // v6-audit (ARCH-006): on quota error, evict ALL backups
        // (capBackups(0, force)) — the typical case has <50 backups so
        // capBackups(50, force) was a no-op. Backup retention is
        // already a 30-day TTL safety net; sacrificing them to unblock
        // the user's edit is the right trade.
        await capBackups(0, { force: true });
      } catch {
        // ignore — best-effort cleanup
      }
      // Retry saveExtras once after cleanup.
      const retryResult = await saveExtras({
        routeId: route.id,
        originalPoints: newOriginalPoints,
        segments: newSegments,
      });
      if (!retryResult.ok) {
        return {
          ok: false,
          error: `storage-full: ${retryResult.error ?? saveResult.error}`,
          retry: false,
        };
      }
    } else {
      return { ok: false, error: `AsyncStorage write failed: ${saveResult.error}`, retry: true };
    }
  }

  // Step 6: Verify read-back
  // v2-audit (ARCH-012): verify full shape (segments + source +
  // coordinate spot-check), not just point count. JSON roundtrip can
  // mangle floats on some Android AsyncStorage backends.
  const verified = await loadExtras(route.id);
  if (!verified) {
    return { ok: false, error: 'Verification read failed after write', retry: true };
  }
  if (verified.originalPoints.length !== route.points.length) {
    return { ok: false, error: 'Verification: point count drift', retry: false };
  }
  if (!verified.segments || verified.segments.length !== 1) {
    return { ok: false, error: 'Verification: segment count mismatch', retry: false };
  }
  const seg0 = verified.segments[0];
  if (seg0.startIdx !== 0 || seg0.endIdx !== route.points.length - 1) {
    return { ok: false, error: 'Verification: segment range mismatch', retry: false };
  }
  if (seg0.source !== 'original') {
    return { ok: false, error: `Verification: segment source '${seg0.source}' !== 'original'`, retry: false };
  }
  // Spot-check first/middle/last point coordinates.
  // v3-audit (ARCH-008): epsilon 1e-7 ≈ 1.1cm at the equator —
  // generous enough to absorb Hermes/SQLite double-string roundtrip
  // drift on Android, tight enough to catch real corruption. Mark
  // failure as retry:true so a transient SQLite issue doesn't lock
  // the user out permanently.
  const checkIndices = [0, Math.floor(route.points.length / 2), route.points.length - 1];
  const COORD_EPSILON = 1e-7;
  for (const i of checkIndices) {
    const a = verified.originalPoints[i];
    const b = route.points[i];
    if (
      !a ||
      Math.abs(a.lat - b.lat) > COORD_EPSILON ||
      Math.abs(a.lng - b.lng) > COORD_EPSILON
    ) {
      return { ok: false, error: `Verification: coordinate drift at idx ${i}`, retry: true };
    }
  }

  return { ok: true, migrated: true };
}

/**
 * Per-route migration retry helper for UI.
 *
 * Returns the latest result. Caller surfaces retry UI based on (ok=false, retry=true).
 */
export async function retryMigration(route: LegacyRoute, maxAttempts: number = 3): Promise<MigrationResult> {
  let lastResult: MigrationResult = { ok: false, error: 'No attempts made', retry: false };
  for (let i = 0; i < maxAttempts; i++) {
    lastResult = await migrateRouteIfNeeded(route);
    if (lastResult.ok) return lastResult;
    if (!('retry' in lastResult) || !lastResult.retry) return lastResult; // unrecoverable
    // Exponential backoff
    await new Promise(r => setTimeout(r, 200 * Math.pow(2, i)));
  }
  return lastResult;
}
