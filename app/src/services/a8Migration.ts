/**
 * v0.2.3 Stage 5 — A8 schema migration.
 *
 * Plan v4 §A8 v0.2.2 → v0.2.3 Migration (lines 163-184).
 *
 * Goal: Q4 invariant — 5 年后 cairn 还在原位 — MUST hold across upgrade
 * from v0.2.2 to v0.2.3. Schema fields evolve (we now stamp
 * schemaVersion=2 with migrationTs); cairn world coordinates
 * (arOrigin.lat/lng) MUST be preserved for any user who already had
 * placed cairns on v0.2.2.
 *
 * Decision tree (Plan lines 168-180):
 *   schemaVersion == 2                                → no-op
 *   schemaVersion == 0 AND arOrigin == null           → fresh install,
 *                                                       stamp v=2
 *   schemaVersion == 0 AND arOrigin != null AND
 *     markers.length > 0                              → legacy user
 *                                                       PRESERVE arOrigin,
 *                                                       stamp v=2 + ts,
 *                                                       toast
 *   schemaVersion == 0 AND arOrigin != null AND
 *     markers.length == 0                             → orphan arOrigin,
 *                                                       wipe + stamp v=2
 *
 * Boot-order (Plan V2-CONFLICT-2):
 *   (1) useMarkerStore.hydrate(userId)
 *   (2) runA8Migration(userId)         ← this module
 *   (3) useArOriginStore.hydrate(userId)
 *   (4) UI mount
 */
import { storage } from '../store/storage';
import { useMarkerStore } from '../store/useMarkerStore';
import { useArOriginStore } from '../store/useArOriginStore';
import { crashLogger } from './crashLogger';

const SCHEMA_VERSION_KEY_PREFIX = 'cairn_ar_schema_version';
const MIGRATION_TS_KEY_PREFIX = 'cairn_ar_migration_ts';
const REQUIRED_SCHEMA_VERSION = 2;

function schemaVersionKey(userId: string): string {
  return `${SCHEMA_VERSION_KEY_PREFIX}_${userId}`;
}
function migrationTsKey(userId: string): string {
  return `${MIGRATION_TS_KEY_PREFIX}_${userId}`;
}

export type A8MigrationOutcome =
  | 'no-op-already-v2'
  | 'fresh-install-stamp'
  | 'preserved-arorigin-with-markers'
  | 'wiped-orphan-arorigin'
  | 'no-op-no-userid';

export interface A8MigrationResult {
  outcome: A8MigrationOutcome;
  /** True if a user-visible toast should be shown. Caller decides where. */
  showToast: boolean;
  /** Toast message text (Plan line 178). */
  toastMessage: string | null;
}

const TOAST_PRESERVED = 'Cairn positions preserved — verify next AR open';

/**
 * Run A8 migration for the given user. Idempotent — safe to call on every
 * boot. Must be invoked AFTER useMarkerStore.hydrate(userId) so that
 * markers + arOrigin are loaded into memory.
 */
export async function runA8Migration(userId: string): Promise<A8MigrationResult> {
  if (!userId) {
    crashLogger.breadcrumb('[v22-MIGRATION] skip reason=no-userid');
    return { outcome: 'no-op-no-userid', showToast: false, toastMessage: null };
  }

  // (1) Read current schemaVersion.
  const raw = await storage.getItem(schemaVersionKey(userId));
  const v = raw ? parseInt(raw, 10) : 0;

  // (2) Already migrated → no-op.
  if (v === REQUIRED_SCHEMA_VERSION) {
    crashLogger.breadcrumb(`[v22-MIGRATION] no-op v=${v} userId=${userId}`);
    return { outcome: 'no-op-already-v2', showToast: false, toastMessage: null };
  }

  // (3) Legacy / fresh case (v=0 or unknown). Inspect markerStore state.
  const ms = useMarkerStore.getState();
  const arOrigin = ms.arOrigin;
  const markersCount = ms.markers.length;

  if (arOrigin == null) {
    // Fresh install. Just stamp the version.
    await storage.setItem(schemaVersionKey(userId), String(REQUIRED_SCHEMA_VERSION));
    await storage.setItem(migrationTsKey(userId), String(Date.now()));
    crashLogger.breadcrumb(
      `[v22-MIGRATION] fresh-install from=v${v} markers=0 arOrigin=null → v${REQUIRED_SCHEMA_VERSION}`
    );
    // Notify A4 store so it can advance from COLD_INIT.
    useArOriginStore.getState().__TEST_setSchemaVersion(REQUIRED_SCHEMA_VERSION);
    return { outcome: 'fresh-install-stamp', showToast: false, toastMessage: null };
  }

  if (markersCount > 0) {
    // Legacy v0.2.2 user with cairns. PRESERVE arOrigin (Q4 invariant).
    await storage.setItem(schemaVersionKey(userId), String(REQUIRED_SCHEMA_VERSION));
    await storage.setItem(migrationTsKey(userId), String(Date.now()));
    crashLogger.breadcrumb(
      `[v22-MIGRATION] from=v0.2.2 markers=${markersCount} arOrigin=preserved` +
      ` lat=${arOrigin.lat.toFixed(5)} lng=${arOrigin.lng.toFixed(5)} → v${REQUIRED_SCHEMA_VERSION}`
    );
    useArOriginStore.getState().__TEST_setSchemaVersion(REQUIRED_SCHEMA_VERSION);
    return {
      outcome: 'preserved-arorigin-with-markers',
      showToast: true,
      toastMessage: TOAST_PRESERVED,
    };
  }

  // Orphan arOrigin: schemaVersion=0 + arOrigin set but zero markers.
  // Safe to wipe; nothing to displace.
  ms.clearArOrigin();
  await storage.setItem(schemaVersionKey(userId), String(REQUIRED_SCHEMA_VERSION));
  await storage.setItem(migrationTsKey(userId), String(Date.now()));
  crashLogger.breadcrumb(
    `[v22-MIGRATION] wipe-orphan markers=0 arOrigin=non-null → wiped + v${REQUIRED_SCHEMA_VERSION}`
  );
  useArOriginStore.getState().__TEST_setSchemaVersion(REQUIRED_SCHEMA_VERSION);
  return { outcome: 'wiped-orphan-arorigin', showToast: false, toastMessage: null };
}

/**
 * Test-only synthetic fixture (Plan Pre-EAS step 5):
 *   "synthetic fixture test (write old-schema MMKV → boot v0.2.3 →
 *    verify cairns preserved + schemaVersion=2 + toast shown)"
 *
 * Writes a v0.2.2-shape state for `userId` so a subsequent runA8Migration
 * call exercises the legacy-with-markers branch. Caller must seed
 * useMarkerStore via setArOriginIfMissing + addMarker BEFORE invoking
 * this fixture, then call runA8Migration(userId).
 */
export async function __TEST_seedV022State(userId: string): Promise<void> {
  // Force schemaVersion absent (legacy).
  await storage.removeItem(schemaVersionKey(userId));
  await storage.removeItem(migrationTsKey(userId));
}
