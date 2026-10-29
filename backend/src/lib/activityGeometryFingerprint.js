'use strict';

/** Must remain byte-for-byte compatible with the mobile Final artifact CAS. */
function activityGeometryFingerprint(points) {
  let hash = 0x811c9dc5;
  for (const point of points || []) {
    const segmentId = point.segment_id ?? point.segmentId ?? '';
    const value = `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)},${segmentId};`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

module.exports = { activityGeometryFingerprint };
