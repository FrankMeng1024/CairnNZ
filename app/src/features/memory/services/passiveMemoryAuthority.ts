/**
 * Durable, epoch-scoped revocation keys shared by the UI, TaskManager runtime,
 * and the final Memory writer boundary. Epoch-scoped tombstones mean an
 * obsolete cleanup cannot revoke a newer legitimate real-source lease.
 */
const PASSIVE_MEMORY_REVOKED_EPOCH_PREFIX = 'cairn:passive-memory:revoked:v1:';

function hashEpoch(epoch: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < epoch.length; index += 1) {
    hash ^= epoch.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function passiveMemoryRevocationKey(epoch: string): string {
  return `${PASSIVE_MEMORY_REVOKED_EPOCH_PREFIX}${hashEpoch(epoch)}`;
}
