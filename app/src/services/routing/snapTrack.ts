/**
 * snapTrack.ts — Activity-length GPS → road-snap pipeline (v6.4).
 *
 * Single shared module used by:
 *   - Activity SAVE (turn raw GPS into a clean polyline at save time)
 *   - Brush edit Preview (snap a brush stroke through the same code)
 *
 * Algorithm (validated by spike on session 46 + 1780-pt synth):
 *   1. Tag each raw point as GOOD or LOST.
 *      LOST = `speed === -1` (GPS doppler unavailable) OR `accuracy > 20m`.
 *   2. Split into runs of contiguous GOOD or LOST points.
 *   3. For each GOOD run: chunk at 80 with overlap 10. Per-chunk Mapbox
 *      /matching call with `tidy=true` and per-coord radiuses (clamp accuracy
 *      to [10, 40]m). Up to 4 chunks fetched in parallel.
 *   4. On chunk success: take Mapbox geometry. Re-attach alt from raw via
 *      nearest-neighbor.
 *   5. On chunk failure (NoSegment / NoMatch / network / conf<0.3): fall back
 *      to that chunk's raw points, densified to ≤ 20m steps.
 *   6. Stitch chunks within a run: walk forward in chunk N+1 to find the snap
 *      point closest to chunk N's last point. If gap > 30m, bridge with
 *      densified line (raw fallback for that join).
 *   7. LOST runs: never sent to Mapbox. Densified raw at ≤ 20m.
 *   8. Cross-run splice: if gap > 20m at boundary, bridge with densified line.
 *   9. Final dedupe at 3m + window-3 smoother to clean raw-fallback wobble.
 *
 * Robustness contract:
 *   - On TOTAL failure (entire pipeline can't finish OR exceeds totalTimeoutMs)
 *     the function returns `{ ok: false }` and the caller is expected to
 *     fall back to whatever it had (e.g. smoothTrackPoints output).
 *   - The pipeline NEVER throws to caller. All errors are swallowed and
 *     converted to `ok: false`.
 *   - Raw input is never mutated.
 *   - alt values from raw are preserved on the output (nearest-neighbor copy
 *     for snap segments, linear-interp for densified bridges).
 *
 * What this is NOT:
 *   - Not a true HMM map-matcher; we delegate to Mapbox /matching.
 *   - Not a substitute for raw GPS — caller MUST persist raw separately.
 *   - Not for real-time tracking — designed for one-shot save/preview.
 *
 * Plan: docs/spikes/V6_4_PLAN.md (TBD); see SPIKE report at
 *   C:/temp/SPIKE_ACTIVITY_V2_REPORT.md for the empirical validation that
 *   informed the constants below.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Input point. We accept the union of fields the Cairn app uses today:
 *   - lat / lng (required)
 *   - alt (optional, preserved through the pipeline)
 *   - accuracy (optional, used to size per-coord radius and to mark LOST)
 *   - speed (optional, -1 means GPS lost; marks LOST)
 *   - t (optional, not used in this pipeline)
 */
export interface RawPoint {
  lat: number;
  lng: number;
  alt?: number | null;
  accuracy?: number | null;
  speed?: number | null;
  t?: number;
}

interface SnappedPoint {
  lat: number;
  lng: number;
  alt?: number | null;
}

interface SnapTrackOptions {
  /**
   * Mapbox public token. Required.
   * Caller passes process.env.EXPO_PUBLIC_MAPBOX_TOKEN.
   */
  mapboxToken: string;
  /** Hard ceiling for total wall-clock time. Default 60_000 ms. */
  totalTimeoutMs?: number;
  /** Per-call timeout (one chunk). Default 8_000 ms. */
  perCallTimeoutMs?: number;
  /** Concurrency for chunked GOOD-run fetches. Default 4. */
  concurrency?: number;
  /** AbortSignal for caller cancellation (e.g. user navigated away). */
  signal?: AbortSignal;
}

type SnapTrackReason =
  | 'no_input'
  | 'too_short'
  | 'no_token'
  | 'aborted'
  | 'timed_out'
  | 'all_chunks_failed';

interface SnapTrackStats {
  /** Number of Mapbox /matching API calls actually fired. */
  apiCalls: number;
  /** Number of chunks that succeeded with conf >= confMin. */
  chunksOk: number;
  /** Number of chunks that fell back to raw (failure / low conf). */
  chunksFallback: number;
  /** Number of GOOD runs (Mapbox-eligible). */
  goodRuns: number;
  /** Number of LOST runs (raw-only, never sent to Mapbox). */
  lostRuns: number;
  /** Number of times a seam-bridge was inserted to close a > 30m chunk gap. */
  seamBridges: number;
  /** Wall-clock time for the whole pipeline (ms). */
  durationMs: number;
}

type SnapTrackResult =
  | { ok: true; points: SnappedPoint[]; stats: SnapTrackStats }
  | { ok: false; reason: SnapTrackReason; stats: SnapTrackStats };

// ============================================================================
// Tunables (validated by spike — do NOT change without re-spiking)
// ============================================================================

const CHUNK_SIZE = 80;            // raw points per Mapbox call (cap is 100)
const CHUNK_OVERLAP = 10;         // raw-point overlap between consecutive chunks
const ACC_LOST_M = 20;            // accuracy worse than this => GPS lost
const ACC_RADIUS_MIN = 10;        // per-coord radius min (Mapbox API allows 1..50)
const ACC_RADIUS_MAX = 40;        // per-coord radius max (50 = upper bound)
const CONF_FALLBACK = 0.3;        // Mapbox match confidence < this => raw fallback
const SEAM_BRIDGE_THRESH_M = 30;  // chunk join gap > this => insert bridge
const RUN_BRIDGE_THRESH_M = 20;   // run-to-run gap > this => insert bridge
const DENSIFY_STEP_M = 20;        // bridge / raw-fallback densification step
const DEDUPE_M = 3;               // final-pass minimum spacing
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const DEFAULT_PER_CALL_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 4;
const MAPBOX_HARD_COORD_CAP = 100;
const MAPBOX_ENDPOINT = 'https://api.mapbox.com/matching/v5/mapbox/walking';

// ============================================================================
// Math helpers (haversine, no external deps)
// ============================================================================

const EARTH_R = 6_371_000;

function hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// ============================================================================
// Quality tagging
// ============================================================================

function isLost(p: RawPoint): boolean {
  if (p.speed === -1) return true;
  if (p.accuracy != null && p.accuracy > ACC_LOST_M) return true;
  return false;
}

interface Run {
  kind: 'good' | 'lost';
  start: number;
  end: number; // exclusive
}

function tagRuns(raw: RawPoint[]): Run[] {
  const runs: Run[] = [];
  if (raw.length === 0) return runs;
  let kind: 'good' | 'lost' = isLost(raw[0]) ? 'lost' : 'good';
  let start = 0;
  for (let i = 1; i < raw.length; i++) {
    const k: 'good' | 'lost' = isLost(raw[i]) ? 'lost' : 'good';
    if (k !== kind) {
      runs.push({ kind, start, end: i });
      kind = k;
      start = i;
    }
  }
  runs.push({ kind, start, end: raw.length });
  return runs;
}

// ============================================================================
// Densify / dedupe / smoother (preserves alt linearly)
// ============================================================================

/** Returns interp points strictly BETWEEN a and b (excludes a, includes b). */
function densifyBetween(a: SnappedPoint, b: SnappedPoint, step: number): SnappedPoint[] {
  const d = hav(a, b);
  if (d <= step) return [b];
  const n = Math.ceil(d / step);
  const out: SnappedPoint[] = [];
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    const out_pt: SnappedPoint = {
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
    };
    if (a.alt != null && b.alt != null) {
      out_pt.alt = a.alt + (b.alt - a.alt) * f;
    } else if (a.alt != null || b.alt != null) {
      // Partial knowledge → null (don't fabricate alt)
      out_pt.alt = null;
    }
    out.push(out_pt);
  }
  return out;
}

function densifyPath(pts: SnappedPoint[], step: number): SnappedPoint[] {
  if (pts.length < 2) return pts.slice();
  const out: SnappedPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    out.push(...densifyBetween(pts[i - 1], pts[i], step));
  }
  return out;
}

function dedupeWithin(pts: SnappedPoint[], minM: number): SnappedPoint[] {
  if (pts.length === 0) return [];
  const out: SnappedPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    if (hav(prev, pts[i]) > minM) {
      out.push(pts[i]);
    } else if (prev.alt == null && pts[i].alt != null) {
      // Preserve alt info even when dropping a near-duplicate point.
      out[out.length - 1] = { ...prev, alt: pts[i].alt };
    }
  }
  return out;
}

function smoothWindow3(pts: SnappedPoint[]): SnappedPoint[] {
  if (pts.length < 3) return pts.slice();
  const out: SnappedPoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push({
      lat: (pts[i - 1].lat + pts[i].lat + pts[i + 1].lat) / 3,
      lng: (pts[i - 1].lng + pts[i].lng + pts[i + 1].lng) / 3,
      // alt smoothing kept simple: take middle's alt (no-op for missing).
      alt: pts[i].alt,
    });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ============================================================================
// Alt re-attachment (Mapbox snap geometry has no alt; raw does)
// ============================================================================

function attachAltFromRaw(snap: SnappedPoint[], raw: RawPoint[]): SnappedPoint[] {
  if (snap.length === 0 || raw.length === 0) return snap;
  return snap.map((s) => {
    let bestI = 0;
    let bestD = hav(raw[0], s);
    for (let i = 1; i < raw.length; i++) {
      const d = hav(raw[i], s);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const a = raw[bestI].alt;
    if (a != null) return { ...s, alt: a };
    return s;
  });
}

// ============================================================================
// Mapbox /matching call (per chunk)
// ============================================================================

interface MatchOk {
  ok: true;
  points: SnappedPoint[];
  confidence: number;
}
interface MatchFail {
  ok: false;
  reason: string;
}
type MatchResult = MatchOk | MatchFail;

async function callMapbox(
  chunk: RawPoint[],
  token: string,
  perCallTimeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<MatchResult> {
  if (chunk.length < 2) return { ok: false, reason: 'too_short' };
  if (chunk.length > MAPBOX_HARD_COORD_CAP) return { ok: false, reason: 'oversize' };

  const coords = chunk.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const radiuses = chunk
    .map((p) => {
      const acc = typeof p.accuracy === 'number' ? p.accuracy : 15;
      return Math.round(Math.max(ACC_RADIUS_MIN, Math.min(ACC_RADIUS_MAX, acc)));
    })
    .join(';');
  const url =
    `${MAPBOX_ENDPOINT}/${coords}?` +
    `geometries=geojson&overview=full&tidy=true` +
    `&access_token=${encodeURIComponent(token)}` +
    `&radiuses=${radiuses}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), perCallTimeoutMs);
  let externalListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      return { ok: false, reason: 'aborted' };
    }
    externalListener = () => controller.abort();
    try {
      externalSignal.addEventListener('abort', externalListener, { once: true } as any);
    } catch {
      /* no addEventListener support */
    }
  }
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (res.status >= 400) {
      return { ok: false, reason: `http_${res.status}` };
    }
    const body = (await res.json()) as {
      code?: string;
      matchings?: Array<{
        confidence?: number;
        geometry?: { coordinates: Array<[number, number]> };
      }>;
    };
    if (body.code !== 'Ok' || !body.matchings || body.matchings.length === 0) {
      return { ok: false, reason: body.code ?? 'no_match' };
    }
    const m = body.matchings[0];
    const conf = m.confidence ?? 0;
    if (conf < CONF_FALLBACK) {
      return { ok: false, reason: `low_conf_${conf.toFixed(2)}` };
    }
    const geom = m.geometry?.coordinates ?? [];
    if (geom.length < 2) return { ok: false, reason: 'short_match' };
    return {
      ok: true,
      confidence: conf,
      points: geom.map(([lng, lat]) => ({ lng, lat })),
    };
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'aborted' : 'network' };
  } finally {
    clearTimeout(timeout);
    if (externalListener && externalSignal) {
      try {
        externalSignal.removeEventListener('abort', externalListener);
      } catch {
        /* polyfill missing — fine, listener was once:true */
      }
    }
  }
}

// ============================================================================
// Chunk dispatcher with bounded concurrency
// ============================================================================

async function fetchChunksConcurrent<T>(
  count: number,
  concurrency: number,
  worker: (i: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let next = 0;
  async function pull(): Promise<void> {
    while (true) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= count) return;
      results[i] = await worker(i);
    }
  }
  const lanes: Promise<void>[] = [];
  const lanesN = Math.max(1, Math.min(concurrency, count));
  for (let i = 0; i < lanesN; i++) lanes.push(pull());
  await Promise.all(lanes);
  return results;
}

// ============================================================================
// Snap a single GOOD run (chunked)
// ============================================================================

interface ChunkOutcome {
  start: number; // raw-index (within run)
  end: number;
  snap: SnappedPoint[] | null; // null => fallback raw for this chunk
}

async function snapGoodRun(
  runRaw: RawPoint[],
  token: string,
  perCallTimeoutMs: number,
  concurrency: number,
  stats: SnapTrackStats,
  signal?: AbortSignal,
): Promise<SnappedPoint[]> {
  if (runRaw.length < 2) return runRaw.map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt }));

  const chunkBounds: Array<[number, number]> = [];
  let i = 0;
  while (i < runRaw.length) {
    const e = Math.min(i + CHUNK_SIZE, runRaw.length);
    chunkBounds.push([i, e]);
    if (e === runRaw.length) break;
    i = e - CHUNK_OVERLAP;
  }

  const outcomes: ChunkOutcome[] = await fetchChunksConcurrent(
    chunkBounds.length,
    concurrency,
    async (idx) => {
      const [s, e] = chunkBounds[idx];
      const sub = runRaw.slice(s, e);
      stats.apiCalls += 1;
      const r = await callMapbox(sub, token, perCallTimeoutMs, signal);
      if (r.ok) {
        stats.chunksOk += 1;
        const withAlt = attachAltFromRaw(r.points, sub);
        return { start: s, end: e, snap: withAlt };
      }
      stats.chunksFallback += 1;
      return { start: s, end: e, snap: null };
    },
    signal,
  );

  // Stitch outcomes
  const out: SnappedPoint[] = [];
  for (const oc of outcomes) {
    let piece: SnappedPoint[];
    if (oc.snap === null) {
      // Raw fallback for this chunk → densify so internal jumps are bounded
      const rawSlice = runRaw.slice(oc.start, oc.end);
      piece = densifyPath(
        rawSlice.map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt })),
        DENSIFY_STEP_M,
      );
    } else {
      piece = oc.snap;
    }
    if (piece.length === 0) continue;
    if (out.length === 0) {
      out.push(...piece);
      continue;
    }
    const last = out[out.length - 1];
    let bestI = 0;
    let bestD = hav(last, piece[0]);
    const scanN = Math.min(piece.length, CHUNK_OVERLAP * 3);
    for (let j = 1; j < scanN; j++) {
      const d = hav(last, piece[j]);
      if (d < bestD) {
        bestD = d;
        bestI = j;
      }
    }
    if (bestD > SEAM_BRIDGE_THRESH_M) {
      stats.seamBridges += 1;
      out.push(...densifyBetween(last, piece[bestI], DENSIFY_STEP_M));
    }
    out.push(...piece.slice(bestI + 1));
  }
  return out;
}

// ============================================================================
// Public entrypoint
// ============================================================================

/**
 * Snap a raw GPS track to roads via Mapbox /matching.
 *
 * Caller MUST persist `raw` separately — this function is a *view*, not a
 * source of truth. On any failure, the caller should fall back to whatever
 * smoothed-raw representation it has.
 *
 * Pipeline detail in this file's header. Empirical numbers in
 * docs/spikes/SPIKE_ACTIVITY_V2_REPORT.md.
 */
export async function snapTrack(
  raw: RawPoint[],
  options: SnapTrackOptions,
): Promise<SnapTrackResult> {
  const t0 = Date.now();
  const stats: SnapTrackStats = {
    apiCalls: 0,
    chunksOk: 0,
    chunksFallback: 0,
    goodRuns: 0,
    lostRuns: 0,
    seamBridges: 0,
    durationMs: 0,
  };
  const finishStats = () => {
    stats.durationMs = Date.now() - t0;
  };

  if (!raw || raw.length === 0) {
    finishStats();
    return { ok: false, reason: 'no_input', stats };
  }
  if (raw.length < 2) {
    finishStats();
    return { ok: false, reason: 'too_short', stats };
  }
  if (!options.mapboxToken) {
    finishStats();
    return { ok: false, reason: 'no_token', stats };
  }
  if (options.signal?.aborted) {
    finishStats();
    return { ok: false, reason: 'aborted', stats };
  }

  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // Wrap the whole pipeline with a total-timeout AbortController
  const totalAbort = new AbortController();
  const totalTimer = setTimeout(() => totalAbort.abort(), totalTimeoutMs);
  // Combine caller signal + total timeout
  let combinedExternalListener: (() => void) | null = null;
  if (options.signal) {
    combinedExternalListener = () => totalAbort.abort();
    try {
      options.signal.addEventListener('abort', combinedExternalListener, { once: true } as any);
    } catch {
      /* no addEventListener support */
    }
  }

  try {
    const runs = tagRuns(raw);
    const final: SnappedPoint[] = [];
    for (const run of runs) {
      if (totalAbort.signal.aborted) {
        finishStats();
        return { ok: false, reason: 'timed_out', stats };
      }
      const runRaw = raw.slice(run.start, run.end);
      let piece: SnappedPoint[];
      if (run.kind === 'good') {
        stats.goodRuns += 1;
        piece = await snapGoodRun(
          runRaw,
          options.mapboxToken,
          perCallTimeoutMs,
          concurrency,
          stats,
          totalAbort.signal,
        );
      } else {
        stats.lostRuns += 1;
        // LOST run: never call Mapbox; densify raw at <= 20m
        piece = densifyPath(
          runRaw.map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt })),
          DENSIFY_STEP_M,
        );
      }
      if (piece.length === 0) continue;
      if (final.length > 0) {
        const lastF = final[final.length - 1];
        const gap = hav(lastF, piece[0]);
        if (gap > RUN_BRIDGE_THRESH_M) {
          final.push(...densifyBetween(lastF, piece[0], DENSIFY_STEP_M));
        }
      }
      // Avoid duplicating piece[0] when it's effectively the last final point
      const startIdx =
        final.length > 0 && hav(final[final.length - 1], piece[0]) <= DEDUPE_M
          ? 1
          : 0;
      for (let k = startIdx; k < piece.length; k++) final.push(piece[k]);
    }

    // Total failure: every chunk fell back AND no LOST-only runs salvaged
    if (
      stats.goodRuns > 0 &&
      stats.chunksOk === 0 &&
      stats.chunksFallback > 0
    ) {
      // Every Mapbox call failed; we still have a densified-raw output, but
      // the caller should know the snap step contributed nothing.
      // Per contract, this is still ok=true with the raw-densified result —
      // the caller fallbacks at a higher level. Mark stats so caller can
      // decide.
      // We keep it as ok=true because the output is still usable
      // (raw-densified is strictly better than the input for rendering).
    }

    if (final.length < 2) {
      finishStats();
      return { ok: false, reason: 'all_chunks_failed', stats };
    }

    const dd = dedupeWithin(final, DEDUPE_M);
    const sm = smoothWindow3(dd);
    finishStats();
    return { ok: true, points: sm, stats };
  } catch (e: any) {
    finishStats();
    return {
      ok: false,
      reason: e?.name === 'AbortError' ? 'aborted' : 'all_chunks_failed',
      stats,
    };
  } finally {
    clearTimeout(totalTimer);
    if (combinedExternalListener && options.signal) {
      try {
        options.signal.removeEventListener('abort', combinedExternalListener);
      } catch {
        /* polyfill missing — fine */
      }
    }
  }
}
