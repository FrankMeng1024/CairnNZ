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
 * Permissions allowed for client write (POST/PATCH).
 *
 * Controlled Public v1 allows `public` for Cairns. Route handlers retain an
 * explicit public rejection because Public Routes are out of scope.
 */
const CLIENT_WRITEABLE_PERMISSIONS = Object.freeze(['personal', 'friend', 'group', 'public']);

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
  CLIENT_WRITEABLE_PERMISSIONS,
  normalize,
  isClientWriteable,
};
