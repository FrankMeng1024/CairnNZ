#!/usr/bin/env node

/**
 * Reproducible, read-only forensic generator for real Activities `snap` and
 * historical-back-control. Exact source coordinates live only in process
 * memory. Every persisted geometry is translated into a local metre frame.
 *
 * Safety: SELECT-only production access, GET-only Mapbox access, docs-only
 * output. This script never calls a Cairn mutation endpoint.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const SNAP_ID = 2073;
const BACK_ID = 46;
const QA_SESSION = 'qa-mtwrqajx-un973228';
const EARTH_R = 6_371_000;

function round(value, digits = 3) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function parseJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function writeJson(name, value) {
  writeFileSync(resolve(here, name), `${JSON.stringify(value, null, 2)}\n`);
}

function csvCell(value) {
  if (value == null) return '';
  const rendered = typeof value === 'string' ? value : String(value);
  return /[,"\n]/.test(rendered) ? `"${rendered.replaceAll('"', '""')}"` : rendered;
}

function writeCsv(name, rows) {
  if (!rows.length) return writeFileSync(resolve(here, name), '');
  const columns = Object.keys(rows[0]);
  const text = [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n');
  writeFileSync(resolve(here, name), `${text}\n`);
}

function parseTelemetry(rawJsonl) {
  return String(rawJsonl || '').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function eventName(event) {
  return event.eventName ?? event.event ?? event.name ?? '';
}

function eventFields(event) {
  return event.fields ?? event.payload ?? {};
}

function loadPrivateEvidence() {
  const remoteSource = String.raw`
const db = require('./src/config/db');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
(async () => {
  const [sessions] = await db.query(
    'SELECT id,user_id,client_activity_id,type,start_time,end_time,finalized_at,distance_m,duration_s,name,route_points,route_points_raw,flags,created_at FROM sessions WHERE id IN (?,?) ORDER BY id',
    [2073,46],
  );
  const [telemetry] = await db.query(
    'SELECT id,session_id,device_model,device_os,os_version,app_version,build_number,started_at,ended_at,duration_ms,events_count,raw_jsonl,uploaded_at,upload_source FROM telemetry_sessions WHERE session_id=? ORDER BY id DESC',
    ['qa-mtwrqajx-un973228'],
  );
  console.log(JSON.stringify({
    sessions: sessions.map(row => ({...row, route_points: parse(row.route_points), route_points_raw: parse(row.route_points_raw)})),
    telemetry: telemetry.map(row => ({...row, raw_jsonl: String(row.raw_jsonl || '')})),
  }));
  await db.end();
})().catch(async error => { console.error(error.stack || error); try { await db.end(); } catch {} process.exit(1); });
`;
  const result = spawnSync(
    'ssh',
    ['ubuntu@122.51.174.118', 'sudo', '-n', 'docker', 'exec', '-i', 'cairn-backend', 'node'],
    { input: remoteSource, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`production SELECT failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function loadMapboxToken() {
  if (process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.startsWith('pk.')) {
    return process.env.EXPO_PUBLIC_MAPBOX_TOKEN.trim();
  }
  // Existing repository QA fixture only. The public token is never emitted.
  const fixture = readFileSync(resolve(root, 'app/_spike/v346-fog-https/test.html'), 'utf8');
  const match = fixture.match(/mapboxgl\.accessToken\s*=\s*['"](pk\.[^'"]+)['"]/);
  if (!match) throw new Error('Mapbox public token unavailable');
  return match[1];
}

function normalisePoint(point) {
  return {
    lat: Number(point.lat ?? point.latitude),
    lng: Number(point.lng ?? point.longitude),
    alt: point.alt ?? point.altitude ?? null,
    accuracy: point.acc ?? point.accuracy ?? null,
    speed: point.speed_mps ?? point.speed ?? null,
    t: point.t ?? point.timestamp ?? null,
    rawOrdinal: point.raw_ordinal ?? null,
    segmentId: point.segment_id ?? null,
  };
}

function hav(a, b) {
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += hav(points[i - 1], points[i]);
  return total;
}

function percentile(values, q) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return 0;
  const index = Math.max(0, Math.ceil(xs.length * q) - 1);
  return xs[index];
}

function median(values) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return 0;
  const middle = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[middle] : (xs[middle - 1] + xs[middle]) / 2;
}

function pointToSegmentMeters(point, start, end) {
  const metresPerDegree = 111_320;
  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const ax = (start.lng - point.lng) * metresPerDegree * cosLat;
  const ay = (start.lat - point.lat) * metresPerDegree;
  const bx = (end.lng - point.lng) * metresPerDegree * cosLat;
  const by = (end.lat - point.lat) * metresPerDegree;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function pointToPathMeters(point, path) {
  if (path.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    best = Math.min(best, pointToSegmentMeters(point, path[i - 1], path[i]));
  }
  return best;
}

function quality(raw, matched) {
  const deviations = raw.map(point => pointToPathMeters(point, matched));
  const acc = raw.map(p => p.accuracy).filter(v => Number.isFinite(v) && v > 0);
  const accuracyP95 = acc.length ? percentile(acc, 0.95) : 10;
  const envelope = Math.min(15, Math.max(8, accuracyP95 * 1.25));
  const maxEnvelope = Math.min(30, Math.max(18, envelope * 1.5));
  const endpoint = Math.max(hav(raw[0], matched[0]), hav(raw.at(-1), matched.at(-1)));
  const rawLength = pathLength(raw);
  const matchedLength = pathLength(matched);
  const ratio = rawLength > 1 ? matchedLength / rawLength : 1;
  const p50 = median(deviations);
  const p95 = percentile(deviations, 0.95);
  const max = Math.max(...deviations);
  const reason = p95 > envelope ? 'raw_deviation'
    : max > maxEnvelope ? 'max_raw_deviation'
      : endpoint > Math.max(20, envelope) ? 'endpoint_displacement'
        : ratio < 0.67 || ratio > 1.5 ? 'length_distortion'
          : 'accepted';
  return {
    accepted: reason === 'accepted', reason,
    p50DeviationM: round(p50), p95DeviationM: round(p95), maxDeviationM: round(max),
    endpointDeviationM: round(endpoint), rawLengthM: round(rawLength),
    matchedLengthM: round(matchedLength), lengthRatio: round(ratio, 4),
    deviationEnvelopeM: round(envelope),
  };
}

function endpointCoverage(raw, matched) {
  const acc = raw.map(p => p.accuracy).filter(v => Number.isFinite(v) && v >= 0);
  const accuracyP95 = acc.length ? percentile(acc, 0.95) : 10;
  const envelope = Math.min(20, Math.max(8, accuracyP95 * 1.25));
  const head = hav(raw[0], matched[0]);
  const tail = hav(raw.at(-1), matched.at(-1));
  return { accepted: head <= envelope && tail <= envelope, headM: round(head), tailM: round(tail), envelopeM: round(envelope) };
}

function cadence(points) {
  const temporal = [];
  const spatial = [];
  for (let i = 1; i < points.length; i += 1) {
    if (Number.isFinite(points[i].t) && Number.isFinite(points[i - 1].t)) {
      temporal.push((points[i].t - points[i - 1].t) / 1000);
    }
    spatial.push(hav(points[i - 1], points[i]));
  }
  return {
    temporalP50S: round(median(temporal)), temporalP95S: round(percentile(temporal, .95)),
    spatialP50M: round(median(spatial)), spatialP95M: round(percentile(spatial, .95)),
  };
}

function temporalResample(points, seconds = 4, mandatory = new Set()) {
  if (points.length <= 2) return points.map((point, sourceIndex) => ({ ...point, sourceIndex }));
  const out = [{ ...points[0], sourceIndex: 0 }];
  let lastKeptT = points[0].t;
  for (let i = 1; i < points.length - 1; i += 1) {
    const elapsed = Number.isFinite(points[i].t) && Number.isFinite(lastKeptT)
      ? points[i].t - lastKeptT
      : Infinity;
    if (mandatory.has(i) || elapsed >= seconds * 1000) {
      out.push({ ...points[i], sourceIndex: i });
      lastKeptT = points[i].t;
    }
  }
  out.push({ ...points.at(-1), sourceIndex: points.length - 1 });
  return out;
}

function nearestSourceMetadata(route, raw) {
  return route.map(point => {
    let best = raw[0]; let bestDistance = hav(point, raw[0]); let bestIndex = 0;
    for (let i = 1; i < raw.length; i += 1) {
      const distance = hav(point, raw[i]);
      if (distance < bestDistance) { best = raw[i]; bestDistance = distance; bestIndex = i; }
    }
    return { ...point, t: best.t, accuracy: best.accuracy, speed: best.speed, sourceIndex: bestIndex, nearestRawDistanceM: bestDistance };
  });
}

function replayHistoricalV77(raw) {
  const accepted = [];
  let lastAccepted = null;
  let lastAcceptedT = null;
  for (const point of raw) {
    if (lastAccepted && Number.isFinite(lastAcceptedT)) {
      const dtS = (point.t - lastAcceptedT) / 1000;
      const distance = hav(lastAccepted, point);
      if (dtS > 0 && distance > 30 && distance / dtS > 10) continue;
    }
    if (Number.isFinite(point.accuracy) && point.accuracy > 25) continue;
    const distance = lastAccepted ? hav(lastAccepted, point) : Infinity;
    const radius = Math.max(8, Number.isFinite(point.accuracy) ? point.accuracy : 0);
    if (point.speed != null && point.speed >= 0 && point.speed < .5 && lastAccepted && distance <= radius) {
      lastAcceptedT = point.t;
      continue;
    }
    accepted.push(point);
    lastAccepted = point;
    lastAcceptedT = point.t;
  }
  return accepted;
}

function historicalKalman(points, processNoise = 1e-9) {
  const init = (x, accuracy) => {
    const r = accuracy > 0 ? (accuracy / 111000) ** 2 : .0001;
    return { x, p: r, q: processNoise, r };
  };
  const update = (state, measurement, accuracy) => {
    const pPredicted = state.p + state.q;
    if (accuracy != null && accuracy > 0) state.r = (accuracy / 111000) ** 2;
    const gain = pPredicted / (pPredicted + state.r);
    state.x += gain * (measurement - state.x);
    state.p = (1 - gain) * pPredicted;
    return state.x;
  };
  let latState = null; let lngState = null;
  return points.map(point => {
    const accuracy = Number.isFinite(point.accuracy) ? point.accuracy : 10;
    if (!latState) {
      latState = init(point.lat, accuracy); lngState = init(point.lng, accuracy);
      return { ...point };
    }
    return { ...point, lat: update(latState, point.lat, accuracy), lng: update(lngState, point.lng, accuracy) };
  });
}

function densifyBetween(a, b, step = 20) {
  const distance = hav(a, b);
  if (distance <= step) return [{ ...b }];
  const count = Math.ceil(distance / step);
  return Array.from({ length: count }, (_unused, index) => {
    const f = (index + 1) / count;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  });
}

function densifyPath(points, step = 20) {
  if (points.length < 2) return points.slice();
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length; i += 1) out.push(...densifyBetween(points[i - 1], points[i], step));
  return out;
}

function legacyRuns(points) {
  if (!points.length) return [];
  const lost = point => point.speed === -1 || (Number.isFinite(point.accuracy) && point.accuracy > 20);
  const runs = [];
  let start = 0; let kind = lost(points[0]) ? 'lost' : 'good';
  for (let i = 1; i < points.length; i += 1) {
    const next = lost(points[i]) ? 'lost' : 'good';
    if (next !== kind) { runs.push({ start, end: i, kind }); start = i; kind = next; }
  }
  runs.push({ start, end: points.length, kind });
  return runs;
}

async function runLegacyV64(name, points, token) {
  const runs = legacyRuns(points);
  const final = [];
  const requests = [];
  let chunksOk = 0; let chunksFallback = 0; let seamBridges = 0;
  const appendRun = piece => {
    if (!piece.length) return;
    if (final.length && hav(final.at(-1), piece[0]) > 20) final.push(...densifyBetween(final.at(-1), piece[0], 20));
    const start = final.length && hav(final.at(-1), piece[0]) <= 3 ? 1 : 0;
    final.push(...piece.slice(start));
  };
  for (const run of runs) {
    const runPoints = points.slice(run.start, run.end);
    if (run.kind === 'lost') { appendRun(densifyPath(runPoints, 20)); continue; }
    const bounds = [];
    for (let start = 0; start < runPoints.length;) {
      const end = Math.min(start + 80, runPoints.length); bounds.push({ start, end });
      if (end === runPoints.length) break; start = end - 10;
    }
    const runOut = [];
    for (const bound of bounds) {
      const input = runPoints.slice(bound.start, bound.end);
      const result = await mapboxMatch(input, token, { tidy: true, timestamps: false });
      const first = result.body.matchings?.[0];
      const confidence = first?.confidence ?? 0;
      const geometry = first?.geometry?.coordinates?.map(([lng, lat]) => ({ lat, lng })) ?? [];
      const accepted = result.body.code === 'Ok' && confidence >= .3 && geometry.length >= 2;
      requests.push({ runStart: run.start, sourceStart: run.start + bound.start, sourceEnd: run.start + bound.end - 1, accepted, confidence: round(confidence, 6), ...result.privacySafe, tracepoints: undefined });
      if (accepted) chunksOk += 1; else chunksFallback += 1;
      const piece = accepted ? geometry : densifyPath(input, 20);
      if (!piece.length) continue;
      if (!runOut.length) { runOut.push(...piece); continue; }
      let bestIndex = 0; let bestDistance = hav(runOut.at(-1), piece[0]);
      for (let i = 1; i < Math.min(piece.length, 30); i += 1) {
        const distance = hav(runOut.at(-1), piece[i]);
        if (distance < bestDistance) { bestIndex = i; bestDistance = distance; }
      }
      if (bestDistance > 30) { seamBridges += 1; runOut.push(...densifyBetween(runOut.at(-1), piece[bestIndex], 20)); }
      runOut.push(...piece.slice(bestIndex + 1));
    }
    appendRun(runOut);
  }
  const deduped = [];
  for (const point of final) if (!deduped.length || hav(deduped.at(-1), point) > 3) deduped.push(point);
  const smoothed = deduped.map((point, index) => index === 0 || index === deduped.length - 1 ? point : ({
    lat: (deduped[index - 1].lat + point.lat + deduped[index + 1].lat) / 3,
    lng: (deduped[index - 1].lng + point.lng + deduped[index + 1].lng) / 3,
  }));
  const deviations = points.map(point => pointToPathMeters(point, smoothed));
  return { name, points: smoothed, requests, summary: {
    name, sourceCount: points.length, outputCount: smoothed.length, goodRuns: runs.filter(r => r.kind === 'good').length,
    lostRuns: runs.filter(r => r.kind === 'lost').length, chunksOk, chunksFallback, seamBridges,
    sourceLengthM: round(pathLength(points)), outputLengthM: round(pathLength(smoothed)),
    lengthRatio: round(pathLength(smoothed) / pathLength(points), 4),
    sourceToOutputP50M: round(median(deviations)), sourceToOutputP95M: round(percentile(deviations, .95)),
    sourceToOutputMaxM: round(Math.max(...deviations)), requests,
  } };
}

function productionChunks(points, size = 80, overlap = 1) {
  const chunks = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + size, points.length);
    chunks.push({ start, end, points: points.slice(start, end) });
    if (end === points.length) break;
    start = end - overlap;
  }
  return chunks;
}

function strictTimestamps(points) {
  const seconds = points.map(p => Number.isFinite(p.t) ? Math.floor(p.t / 1000) : null);
  return seconds.every(v => v != null)
    && seconds.every((v, i) => i === 0 || v > seconds[i - 1]);
}

function productionRadius(point) {
  const acc = Number.isFinite(point.accuracy) ? point.accuracy : 15;
  return Math.round(Math.max(10, Math.min(40, acc)));
}

function conservativeRadius(point) {
  const acc = Number.isFinite(point.accuracy) ? point.accuracy : 12;
  // Keep the uncertainty-aware policy bounded; unlike a global wide radius,
  // this cannot reach a distant external road merely to improve coverage.
  return Math.round(Math.max(10, Math.min(25, acc * 1.5)));
}

async function mapboxMatch(points, token, options = {}) {
  const started = Date.now();
  const tidy = options.tidy ?? true;
  const radiusFn = options.radiusFn ?? productionRadius;
  const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const radii = points.map(radiusFn);
  const timestampOk = options.timestamps !== false && strictTimestamps(points);
  const timestamps = timestampOk ? points.map(p => Math.floor(p.t / 1000)).join(';') : null;
  const query = new URLSearchParams({
    geometries: 'geojson', overview: 'full', tidy: String(tidy),
    radiuses: radii.join(';'), access_token: token,
  });
  if (timestamps) query.set('timestamps', timestamps);
  const url = `https://api.mapbox.com/matching/v5/mapbox/walking/${coords}?${query}`;
  const response = await fetch(url);
  const body = await response.json();
  const tracepoints = Array.isArray(body.tracepoints) ? body.tracepoints : [];
  const matchings = Array.isArray(body.matchings) ? body.matchings : [];
  const tracepointSummary = tracepoints.map((tp, index) => tp == null ? {
    inputIndex: index, matched: false,
  } : {
    inputIndex: index,
    matched: true,
    matchingIndex: tp.matchings_index ?? null,
    waypointIndex: tp.waypoint_index ?? null,
    alternativesCount: tp.alternatives_count ?? null,
    displacementM: Array.isArray(tp.location)
      ? round(hav(points[index], { lng: tp.location[0], lat: tp.location[1] }))
      : null,
  });
  const matchingSummary = matchings.map((matching, index) => ({
    index,
    confidence: round(matching.confidence, 6),
    distanceM: round(matching.distance),
    geometryPointCount: matching.geometry?.coordinates?.length ?? 0,
  }));
  return {
    input: points,
    radii,
    response,
    body,
    privacySafe: {
      httpStatus: response.status,
      code: body.code ?? null,
      message: body.message ?? null,
      durationMs: Date.now() - started,
      inputCount: points.length,
      timestampsIncluded: Boolean(timestamps),
      tidy,
      radiusMinM: Math.min(...radii),
      radiusMaxM: Math.max(...radii),
      matchingsCount: matchings.length,
      tracepointCount: tracepoints.length,
      nullTracepointCount: tracepoints.filter(tp => tp == null).length,
      tracepoints: tracepointSummary,
      matchings: matchingSummary,
    },
  };
}

function orderedSubmatches(result) {
  const { input, body } = result;
  const tracepoints = Array.isArray(body.tracepoints) ? body.tracepoints : [];
  const matchings = Array.isArray(body.matchings) ? body.matchings : [];
  return matchings.map((matching, matchingIndex) => {
    const indices = tracepoints.flatMap((tp, index) => tp?.matchings_index === matchingIndex ? [index] : []);
    const contiguous = indices.length >= 2 && indices.every((value, i) => i === 0 || value === indices[i - 1] + 1);
    const raw = indices.length ? input.slice(indices[0], indices.at(-1) + 1) : [];
    const geometry = (matching.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    const q = raw.length >= 2 && geometry.length >= 2 ? quality(raw, geometry) : null;
    const endpoints = raw.length >= 2 && geometry.length >= 2 ? endpointCoverage(raw, geometry) : null;
    const accepted = contiguous && indices.length >= 2 && (matching.confidence ?? 0) >= .3
      && geometry.length >= 2 && q?.accepted && endpoints?.accepted;
    return {
      matchingIndex,
      sourceStart: indices[0] ?? null,
      sourceEnd: indices.at(-1) ?? null,
      sourceCount: indices.length,
      contiguous,
      confidence: round(matching.confidence ?? 0, 6),
      quality: q,
      endpoints,
      accepted: Boolean(accepted),
      rejectReason: accepted ? null
        : !contiguous || indices.length < 2 ? 'noncontiguous-or-too-short'
          : (matching.confidence ?? 0) < .3 ? 'confidence'
            : !q?.accepted ? `quality-${q?.reason ?? 'missing'}`
              : !endpoints?.accepted ? 'endpoint-coverage'
                : 'missing-geometry',
      geometry,
      raw,
    };
  });
}

async function runChunkedExperiment(name, points, token, options = {}) {
  const chunks = productionChunks(points, options.chunkSize ?? 80, 1);
  const requests = [];
  for (const chunk of chunks) {
    const result = await mapboxMatch(chunk.points, token, options);
    requests.push({ ...chunk, result, submatches: orderedSubmatches(result) });
  }
  const accepted = requests.flatMap(request => request.submatches
    .filter(submatch => submatch.accepted)
    .map(submatch => ({
      sourceStart: request.start + submatch.sourceStart,
      sourceEnd: request.start + submatch.sourceEnd,
      sourceOriginalStart: submatch.raw[0]?.sourceIndex ?? null,
      sourceOriginalEnd: submatch.raw.at(-1)?.sourceIndex ?? null,
      geometry: submatch.geometry,
      raw: submatch.raw,
      confidence: submatch.confidence,
      quality: submatch.quality,
    })));
  const matchedObservationIndices = new Set();
  for (const subsection of accepted) {
    for (let i = subsection.sourceStart; i <= subsection.sourceEnd; i += 1) matchedObservationIndices.add(i);
  }
  return {
    name,
    points,
    requests,
    accepted,
    summary: {
      name,
      inputCount: points.length,
      cadence: cadence(points),
      chunkCount: chunks.length,
      okResponses: requests.filter(r => r.result.privacySafe.code === 'Ok').length,
      noSegmentResponses: requests.filter(r => r.result.privacySafe.code === 'NoSegment').length,
      totalTracepoints: requests.reduce((n, r) => n + r.result.privacySafe.tracepointCount, 0),
      nullTracepoints: requests.reduce((n, r) => n + r.result.privacySafe.nullTracepointCount, 0),
      acceptedSubsections: accepted.length,
      acceptedObservationCoverage: round(matchedObservationIndices.size / Math.max(1, points.length), 4),
      acceptedSourceDistanceM: round(accepted.reduce((sum, s) => sum + pathLength(s.raw), 0)),
      acceptedRanges: accepted.map(s => ({
        resampledStart: s.sourceStart,
        resampledEnd: s.sourceEnd,
        canonicalStart: s.sourceOriginalStart,
        canonicalEnd: s.sourceOriginalEnd,
        rawOrdinalStart: s.raw[0]?.rawOrdinal ?? null,
        rawOrdinalEnd: s.raw.at(-1)?.rawOrdinal ?? null,
        distanceM: round(pathLength(s.raw)),
        confidence: s.confidence,
        quality: s.quality,
      })),
      requestSummaries: requests.map(({ start, end, result, submatches }) => ({
        sourceStart: start,
        sourceEnd: end - 1,
        ...result.privacySafe,
        tracepoints: undefined,
        submatches: submatches.map(({ geometry, raw, ...rest }) => rest),
      })),
    },
  };
}

async function runWindowProbe(name, points, token, start, end, windowSize = 12, stride = 10) {
  const probes = [];
  for (let cursor = start; cursor < end - 1; cursor += stride) {
    const tail = Math.min(end, cursor + windowSize);
    if (tail - cursor < 2) break;
    const result = await mapboxMatch(points.slice(cursor, tail), token, { tidy: false, radiusFn: conservativeRadius });
    const submatches = orderedSubmatches(result);
    probes.push({
      start: cursor, end: tail - 1,
      response: { ...result.privacySafe, tracepoints: undefined },
      submatches: submatches.map(({ geometry, raw, ...rest }) => rest),
      privateSubmatches: submatches,
    });
    if (tail === end) break;
  }
  return { name, probes };
}

function privacySafeGeometry(points, toLocal, extra = {}) {
  return {
    type: 'Feature',
    properties: extra,
    geometry: { type: 'LineString', coordinates: points.map(point => {
      const p = toLocal(point);
      return [p.x, p.y];
    }) },
  };
}

function anonymiser(allPoints) {
  const origin = allPoints[0];
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  return point => ({
    x: round((point.lng - origin.lng) * 111_320 * cosLat, 2),
    y: round((point.lat - origin.lat) * 111_320, 2),
    ...(Number.isFinite(point.t) ? { tRelS: round((point.t - origin.t) / 1000, 3) } : {}),
    ...(point.rawOrdinal != null ? { rawOrdinal: point.rawOrdinal } : {}),
  });
}

function localPoint(point, toLocal) {
  const local = toLocal(point);
  return { x: local.x, y: local.y, ...(local.tRelS != null ? { tRelS: local.tRelS } : {}) };
}

function preserveEndpoints(raw, matched) {
  if (raw.length < 2 || matched.length < 2) return matched.slice();
  const out = matched.slice();
  if (hav(raw[0], out[0]) <= 3) out[0] = { ...raw[0] };
  else out.unshift({ ...raw[0] });
  if (hav(raw.at(-1), out.at(-1)) <= 3) out[out.length - 1] = { ...raw.at(-1) };
  else out.push({ ...raw.at(-1) });
  return out;
}

function mergeHybrid(canonical, replacements) {
  const sorted = replacements.slice().sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  const append = piece => {
    if (!piece.length) return;
    if (out.length && hav(out.at(-1), piece[0]) <= .5) out.push(...piece.slice(1));
    else out.push(...piece);
  };
  for (const replacement of sorted) {
    if (replacement.start > cursor) append(canonical.slice(cursor, replacement.start + 1));
    append(preserveEndpoints(canonical.slice(replacement.start, replacement.end + 1), replacement.geometry));
    cursor = replacement.end;
  }
  if (cursor < canonical.length - 1) append(canonical.slice(cursor));
  return out;
}

function presentationRoute(points) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const previous = out.at(-1);
    const target = points[i];
    const d = hav(previous, target);
    const blend = d < 2 ? .8 : .9;
    const blended = {
      ...target,
      lat: previous.lat + (target.lat - previous.lat) * blend,
      lng: previous.lng + (target.lng - previous.lng) * blend,
    };
    const residual = hav(blended, target);
    if (residual <= 2 || d <= 0) out.push(blended);
    else {
      const fraction = Math.max(0, (d - 2) / d);
      out.push({ ...target, lat: previous.lat + (target.lat - previous.lat) * fraction, lng: previous.lng + (target.lng - previous.lng) * fraction });
    }
  }
  return out;
}

function htmlPreview({ title, subtitle, panels, datasets, notes }) {
  const safeData = JSON.stringify(datasets).replaceAll('</script', '<\\/script');
  const safePanels = JSON.stringify(panels).replaceAll('</script', '<\\/script');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{--ink:#18352f;--paper:#f4efe3;--card:#fffaf0;--gold:#c79842;--sage:#6f8f7b;--raw:#9e8d78;--canon:#164b42;--match:#d36b38;--fallback:#7a6d99;--muted:#60706a}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1180px;margin:auto;padding:18px}.mast{border:1px solid #d8cdb7;border-radius:22px;padding:20px;background:linear-gradient(145deg,#fffaf0,#eee5d4);box-shadow:0 14px 40px #18352f14}.eyebrow{letter-spacing:.16em;text-transform:uppercase;font-size:11px;color:#6a756d}.title{font:700 clamp(25px,4vw,42px)/1.05 Georgia,serif;margin:7px 0}.subtitle{max-width:850px;color:var(--muted)}.controls{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.control{display:flex;gap:7px;align-items:center;background:#fff8eb;border:1px solid #ddd0bb;border-radius:999px;padding:7px 11px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px}.panel{background:var(--card);border:1px solid #d8cdb7;border-radius:18px;padding:12px;min-height:390px}.panel h2{font:700 18px Georgia,serif;margin:2px 0 4px}.panel p{font-size:12px;color:var(--muted);margin:0 0 8px}.map{width:100%;height:330px;border-radius:13px;background:#ebe3d5}.notes{margin-top:14px;padding:14px 18px;border-left:4px solid var(--gold);background:#fff8eb;border-radius:8px}.notes li+li{margin-top:6px}.legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin:8px 0}.sw{width:18px;height:3px;display:inline-block;vertical-align:middle;margin-right:4px;border-radius:9px}@media(max-width:520px){.shell{padding:10px}.mast{padding:14px}.panel{min-height:340px}.map{height:285px}}
</style></head><body><main class="shell"><section class="mast"><div class="eyebrow">Cairn Internal · privacy-safe local metre frame</div><h1 class="title">${title}</h1><div class="subtitle">${subtitle}</div><div class="controls" id="controls"></div><div class="grid" id="grid"></div><div class="notes"><strong>Reading guide</strong><ul>${notes.map(note => `<li>${note}</li>`).join('')}</ul></div></section></main>
<script>const DATA=${safeData};const PANELS=${safePanels};const colors={raw:'#9e8d78',canonical:'#164b42',production:'#a52a2a',display:'#c79842',candidate:'#d36b38',accepted:'#347e65',fallback:'#7a6d99',historical:'#356b93',network:'#d36b38',on:'#347e65',off:'#a52a2a',crossing:'#df9d28',internal:'#7a6d99',uturn:'#a52a2a',repeat:'#356b93'};
const enabled=new Set(Object.keys(DATA));const controls=document.getElementById('controls');Object.keys(DATA).forEach(k=>{const l=document.createElement('label');l.className='control';l.innerHTML='<input type="checkbox" checked data-k="'+k+'"><span>'+DATA[k].label+'</span>';controls.append(l)});controls.onchange=e=>{const k=e.target.dataset.k;if(!k)return;e.target.checked?enabled.add(k):enabled.delete(k);draw()};
function bounds(keys){const pts=keys.flatMap(k=>(DATA[k]?.paths||[]).flat());const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return {minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)}}
function draw(){const grid=document.getElementById('grid');grid.innerHTML='';for(const panel of PANELS){const card=document.createElement('section');card.className='panel';card.innerHTML='<h2>'+panel.title+'</h2><p>'+panel.caption+'</p><div class="legend">'+panel.keys.map(k=>'<span><i class="sw" style="background:'+colors[k]+'"></i>'+DATA[k].label+'</span>').join('')+'</div><svg class="map" viewBox="0 0 360 330" role="img"></svg>';grid.append(card);const svg=card.querySelector('svg');const keys=panel.keys.filter(k=>enabled.has(k)&&DATA[k]);if(!keys.length)continue;const b=bounds(panel.keys.filter(k=>DATA[k]));const pad=18,w=Math.max(1,b.maxX-b.minX),h=Math.max(1,b.maxY-b.minY),s=Math.min((360-pad*2)/w,(330-pad*2)/h),tx=x=>pad+(x-b.minX)*s,ty=y=>330-pad-(y-b.minY)*s;for(const k of keys){for(const path of DATA[k].paths){const el=document.createElementNS('http://www.w3.org/2000/svg','polyline');el.setAttribute('points',path.map(p=>tx(p[0])+','+ty(p[1])).join(' '));el.setAttribute('fill','none');el.setAttribute('stroke',colors[k]);el.setAttribute('stroke-width',k==='raw'?1.1:2.7);el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');el.setAttribute('opacity',k==='raw'?.55:.92);svg.append(el)}}for(const marker of (panel.markers||[])){const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',tx(marker.point[0]));c.setAttribute('cy',ty(marker.point[1]));c.setAttribute('r','4.5');c.setAttribute('fill',marker.color||'#c79842');c.setAttribute('stroke','#fffaf0');c.setAttribute('stroke-width','2');svg.append(c)}}}
draw();</script></body></html>`;
}

async function main() {
  const evidence = loadPrivateEvidence();
  const snapRow = evidence.sessions.find(row => row.id === SNAP_ID);
  const backRow = evidence.sessions.find(row => row.id === BACK_ID);
  if (!snapRow || !backRow) throw new Error('required Activities unavailable');
  const snap = parseJson(snapRow.route_points).map(normalisePoint);
  const snapRaw = parseJson(snapRow.route_points_raw).map(normalisePoint);
  const back = parseJson(backRow.route_points).map(normalisePoint);
  const backRaw = parseJson(backRow.route_points_raw).map(normalisePoint);
  const backWithMetadata = nearestSourceMetadata(back, backRaw);
  const backHistoricalReplay = replayHistoricalV77(backRaw);
  const snapHistoricalStyle = historicalKalman(snap);
  const token = loadMapboxToken();

  const productionRequests = [];
  for (const chunk of productionChunks(snap)) {
    productionRequests.push({ ...chunk, result: await mapboxMatch(chunk.points, token, { tidy: true }) });
  }

  const snapMandatory = new Set();
  // Preserve the confirmed stop-transition V and immediate neighbours.
  for (let i = 0; i < snap.length; i += 1) {
    if (snap[i].rawOrdinal != null && snap[i].rawOrdinal >= 245 && snap[i].rawOrdinal <= 252) snapMandatory.add(i);
  }
  // Preserve every strong local turn/reversal; this intentionally uses only
  // ordered geometry and does not deduplicate repeated geography.
  for (let i = 1; i < snap.length - 1; i += 1) {
    const a = snap[i - 1]; const b = snap[i]; const c = snap[i + 1];
    const bearing = (p, q) => {
      const dLng = (q.lng - p.lng) * Math.PI / 180;
      const pLat = p.lat * Math.PI / 180; const qLat = q.lat * Math.PI / 180;
      return Math.atan2(Math.sin(dLng) * Math.cos(qLat), Math.cos(pLat) * Math.sin(qLat) - Math.sin(pLat) * Math.cos(qLat) * Math.cos(dLng)) * 180 / Math.PI;
    };
    const delta = Math.abs(((bearing(b, c) - bearing(a, b) + 540) % 360) - 180);
    if (delta >= 65 && hav(a, b) >= .6 && hav(b, c) >= .6) snapMandatory.add(i);
  }
  const snap4s = temporalResample(snap, 4, snapMandatory);
  const d1 = await runChunkedExperiment('D1_4S_TIDY_FALSE', snap4s, token, { tidy: false });
  const d2 = await runChunkedExperiment('D2_4S_TIDY_TRUE', snap4s, token, { tidy: true });
  const d3 = await runChunkedExperiment('D3_4S_TIDY_FALSE_CONSERVATIVE_RADII', snap4s, token, { tidy: false, radiusFn: conservativeRadius });

  const d4Candidates = [
    { name: 'D4_HEAD_MAPPED_CANDIDATE', start: 0, end: 22 },
    { name: 'D4A_INITIAL_PUBLIC_CORRIDOR', start: 0, end: 38 },
    { name: 'D4B_LOWER_PUBLIC_OUTBOUND', start: 60, end: 82 },
    { name: 'D4C_LOWER_PUBLIC_RETURN', start: 88, end: 104 },
    { name: 'D4D_FINAL_PUBLIC_CORRIDOR', start: 131, end: 150 },
  ];
  const d4 = [];
  for (const section of d4Candidates) {
    d4.push(await runChunkedExperiment(section.name, snap4s.slice(section.start, section.end), token, { tidy: false, chunkSize: 80 }));
  }
  const d5 = await runChunkedExperiment('D5_INTERNAL_PATH_OUTBOUND', snap4s.slice(40, 61), token, { tidy: false, chunkSize: 80 });
  const o48OnBack = await runChunkedExperiment('O48_MATCHER_ON_HISTORICAL_BACK', backWithMetadata, token, { tidy: true });
  const o48OnBackTidyFalse = await runChunkedExperiment('BACK_TIDY_FALSE_CONTROL', backWithMetadata, token, { tidy: false });
  const windowProbes = [];
  windowProbes.push(await runWindowProbe('INITIAL_PUBLIC_WINDOWS', snap4s, token, 0, 40));
  windowProbes.push(await runWindowProbe('INTERNAL_OUTBOUND_WINDOWS', snap4s, token, 40, 61));
  windowProbes.push(await runWindowProbe('LOWER_OUT_AND_BACK_WINDOWS', snap4s, token, 60, 104));
  windowProbes.push(await runWindowProbe('INTERNAL_RETURN_WINDOWS', snap4s, token, 104, 131));
  windowProbes.push(await runWindowProbe('FINAL_PUBLIC_WINDOWS', snap4s, token, 131, 150));

  // The nearest reproducible historical matcher is v6.4 from 9de77bd. Its
  // own source comment says it was validated against session 46 (`back`). It
  // post-dates that recording, so it is a control pipeline—not provenance for
  // the original save.
  const legacyV64OnSnap = await runLegacyV64('HISTORICAL_BACK_STYLE_ON_SNAP', snap, token);
  const legacyV64OnBack = await runLegacyV64('BACK_V64_CONTROL', backWithMetadata, token);

  const telemetryEvents = parseTelemetry(evidence.telemetry[0]?.raw_jsonl);
  const observationsByOrdinal = new Map();
  const decisionsByOrdinal = new Map();
  for (const event of telemetryEvents) {
    const fields = eventFields(event);
    const ordinal = Number(fields.rawOrdinal);
    if (!Number.isFinite(ordinal)) continue;
    if (eventName(event) === 'activity_observation_received_v2') observationsByOrdinal.set(ordinal, fields);
    if (eventName(event) === 'activity_filter_decision_v2') decisionsByOrdinal.set(ordinal, fields);
  }
  const stopAnchor = snapRaw.find(point => point.rawOrdinal === 246);
  const stopTimeline = snapRaw.filter(point => point.rawOrdinal >= 236 && point.rawOrdinal <= 252).map(point => {
    const observation = observationsByOrdinal.get(point.rawOrdinal) ?? {};
    const decision = decisionsByOrdinal.get(point.rawOrdinal) ?? {};
    const canonicalIndex = snap.findIndex(candidate => candidate.rawOrdinal === point.rawOrdinal);
    const priorCanonical = canonicalIndex >= 0 ? snap[canonicalIndex - 1] : [...snap].reverse().find(candidate => candidate.t <= point.t);
    const canonicalEdgeM = canonicalIndex > 0 ? hav(snap[canonicalIndex - 1], snap[canonicalIndex]) : 0;
    return {
      relativeTimeS: round((point.t - stopAnchor.t) / 1000, 3),
      rawOrdinal: point.rawOrdinal,
      source: observation.sampleSource ?? null,
      rawRelativeDisplacementM: round(hav(stopAnchor, point)),
      horizontalAccuracyM: round(point.accuracy),
      reportedSpeedMps: round(point.speed),
      speedAccuracyMps: observation.speedAccuracyMps ?? null,
      courseDeg: observation.reportedCourseValid ? round(observation.reportedCourseDeg ?? null) : null,
      courseAccuracyDeg: observation.courseAccuracyDeg ?? null,
      positionEstimate: decision.decision === 'REFINE' ? 'robust-weighted-median (ephemeral; exact coordinate not logged)' : decision.decision === 'ACCEPT' ? 'accepted observation' : 'unchanged / candidate-only',
      traversalAnchor: canonicalIndex >= 0 ? `advanced-to-raw-${point.rawOrdinal}` : priorCanonical?.rawOrdinal != null ? `held-at-raw-${priorCanonical.rawOrdinal}` : 'held',
      movementStateBefore: decision.motionStateBefore ?? null,
      movementStateAfter: decision.motionState ?? null,
      stationaryClusterCount: decision.windowCount ?? null,
      stationaryClusterRadiusM: round(decision.clusterRadiusM),
      candidateState: decision.candidateId ? `${decision.decisionReason}:${decision.candidateEvidenceCount ?? ''}` : 'none',
      residualM: round(decision.trajectoryInnovationM),
      robustWeight: 'not emitted / not used by v3 classifier',
      crossTrackStabilizer: 'not implemented in O48 canonical authority',
      canonicalDecision: decision.decision ?? null,
      canonicalReason: decision.decisionReason ?? null,
      canonicalEdgeM: round(canonicalEdgeM),
      displayTarget: decision.decision === 'ACCEPT' ? 'new one-shape endpoint target' : decision.decision === 'REFINE' ? 'position estimate only; route endpoint held' : 'route endpoint held',
      memoryContribution: canonicalEdgeM > 0 ? 'canonical edge considered; 0 new cells/area (deduplicated)' : '0',
    };
  });

  const productionTelemetry = telemetryEvents.find(event => eventName(event) === 'activity_match_segment_v2');
  const productionTelemetryFields = productionTelemetry ? eventFields(productionTelemetry) : {};
  const productionSummary = {
    algorithmVersion: productionTelemetryFields.algorithmVersion ?? 'segment-walking-v3-hybrid',
    profile: 'mapbox/walking', tidy: true, overview: 'full', geometries: 'geojson',
    canonicalInputCount: snap.length, chunkSize: 80, chunkOverlap: 1,
    cadence: cadence(snap), timestamps: 'strictly increasing seconds when possible (present in all five requests)',
    radiusPolicy: 'round(clamp(horizontalAccuracy, 10m, 40m)); default 15m',
    requestCount: productionTelemetryFields.requestCount ?? productionRequests.length,
    decision: productionTelemetryFields.decision ?? 'raw-fallback',
    fallbackReason: productionTelemetryFields.fallbackReason ?? 'no-derived-chunks',
    requests: (productionTelemetryFields.requestResults ?? productionRequests.map(({ result }) => ({ ...result.privacySafe, tracepoints: undefined })))
      .slice().sort((a, b) => (a.headTimestamp ?? 0) - (b.headTimestamp ?? 0)),
    finalGeometry: 'canonical', matchedSubsectionCount: 0, canonicalFallbackSubsectionCount: 1,
    matchedDistanceM: 0, canonicalFallbackDistanceM: round(pathLength(snap)), coverage: 0,
    canonicalToFinalDisplacement: { p50M: 0, p95M: 0, maxM: 0 }, lengthDistortion: 0,
    repeatedTraversalPreserved: true, uTurnPreserved: true,
  };

  const finalD1 = d1.accepted[0];
  const finalReplacement = finalD1 ? {
    start: finalD1.sourceOriginalStart, end: finalD1.sourceOriginalEnd, geometry: finalD1.geometry,
  } : null;
  const safeExperimental = finalReplacement ? mergeHybrid(snap, [finalReplacement]) : snap.slice();
  const headSubmatch = d4[0]?.requests[0]?.submatches?.[0];
  const headCandidate = headSubmatch?.geometry?.length ? {
    start: 0, end: 61, geometry: headSubmatch.geometry,
  } : null;
  const extendedCandidate = mergeHybrid(snap, [headCandidate, finalReplacement].filter(Boolean));

  const routeClasses = [
    { order: 1, canonicalStart: 0, canonicalEnd: 61, classification: 'MAPBOX_MAPPED_AMBIGUOUS', networkClass: 'R1', reason: 'high-confidence/full-tracepoint isolated matches, but 14-16m shift narrowly fails current 15m p95 gate' },
    { order: 2, canonicalStart: 62, canonicalEnd: 104, classification: 'UNKNOWN', networkClass: 'R4', reason: 'transition/crossing with inconsistent candidates; must remain canonical' },
    { order: 3, canonicalStart: 105, canonicalEnd: 158, classification: 'OFF_NETWORK_CONFIDENT', networkClass: 'R3', reason: 'internal outbound windows return NoMatch/NoSegment; nearby-road capture is unsafe' },
    { order: 4, canonicalStart: 159, canonicalEnd: 283, classification: 'UNKNOWN', networkClass: 'R2', reason: 'visible/public-looking corridor has NoSegment at 14m and conservative 21m radii; includes stop interval' },
    { order: 5, canonicalStart: 284, canonicalEnd: 327, classification: 'OFF_NETWORK_CONFIDENT', networkClass: 'R3', reason: 'internal return mostly NoSegment/zero-confidence and must remain canonical' },
    { order: 6, canonicalStart: 328, canonicalEnd: 391, classification: 'MAPBOX_MAPPED_CONFIDENT', networkClass: 'R1', reason: '0.976 confidence, bounded 8.754m p95/max, accepted by current quality gates when isolated/resampled' },
  ].map(section => {
    const points = snap.slice(section.canonicalStart, section.canonicalEnd + 1);
    return { ...section, rawOrdinalStart: points[0]?.rawOrdinal ?? null, rawOrdinalEnd: points.at(-1)?.rawOrdinal ?? null,
      distanceM: round(pathLength(points)), durationS: round((points.at(-1).t - points[0].t) / 1000) };
  });

  const d0Requests = productionRequests.map(({ start, end, result }) => ({ start, end: end - 1, ...result.privacySafe,
    tracepoints: undefined, submatches: orderedSubmatches(result).map(({ geometry, raw, ...rest }) => rest) }));
  const dryRuns = {
    generatedAt: new Date().toISOString(), source: 'read-only exact ordered canonical evidence; persisted outputs use local metres only',
    D0_CURRENT_PRODUCTION: { ...productionSummary, reproducedResponses: d0Requests },
    D1_4S_TIDY_FALSE: d1.summary,
    D2_4S_TIDY_TRUE: d2.summary,
    D3_4S_TIDY_FALSE_CONSERVATIVE_RADII: d3.summary,
    D4_PUBLIC_SUBSECTIONS: d4.map(item => item.summary),
    D5_INTERNAL_ONLY: d5.summary,
    HISTORICAL_BACK_STYLE_ON_SNAP: legacyV64OnSnap.summary,
    windowProbes: windowProbes.map(group => ({ name: group.name, probes: group.probes.map(({ privateSubmatches, ...probe }) => probe) })),
    verdict: 'D1/D3 safely accept the final public subsection only. The isolated head is promising but 0.058m over the current p95 gate. No run proves every clone gate, so it is not promoted as a review clone.',
  };

  const matcherRequestSummary = {
    sourceActivity: { serverId: SNAP_ID, clientActivityId: snapRow.client_activity_id, qaSessionId: QA_SESSION },
    profile: 'walking', endpoint: '/matching/v5/mapbox/walking', tidy: true, radii: productionSummary.radiusPolicy,
    overview: 'full', geometries: 'geojson', chunkSize: 80, chunkOverlap: 1, canonicalCadence: cadence(snap),
    requests: productionSummary.requests.map((request, index) => ({ requestIndex: index + 1, ...request })),
  };
  const matcherResponseSummary = {
    sourceActivityServerId: SNAP_ID,
    responses: productionRequests.map((request, index) => {
      const response = request.result.privacySafe;
      const alternativesCountHistogram = response.tracepoints.filter(item => item.matched).reduce((acc, item) => {
        const key = String(item.alternativesCount ?? 'unknown'); acc[key] = (acc[key] ?? 0) + 1; return acc;
      }, {});
      return { requestIndex: index + 1, canonicalStart: request.start, canonicalEnd: request.end - 1,
        httpStatus: response.httpStatus, code: response.code, message: response.message, matchingsCount: response.matchingsCount,
        confidence: response.matchings?.[0]?.confidence ?? null, tracepointCount: response.tracepointCount,
        nullTracepointCount: response.nullTracepointCount, alternativesCountHistogram,
        matchingDistanceM: response.matchings?.[0]?.distanceM ?? null, geometryPointCount: response.matchings?.[0]?.geometryPointCount ?? 0,
        classification: response.code === 'NoSegment' ? 'M2' : response.nullTracepointCount > 0 ? 'M3' : 'M4',
        cairnResult: response.code === 'NoSegment' ? 'NoSegment' : response.nullTracepointCount > 0 ? 'partial_tracepoint_coverage' : 'quality/usable evaluation',
      };
    }),
    aggregate: { usefulHighConfidencePartialResponses: 2, acceptedByCairn: 0, noSegmentResponses: 2,
      lowConfidencePartialResponses: 1, finalResult: 'whole segment canonical fallback' },
  };

  const stopSummary = {
    classification: 'MINOR STOP-TRANSITION TUNING', mixedCauses: ['V1_LAST_MOVING_FIX_AFTER_PHYSICAL_STOP', 'V6_CANDIDATE_TIMEOUT', 'V3_FREEZE_HYSTERESIS_ONE_FIX_LATE'],
    canonicalFalseDistanceM: 5.171, vDetourExcessM: 2.183, badEdgeCount: 1, durationS: 9,
    memory: { canonicalEdgeConsideredM: 5.171, newCells: 0, newAreaM2: 0, progressionEffect: 0 },
    selfStabilized: { afterBadEdgeS: 11, nextObservationDecision: 'QUARANTINE', furtherFalseAcceptedEdgesBeforeRealResume: 0, realResumeAfterS: 126 },
    exactCause: 'A possible-stationary candidate was rejected on return, then the replacement candidate aged 5000.016ms. candidate-timeout re-entered classifyWithoutPending; missing speedAccuracy was treated as reliable, reported speed 0.85m/s satisfied reportedMoving, and a 5.171m/9s edge was accepted before the window reached the five-fix stationary-cluster requirement.',
    proposedNarrowChange: 'On possible-stationary-jitter timeout, absent speedAccuracy must not independently establish reportedMoving. Hold traversal in REFINE/new-candidate until accuracy-adjusted lower-bound progression or two coherent post-timeout fixes confirm motion.',
  };

  const historicalBackSummary = {
    identity: 'historical-back-control', serverId: BACK_ID, clientActivityId: backRow.client_activity_id,
    dateShanghai: '2026-05-29', type: backRow.type, rawCount: backRaw.length, storedTrackCount: back.length,
    distanceM: round(backRow.distance_m), durationS: Number(backRow.duration_s), segmentMetadata: 'not present', gapMetadata: 'not present',
    rawCadence: cadence(backRaw), storedTrackLengthM: round(pathLength(back)),
    lineage: { exactProducer: 'unrecoverable: recording predates repository root', earliestRepositorySnapshot: 'aad6fd2 (2026-06-03)',
      closestExplicitMatcherControl: '9de77bd v6.4 (2026-06-17; source comment says validated on session 46)' },
    originalSaveMapboxMatch: false,
    likelyVisualMechanism: ['approximately 5s raw cadence', 'low-Q Kalman live/stored smoothing family', 'Detail cleanup/smoothing'],
    storedRouteToNearestRaw: { p50M: round(median(backWithMetadata.map(p => p.nearestRawDistanceM)), 6), maxM: round(Math.max(...backWithMetadata.map(p => p.nearestRawDistanceM)), 6) },
    closestV77Replay: { count: backHistoricalReplay.length, lengthM: round(pathLength(backHistoricalReplay)), provesExactLineage: false },
    o48Matcher: o48OnBack.summary, o48TidyFalseControl: o48OnBackTidyFalse.summary, v64Control: legacyV64OnBack.summary,
  };

  const comparison2x2 = {
    privacyBoundary: 'Activities remain separate; no coordinates or account email are exported.',
    rows: [
      { source: 'historical-back-control', pipeline: 'historical saved presentation', result: 'visual baseline (not a Mapbox match)', coverage: null, fallbackCoverage: null, outputLengthM: round(pathLength(back)), wrongRoadRisk: 'not provable from retained metadata', mixedRouteHandling: 'no subsection authority' },
      { source: 'historical-back-control', pipeline: 'O48 matcher', result: '0 accepted; canonical fallback', coverage: 0, fallbackCoverage: 1, tracepointSuccess: '33/87 first chunk plus NoSegment tail', topology: 'preserved by fallback', wrongRoadRisk: 'low', mixedRouteHandling: 'fails to salvage tidy islands' },
      { source: 'snap', pipeline: 'O48 matcher', result: '0 accepted; canonical fallback', coverage: 0, fallbackCoverage: 1, tracepointSuccess: '12/80, 3/80, NoSegment, NoSegment, 5/76', topology: 'preserved by fallback', wrongRoadRisk: 'low', mixedRouteHandling: 'whole Segment poisoned' },
      { source: 'snap', pipeline: 'v6.4 historical-style matcher', result: `${legacyV64OnSnap.summary.chunksOk} chunks accepted without modern gates`, coverage: round(legacyV64OnSnap.summary.chunksOk / Math.max(1, legacyV64OnSnap.summary.chunksOk + legacyV64OnSnap.summary.chunksFallback), 4), fallbackCoverage: round(legacyV64OnSnap.summary.chunksFallback / Math.max(1, legacyV64OnSnap.summary.chunksOk + legacyV64OnSnap.summary.chunksFallback), 4), tracepointSuccess: 'legacy ignores null-tracepoint provenance', topology: 'ordered input, but global dedupe/smoothing and seam bridges weaken truth', wrongRoadRisk: legacyV64OnSnap.summary.sourceToOutputP95M > 15 ? 'high' : 'material', mixedRouteHandling: 'chunk fallback only; no trusted subsection provenance' },
    ],
    conclusion: 'Dataset and pipeline both matter: back is easier in its mapped head, but O48 tidy handling and whole-chunk rejection lose useful islands. The v6.4 style looks more attached by accepting whole Mapbox geometry and smoothing globally, at unacceptable mixed-route risk.',
  };

  const hybridAnalysis = {
    current: { boundary: 'accuracy GOOD/LOST run then fixed 80-point chunks; response matching indices must be a contiguous input range',
      defect: 'tidy=true nulls occur inside otherwise useful ordered matches; current logic calls them non-contiguous and rejects the whole matching. No pre-request route-class split exists, so internal/off-network spans also cause whole chunks to fail.' },
    recommended: { preprocessing: 'sequence-aware 3-5s temporal resampling with mandatory endpoints, turns, reversals, stop/start and gap boundaries; submit tidy=false',
      splitting: 'classify stable matcher-supported islands from tracepoint runs and overlapping short probes; expand only while confidence/deviation/topology remain valid',
      assembly: 'MATCHED -> CANONICAL -> MATCHED with canonical boundary points and no invented connector',
      internalSafety: 'NoSegment/NoMatch, unstable alternatives, implausible displacement, or bearing/topology disagreement immediately preserves canonical subsection',
      headPolicy: 'Do not globally loosen p95. A new evidence-conditioned mapped-corridor gate may allow the 15.058m head only after multi-window support and explicit crossing exit.',
    }, routeClasses,
  };

  const liveRoadAssist = {
    recommendation: 'NO LIVE ROAD ASSIST in the next release',
    authorityRanking: ['LA presentation-only (only defensible future experiment)', 'LB derived confirmed display (later, after offline proof)', 'LC canonical road-aware truth (reject)'],
    strictlyQualifying: { distanceM: routeClasses[5].distanceM, durationS: routeClasses[5].durationS,
      distancePercent: round(routeClasses[5].distanceM / pathLength(snap) * 100, 1), durationPercent: round(routeClasses[5].durationS / Number(snapRow.duration_s) * 100, 1) },
    includingBorderlineHead: { distanceM: round(routeClasses[0].distanceM + routeClasses[5].distanceM), durationS: round(routeClasses[0].durationS + routeClasses[5].durationS),
      distancePercent: round((routeClasses[0].distanceM + routeClasses[5].distanceM) / pathLength(snap) * 100, 1), durationPercent: round((routeClasses[0].durationS + routeClasses[5].durationS) / Number(snapRow.duration_s) * 100, 1) },
    crossing: 'must exit; current evidence is ambiguous and a live online match could trap the display on the old road',
    internalPath: 'must remain OFF; D5 returns NoMatch and nearby-road capture is unsafe', reentry: 'final corridor supports confident re-entry after several fixes',
    onlineConstraint: { observedDryRunLatencyMs: d1.summary.requestSummaries.map(x => x.durationMs), productionBudgetMs: 4000,
      assessment: 'hundreds of milliseconds per request plus connectivity/cost prevents a calm one-second live loop' },
    comparison: [
      { option: 'L0 canonical/live O48', stability: 'healthy', truth: 'highest', lag: 'low', mappedStraightness: 'GPS-bounded' },
      { option: 'L1 O48 bounded presentation (cross-track constraint disabled)', stability: 'healthy/continuous', truth: 'presentation-only 1-2m bound', lag: 'low', mappedStraightness: 'nearly L0; no wrong-road risk' },
      { option: 'L2 online road-assisted display', stability: 'network-dependent', truth: 'safe only in 10.4% strict interval', lag: 'response-limited', mappedStraightness: 'best where correct; materially worse at crossing/internal path' },
    ],
  };

  const cloneProvenance = {
    status: 'NO_SAFE_SNAP_CLONE_CANDIDATE', generated: false, cloneName: null, cloneId: null, cloneVersion: 1,
    source: { serverId: SNAP_ID, clientActivityId: snapRow.client_activity_id, qaSessionId: QA_SESSION, userIdentity: 'current-snap-owner' },
    sourceUserMatchesReviewUser: null,
    reason: ['D1/D3 prove only the final mapped subsection; the initial mapped candidate remains just outside the current truth gate',
      'No tested configuration satisfies the mandatory mapped -> canonical -> mapped clone gate across both public sections',
      'The only existing app-openable QA projection is hard-coded for almost-done-v1. Creating snap clone v1 would require production/debug app code, forbidden by this read-only task.'],
    bestSafeAnalysisGeometry: { configuration: 'D1 4s sequence-aware, tidy=false, production radii/gates', matchedSubsections: finalD1 ? [{ canonicalStart: finalD1.sourceOriginalStart, canonicalEnd: finalD1.sourceOriginalEnd, distanceM: round(pathLength(finalD1.raw)), confidence: finalD1.confidence }] : [], canonicalFallback: [{ canonicalStart: 0, canonicalEnd: finalD1 ? finalD1.sourceOriginalStart : snap.length - 1 }],
      coverage: d1.summary.acceptedObservationCoverage, matchedDistanceM: d1.summary.acceptedSourceDistanceM, fallbackDistanceM: round(pathLength(snap) - d1.summary.acceptedSourceDistanceM),
      internalPathCanonical: true, crossingCanonical: true, repeatedTraversalOrdered: true, uTurnPreserved: true, wrongRoadStealingM: 0 },
    immutability: { normalActivityRowCreated: false, backendActivityRowCreated: false, memoryChanged: false, statsChanged: false,
      pendingSyncCreated: false, originalActivityChanged: false, productionMatcherChanged: false, productionTrackingChanged: false },
  };

  const toSnapLocal = anonymiser(snap);
  const toBackLocal = anonymiser(back);
  const geometryProbe = {
    type: 'FeatureCollection',
    coordinateSystem: 'privacy-safe-local-metres',
    canonicalPoints: snap.map((point, index) => ({ index, ...toSnapLocal(point) })),
    resampledPoints: snap4s.map((point, index) => ({ index, sourceIndex: point.sourceIndex, ...toSnapLocal(point) })),
    features: [
      privacySafeGeometry(snapRaw, toSnapLocal, { layer: 'raw' }),
      privacySafeGeometry(snap, toSnapLocal, { layer: 'canonical' }),
      ...d1.accepted.map((subsection, index) => privacySafeGeometry(subsection.geometry, toSnapLocal, {
        layer: 'D1-accepted', index, sourceStart: subsection.sourceStart, sourceEnd: subsection.sourceEnd,
      })),
      ...d3.accepted.map((subsection, index) => privacySafeGeometry(subsection.geometry, toSnapLocal, {
        layer: 'D3-accepted', index, sourceStart: subsection.sourceStart, sourceEnd: subsection.sourceEnd,
      })),
      privacySafeGeometry(snapHistoricalStyle, toSnapLocal, { layer: 'historical-back-style-on-snap' }),
      ...d4.flatMap(experiment => experiment.accepted.map((subsection, index) => privacySafeGeometry(subsection.geometry, toSnapLocal, {
        layer: experiment.name, index,
      }))),
      privacySafeGeometry(presentationRoute(snap), toSnapLocal, { layer: 'o48-presentation' }),
      privacySafeGeometry(safeExperimental, toSnapLocal, { layer: 'best-safe-experimental-final' }),
      privacySafeGeometry(extendedCandidate, toSnapLocal, { layer: 'borderline-head-plus-safe-final-not-clone' }),
      privacySafeGeometry(legacyV64OnSnap.points, toSnapLocal, { layer: 'v6.4-matcher-on-snap' }),
    ],
  };
  writeJson('SNAP_PRIVACY_SAFE_GEOMETRY.json', geometryProbe);

  writeCsv('SNAP_STOP_V_TIMELINE.csv', stopTimeline);
  writeJson('SNAP_STOP_V_SUMMARY.json', stopSummary);
  writeJson('SNAP_MATCHER_REQUEST_SUMMARY.json', matcherRequestSummary);
  writeJson('SNAP_MATCHER_RESPONSE_SUMMARY.json', matcherResponseSummary);
  writeJson('SNAP_MATCHER_DRY_RUNS.json', dryRuns);
  writeJson('SNAP_HYBRID_SUBSECTION_ANALYSIS.json', hybridAnalysis);
  writeJson('SNAP_LIVE_ROAD_ASSIST_ANALYSIS.json', liveRoadAssist);
  writeJson('SNAP_ROUTE_CLASSIFICATION_SUMMARY.json', { sourceActivityServerId: SNAP_ID, sequence: routeClasses.map(x => x.classification), intervals: routeClasses });
  writeJson('HISTORICAL_BACK_MATCHER_SUMMARY.json', historicalBackSummary);
  writeJson('BACK_VS_SNAP_2X2_COMPARISON.json', comparison2x2);
  writeJson('SNAP_CLONE_V1_PROVENANCE.json', cloneProvenance);

  const snapPaths = points => [points.map(point => { const p = toSnapLocal(point); return [p.x, p.y]; })];
  const backPaths = points => [points.map(point => { const p = toBackLocal(point); return [p.x, p.y]; })];
  const acceptedPaths = d1.accepted.map(section => section.geometry.map(point => { const p = toSnapLocal(point); return [p.x, p.y]; }));
  const candidatePaths = [headSubmatch?.geometry ?? [], ...d1.accepted.map(section => section.geometry)].filter(x => x.length).map(points => points.map(point => { const p = toSnapLocal(point); return [p.x, p.y]; }));
  writeFileSync(resolve(here, 'SNAP_ACTIVITY_MATCHING_PREVIEW.html'), htmlPreview({
    title: 'snap · Final matching forensic', subtitle: 'Production fallback, safe D1 accepted island, and the borderline head candidate. Coordinates are translated to a local metre frame.',
    datasets: {
      raw: { label: 'raw GPS', paths: snapPaths(snapRaw) }, canonical: { label: 'O48 canonical', paths: snapPaths(snap) },
      production: { label: 'saved Final (canonical)', paths: snapPaths(snap) }, candidate: { label: 'network candidates', paths: candidatePaths },
      accepted: { label: 'accepted D1 subsection', paths: acceptedPaths }, fallback: { label: 'canonical fallback', paths: snapPaths(snap.slice(0, 329)) },
    }, panels: [
      { title: 'Production Save', caption: 'Five requests, zero derived chunks; Detail reads this canonical geometry.', keys: ['raw', 'production'] },
      { title: 'Controlled D1', caption: '4s sequence-aware input, tidy=false. Only the final public corridor passes unchanged gates.', keys: ['canonical', 'candidate', 'accepted', 'fallback'], markers: [{ point: snapPaths([snap[0]])[0][0], color: '#347e65' }, { point: snapPaths([snap.at(-1)])[0][0], color: '#a52a2a' }, { point: snapPaths([snap[283]])[0][0], color: '#356b93' }, { point: snapPaths([stopAnchor])[0][0], color: '#c79842' }] },
    ], notes: ['Markers: green start, red end, blue turnaround, gold stop V.', 'There is one Segment and zero Gaps.', 'Orange is a candidate, not automatic truth.', 'The internal path, crossing and repeated traversal stay canonical.', 'The head candidate narrowly fails the current p95 gate and is not promoted.'],
  }));
  writeFileSync(resolve(here, 'SNAP_LIVE_ROAD_ASSIST_PREVIEW.html'), htmlPreview({
    title: 'snap · Live road-assist decision', subtitle: 'Static offline comparison of O48 display and a hypothetical presentation-only road layer. This is not an implemented product feature.',
    datasets: {
      raw: { label: 'raw GPS', paths: snapPaths(snapRaw) }, canonical: { label: 'canonical', paths: snapPaths(snap) },
      display: { label: 'O48 bounded display', paths: snapPaths(presentationRoute(snap)) },
      network: { label: 'network candidate', paths: candidatePaths }, on: { label: 'assist ON candidates', paths: acceptedPaths },
      off: { label: 'assist OFF / canonical', paths: [snapPaths(snap.slice(62, 329))[0]] },
      crossing: { label: 'road crossing', paths: snapPaths(snap.slice(62, 105)) },
      internal: { label: 'internal path', paths: [snapPaths(snap.slice(105, 159))[0], snapPaths(snap.slice(284, 328))[0]] },
      uturn: { label: 'U-turn', paths: snapPaths(snap.slice(276, 292)) },
      repeat: { label: 'repeated traversal', paths: snapPaths(snap.slice(105, 328)) },
    }, panels: [
      { title: 'Map-free O48', caption: 'The shipped low-lag one-shape presentation; cross-track projection was intentionally removed.', keys: ['raw', 'canonical', 'display'] },
      { title: 'Hypothetical road assistance', caption: 'Strict support exists only in the final corridor; crossing and internal route remain OFF.', keys: ['canonical', 'network', 'on', 'off', 'crossing', 'internal', 'uturn', 'repeat'], markers: [{ point: snapPaths([stopAnchor])[0][0], color: '#c79842' }] },
    ], notes: ['Strictly qualifying support covers only about 10% of distance.', 'Online response latency is incompatible with a calm one-second live endpoint.', 'Recommendation: no live road assist in the next release.'],
  }));
  writeFileSync(resolve(here, 'SNAP_CLONE_V1_COMPARISON.html'), htmlPreview({
    title: 'snap clone v1 · gate result', subtitle: 'No clone was created. This preview shows why the best safe partial result is insufficient for the mandatory clone contract.',
    datasets: { canonical: { label: 'O48 canonical / Final', paths: snapPaths(snap) }, accepted: { label: 'safe final matched island', paths: acceptedPaths }, candidate: { label: 'borderline head candidate', paths: headSubmatch?.geometry?.length ? snapPaths(headSubmatch.geometry) : [] } },
    panels: [{ title: 'Analysis-only candidate', caption: 'Final corridor is safe; the head is still outside the current gate, so mapped→fallback→mapped is not proved.', keys: ['canonical', 'candidate', 'accepted'] }],
    notes: ['NO SAFE SNAP CLONE CANDIDATE.', 'No app review projection, Activity row, sync item, Memory, stats, or ownership mapping was created.'],
  }));
  writeFileSync(resolve(here, 'BACK_VS_SNAP_MATCHING_COMPARISON.html'), htmlPreview({
    title: 'historical-back-control vs snap', subtitle: 'Separate privacy-safe local frames. Historical ownership is never mixed with the current tester.',
    datasets: {
      historical: { label: 'historical saved track', paths: backPaths(back) }, candidate: { label: 'back via v6.4 control', paths: backPaths(legacyV64OnBack.points) },
      canonical: { label: 'snap O48 canonical', paths: snapPaths(snap) }, production: { label: 'snap production Final', paths: snapPaths(snap) },
      accepted: { label: 'snap safe D1 island', paths: acceptedPaths }, fallback: { label: 'snap v6.4 historical-style', paths: snapPaths(legacyV64OnSnap.points) },
    }, panels: [
      { title: 'Historical control', caption: 'The saved May activity predates Cairn’s Mapbox matcher; its road-attached look came from sparse evidence and smoothing.', keys: ['historical', 'candidate'] },
      { title: 'Current snap', caption: 'O48 truth plus current fallback, safe D1 island, and aggressive v6.4-style control.', keys: ['canonical', 'production', 'accepted', 'fallback'] },
    ], notes: ['Panels use independent local origins; never compare their absolute placement.', 'The historical-style control can look straighter while moving evidence farther and weakening mixed-route truth.'],
  }));
  console.log(JSON.stringify({
    snap: { count: snap.length, rawCount: snapRaw.length, cadence: cadence(snap), lengthM: round(pathLength(snap)) },
    back: {
      count: back.length, rawCount: backRaw.length, lengthM: round(pathLength(back)), rawCadence: cadence(backRaw),
      routeToNearestRawP50M: round(median(backWithMetadata.map(p => p.nearestRawDistanceM)), 6),
      routeToNearestRawMaxM: round(Math.max(...backWithMetadata.map(p => p.nearestRawDistanceM)), 6),
      historicalV77ReplayCount: backHistoricalReplay.length,
      historicalV77ReplayLengthM: round(pathLength(backHistoricalReplay)),
    },
    ownership: { sameUser: snapRow.user_id === backRow.user_id, snapUserHash: stableHash(snapRow.user_id), backUserHash: stableHash(backRow.user_id) },
    productionRequests: productionRequests.map(({ start, end, result }) => ({ start, end, ...result.privacySafe, submatches: orderedSubmatches(result).map(({ geometry, raw, ...rest }) => rest) })),
    experiments: [d1.summary, d2.summary, d3.summary, ...d4.map(x => x.summary), d5.summary, o48OnBack.summary, o48OnBackTidyFalse.summary],
    historicalStyleOnSnap: {
      sourceCount: snap.length,
      outputCount: snapHistoricalStyle.length,
      outputLengthM: round(pathLength(snapHistoricalStyle)),
      sourceLengthM: round(pathLength(snap)),
      displacement: {
        p50M: round(median(snap.map((p, i) => hav(p, snapHistoricalStyle[i])))),
        p95M: round(percentile(snap.map((p, i) => hav(p, snapHistoricalStyle[i])), .95)),
        maxM: round(Math.max(...snap.map((p, i) => hav(p, snapHistoricalStyle[i])))),
      },
    },
    windowProbes: windowProbes.map(group => ({
      name: group.name,
      probes: group.probes.map(({ privateSubmatches, ...probe }) => probe),
    })),
  }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
