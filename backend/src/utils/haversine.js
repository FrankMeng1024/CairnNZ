/**
 * Great-circle distance in meters between two lat/lng points.
 * Mean-Earth-radius approximation (6371008.8m). Accurate to ~0.5% for
 * typical AR-anchor distances (sub-100m).
 */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6_371_008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = { haversineM };
