'use strict';

const { deterministicCid } = require('../lib/deterministicCid');

const MAX_SHARED_ACCURACY_M = 50;
const EVIDENCE_TIME_TOLERANCE_MS = 1000;
const EVIDENCE_DISTANCE_TOLERANCE_M = 5;

function finitePoint(point) {
  return point
    && Number.isFinite(Number(point.lat))
    && Number.isFinite(Number(point.lng))
    && Number.isFinite(Number(point.t ?? point.ts))
    && Number(point.lat) >= -90 && Number(point.lat) <= 90
    && Number(point.lng) >= -180 && Number(point.lng) <= 180
    && Number(point.t ?? point.ts) > 0;
}

function pointAccuracy(point) {
  for (const value of [point?.horizontal_accuracy_m, point?.acc, point?.accuracy]) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const dLat = (Number(b.lat) - Number(a.lat)) * radians;
  const dLng = (Number(b.lng) - Number(a.lng)) * radians;
  const lat1 = Number(a.lat) * radians;
  const lat2 = Number(b.lat) * radians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function parsedPoints(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function closestRawPoint(point, rawPoints, options = {}) {
  const observedAt = Number(point.t ?? point.ts);
  const pointSegment = point.segment_id ?? point.source_segment_id ?? null;
  let best = null;
  for (const rawPoint of rawPoints) {
    if (!finitePoint(rawPoint)) continue;
    const rawObservedAt = Number(rawPoint.t ?? rawPoint.ts);
    const deltaMs = Math.abs(rawObservedAt - observedAt);
    if (deltaMs > EVIDENCE_TIME_TOLERANCE_MS) continue;
    const rawSegment = rawPoint.segment_id ?? rawPoint.source_segment_id ?? null;
    if (options.requireSegment && (!pointSegment || !rawSegment || pointSegment !== rawSegment)) continue;
    const distanceM = distanceMeters(point, rawPoint);
    if (options.requireSpatialMatch && distanceM > EVIDENCE_DISTANCE_TOLERANCE_M) continue;
    if (!best || deltaMs < best.deltaMs || (deltaMs === best.deltaMs && distanceM < best.distanceM)) {
      best = { point: rawPoint, deltaMs, distanceM };
    }
  }
  return best;
}

function deduplicateEvidence(points) {
  const result = [];
  const seen = new Set();
  for (const point of points) {
    const key = [
      Math.floor(Number(point.ts)),
      Number(point.lat).toFixed(7),
      Number(point.lng).toFixed(7),
      String(point.source_segment_id || 'legacy-0'),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result.sort((a, b) => Number(a.ts) - Number(b.ts));
}

function recoverHistoricalActivityEvidence(routeValue, rawValue, strategy) {
  const routePoints = parsedPoints(routeValue).filter(finitePoint);
  const rawPoints = parsedPoints(rawValue).filter(finitePoint);
  const recovered = [];
  for (const routePoint of routePoints) {
    const legacyExact = strategy === 'legacy_exact';
    const segmented = strategy === 'pre_canonical_segmented';
    if (!legacyExact && !segmented) throw new Error(`unsupported_historical_strategy:${strategy}`);
    if (legacyExact) {
      const routeAccuracy = pointAccuracy(routePoint);
      if (!Number.isFinite(routeAccuracy) || routeAccuracy < 0 || routeAccuracy > MAX_SHARED_ACCURACY_M) continue;
    }
    const match = closestRawPoint(routePoint, rawPoints, {
      requireSpatialMatch: legacyExact,
      requireSegment: segmented,
    });
    if (!match) continue;
    const accuracy = pointAccuracy(match.point);
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_SHARED_ACCURACY_M) continue;
    const segmentId = match.point.segment_id ?? routePoint.segment_id ?? (legacyExact ? 'legacy-0' : null);
    if (!segmentId) continue;
    recovered.push({
      lat: Number(match.point.lat),
      lng: Number(match.point.lng),
      ts: Math.floor(Number(match.point.t ?? match.point.ts)),
      source_segment_id: String(segmentId).slice(0, 80),
      horizontal_accuracy_m: accuracy,
      continuity_state: 'accepted',
    });
  }
  return deduplicateEvidence(recovered);
}

function canonicalActivityEvidence(canonicalValue, rawValue = []) {
  const canonicalPoints = parsedPoints(canonicalValue).filter(finitePoint);
  const rawPoints = parsedPoints(rawValue).filter(finitePoint);
  const recovered = [];
  for (const point of canonicalPoints) {
    const segmentId = point.segment_id ?? point.source_segment_id;
    if (typeof segmentId !== 'string' || segmentId.length < 1) continue;
    let accuracy = pointAccuracy(point);
    if (!Number.isFinite(accuracy)) {
      const match = closestRawPoint(point, rawPoints, { requireSpatialMatch: true, requireSegment: true });
      accuracy = match ? pointAccuracy(match.point) : null;
    }
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_SHARED_ACCURACY_M) continue;
    recovered.push({
      lat: Number(point.lat),
      lng: Number(point.lng),
      ts: Math.floor(Number(point.t ?? point.ts)),
      source_segment_id: segmentId.slice(0, 80),
      horizontal_accuracy_m: accuracy,
      continuity_state: 'accepted',
    });
  }
  return deduplicateEvidence(recovered);
}

function pointsOverlap(a, b) {
  return Math.abs(Number(a.ts) - Number(b.ts)) <= EVIDENCE_TIME_TOLERANCE_MS
    && distanceMeters(a, b) <= EVIDENCE_DISTANCE_TOLERANCE_M
    && String(a.source_segment_id || 'legacy-0') === String(b.source_segment_id || 'legacy-0');
}

function buildCurrentActivityMemoryRows({
  userId,
  clientActivityId,
  memoryPoints,
  canonicalPoints,
  rawPoints,
  nowMs = Date.now(),
}) {
  const rows = [];
  let rejected = 0;
  for (const point of Array.isArray(memoryPoints) ? memoryPoints : []) {
    const ts = Number(point?.ts);
    if (!finitePoint({ ...point, t: ts }) || !Number.isInteger(ts)
      || ts > nowMs + 24 * 60 * 60 * 1000 || ts > Number.MAX_SAFE_INTEGER) {
      rejected += 1;
      continue;
    }
    rows.push({
      user_id: Number(userId),
      lat: Number(point.lat),
      lng: Number(point.lng),
      ts,
      client_id: typeof point.cid === 'string' && point.cid.length > 0 && point.cid.length <= 36
        ? point.cid
        : deterministicCid(Number(userId), ts, Number(point.lat), Number(point.lng)),
      source_activity_client_id: clientActivityId || null,
      source_segment_id: typeof point.source_segment_id === 'string'
        ? point.source_segment_id.slice(0, 80)
        : null,
      horizontal_accuracy_m: point.horizontal_accuracy_m !== null
        && point.horizontal_accuracy_m !== undefined
        && Number.isFinite(Number(point.horizontal_accuracy_m))
        ? Number(point.horizontal_accuracy_m)
        : null,
      continuity_state: point.continuity_state === 'gap' ? 'gap' : 'accepted',
      derived_from_canonical: false,
    });
  }
  const canonical = canonicalActivityEvidence(canonicalPoints, rawPoints);
  for (const point of canonical) {
    if (rows.some(row => pointsOverlap(row, point))) continue;
    rows.push({
      user_id: Number(userId),
      ...point,
      client_id: deterministicCid(Number(userId), point.ts, point.lat, point.lng),
      source_activity_client_id: clientActivityId || null,
      derived_from_canonical: true,
    });
  }
  return { rows, rejected, canonicalRecovered: canonical.length };
}

async function upsertActivityMemoryRows(conn, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const values = rows.map(row => [
    row.user_id, row.lat, row.lng, row.ts, row.client_id, 'activity_real',
    row.source_activity_client_id, row.source_segment_id,
    row.horizontal_accuracy_m, row.continuity_state,
  ]);
  const chunkSize = 50;
  for (let index = 0; index < values.length; index += chunkSize) {
    await conn.query(
      `INSERT INTO memory_points
         (user_id, lat, lng, ts, client_id, evidence_source,
          source_activity_client_id, source_segment_id, horizontal_accuracy_m, continuity_state)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         evidence_source='activity_real',
         source_activity_client_id=COALESCE(VALUES(source_activity_client_id), source_activity_client_id),
         source_segment_id=COALESCE(VALUES(source_segment_id), source_segment_id),
         horizontal_accuracy_m=COALESCE(VALUES(horizontal_accuracy_m), horizontal_accuracy_m),
         continuity_state=VALUES(continuity_state)`,
      [values.slice(index, index + chunkSize)],
    );
  }
  return values.length;
}

module.exports = {
  MAX_SHARED_ACCURACY_M,
  EVIDENCE_TIME_TOLERANCE_MS,
  EVIDENCE_DISTANCE_TOLERANCE_M,
  distanceMeters,
  pointAccuracy,
  parsedPoints,
  recoverHistoricalActivityEvidence,
  canonicalActivityEvidence,
  buildCurrentActivityMemoryRows,
  upsertActivityMemoryRows,
};
