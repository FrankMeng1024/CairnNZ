/**
 * Permission constants — Friend System v1 (v4.2)
 *
 * Single source of truth for marker/route visibility ENUM values.
 *
 * DB legacy: `markers.permission` ENUM uses 'group' for historical reasons.
 * v4.2 product UI calls this "Friend". The app layer normalizes both directions:
 *   - On read: 'group' → 'friend' (for client + UI)
 *   - On write: accept either 'group' or 'friend' (write as 'group' to keep ENUM stable)
 *
 * `routes.permission` ENUM (migration 018) uses 'friend' directly — newer column,
 * no legacy. No normalization needed.
 *
 * Reference: _research/friend-system/FINAL_PRODUCT_PLAN_v4.md §1 row S.
 */

const PERMISSION = Object.freeze({
  PERSONAL: 'personal',
  FRIEND: 'friend',           // App-layer alias of DB 'group' for markers
  PUBLIC: 'public',
  GROUP_LEGACY: 'group',      // DB ENUM value for markers — historical
});

/**
 * Valid permission values when reading or writing.
 * Includes 'group' so existing markers don't error out.
 */
const ALL_VALID_PERMISSIONS = Object.freeze(['personal', 'friend', 'group', 'public']);

/**
 * Permissions allowed for client write (POST/PATCH).
 *
 * v4.2 H1: `public` is rejected on all POST/PATCH for both markers and routes.
 * Only the seed scripts may insert 'public' rows directly into DB.
 */
const CLIENT_WRITEABLE_PERMISSIONS = Object.freeze(['personal', 'friend', 'group']);

/**
 * Permissions that mean "shared with friends in some way" — used for filtering
 * `circle/markers` and `circle/routes` queries.
 */
const SHARED_VISIBILITY = Object.freeze(['friend', 'group', 'public']);

/**
 * Normalize on read: collapse legacy 'group' → modern 'friend' before sending to client.
 *
 * @param {string} p - permission value as stored in DB
 * @returns {string} - permission value for client
 */
function normalize(p) {
  return p === PERMISSION.GROUP_LEGACY ? PERMISSION.FRIEND : p;
}

/**
 * Normalize on write: accept either 'friend' or 'group' from client,
 * write as 'group' for markers (preserves existing ENUM), 'friend' for routes.
 *
 * @param {string} p - permission value from client
 * @param {'mark'|'route'} kind - which table is being written
 * @returns {string} - permission value to write to DB
 */
function denormalizeForWrite(p, kind) {
  if (kind === 'mark' && p === PERMISSION.FRIEND) return PERMISSION.GROUP_LEGACY;
  return p;
}

/**
 * Validate a permission value from a client request.
 * Returns true if the value is acceptable for POST/PATCH.
 *
 * @param {string} p - permission value
 * @returns {boolean}
 */
function isClientWriteable(p) {
  return CLIENT_WRITEABLE_PERMISSIONS.includes(p);
}

module.exports = {
  PERMISSION,
  ALL_VALID_PERMISSIONS,
  CLIENT_WRITEABLE_PERMISSIONS,
  SHARED_VISIBILITY,
  normalize,
  denormalizeForWrite,
  isClientWriteable,
};
