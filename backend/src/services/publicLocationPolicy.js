'use strict';

const crypto = require('crypto');

// Public Cairns are encounter-based, but their API payload must never expose
// the owner's exact stored pin. A ~22 m latitude grid preserves the intended
// on-trail encounter radius while making every returned coordinate explicitly
// cell-level. Secure deployment config may additionally deny circular places;
// malformed config fails closed by disabling authorization.
const PUBLIC_LOCATION_GRID_DEGREES = 0.0002;
const PUBLIC_LOCATION_POLICY_ALGORITHM = 'grid-20m+deny-circles-v1';

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parseSensitiveZones(raw = process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('public_sensitive_zone_config_missing');
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('public_sensitive_zone_config_invalid'); }
  if (!Array.isArray(parsed) || parsed.length > 500) {
    throw new Error('public_sensitive_zone_config_invalid');
  }
  return parsed.map(zone => {
    const lat = Number(zone?.lat);
    const lng = Number(zone?.lng);
    const radiusM = Number(zone?.radius_m);
    if (!validCoordinate(lat, lng) || !Number.isFinite(radiusM) || radiusM < 1 || radiusM > 10_000) {
      throw new Error('public_sensitive_zone_config_invalid');
    }
    return Object.freeze({ lat, lng, radiusM });
  }).sort((left, right) => left.lat - right.lat || left.lng - right.lng || left.radiusM - right.radiusM);
}

function locationPolicyVersion(zones = parseSensitiveZones()) {
  const canonical = zones.map(zone => [zone.lat, zone.lng, zone.radiusM]);
  const digest = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return `${PUBLIC_LOCATION_POLICY_ALGORITHM}:sha256:${digest}`;
}

function distanceMetres(aLat, aLng, bLat, bLng) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function coarsen(value) {
  return Number((Math.round(value / PUBLIC_LOCATION_GRID_DEGREES)
    * PUBLIC_LOCATION_GRID_DEGREES).toFixed(6));
}

function evaluatePublicLocation(latValue, lngValue, zones = parseSensitiveZones()) {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!validCoordinate(lat, lng)) throw new Error('public_location_invalid');
  const coarseLat = coarsen(lat);
  const coarseLng = coarsen(lng);
  const excluded = zones.some(zone => (
    distanceMetres(lat, lng, zone.lat, zone.lng) <= zone.radiusM
    || distanceMetres(coarseLat, coarseLng, zone.lat, zone.lng) <= zone.radiusM
  ));
  if (excluded) {
    return { allowed: false, code: 'PUBLIC_SENSITIVE_PLACE_EXCLUDED' };
  }
  return {
    allowed: true,
    code: 'PUBLIC_LOCATION_COARSENED',
    lat: coarseLat,
    lng: coarseLng,
    approximate: true,
    policyVersion: locationPolicyVersion(zones),
  };
}

function isolatedReviewPolicyAllowed() {
  return process.env.NODE_ENV === 'test'
    && process.env.CAIRN_REALM === 'isolated_review'
    && process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT === '1';
}

function publicLocationPolicyConfigured() {
  try {
    const zones = parseSensitiveZones();
    return zones.length > 0 || isolatedReviewPolicyAllowed();
  } catch {
    return false;
  }
}

module.exports = {
  PUBLIC_LOCATION_GRID_DEGREES,
  PUBLIC_LOCATION_POLICY_ALGORITHM,
  parseSensitiveZones,
  locationPolicyVersion,
  evaluatePublicLocation,
  publicLocationPolicyConfigured,
  isolatedReviewPolicyAllowed,
};
