/**
 * strokeGate.test.ts — unit tests for v6.3 brush-edit gates.
 *
 * Plan §6.1 spec:
 *   "G0(<2 点)/ G0.5(snap<2)/ G1 / G2 / G3 各拒/各通的 happy/sad path"
 */

import {
  checkG0,
  checkG0PostSimplify,
  checkG0_5,
  checkG3,
  CORRIDOR_M,
} from '../strokeGate';
import { MAX_STROKE_VERTICES_INPUT } from '../strokeSimplify';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

// ~111km per degree lat. Useful for crafting precise-distance test geometry.
const M_PER_DEG_LAT = 111_320;

/** Build a straight polyline from (lng,lat) heading north `lengthM` meters with `n` vertices. */
function lineNorth(n: number, lng = 174.7, lat = -36.8, lengthM = 100): LngLat[] {
  const dLat = lengthM / M_PER_DEG_LAT;
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    out.push({ lng, lat: lat + dLat * t });
  }
  return out;
}

/** Offset a polyline east by `meters`. */
function offsetEast(line: LngLat[], meters: number): LngLat[] {
  // Use mean lat for cosine.
  const avgLat = line.reduce((s, p) => s + p.lat, 0) / line.length;
  const dLng = meters / (M_PER_DEG_LAT * Math.cos((avgLat * Math.PI) / 180));
  return line.map(p => ({ lng: p.lng + dLng, lat: p.lat }));
}

// === G0 ====================================================================

describe('checkG0 (preflight)', () => {
  test('passes a 2-point stroke', () => {
    const r = checkG0(lineNorth(2));
    expect(r.ok).toBe(true);
  });

  test('passes a 100-point stroke', () => {
    const r = checkG0(lineNorth(100));
    expect(r.ok).toBe(true);
  });

  test('rejects a 1-point stroke (tap)', () => {
    const r = checkG0([{ lng: 174.7, lat: -36.8 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too_short');
      expect(r.metric_value).toBe(1);
      expect(r.threshold).toBe(2);
    }
  });

  test('rejects empty stroke', () => {
    const r = checkG0([]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too_short');
    }
  });

  test('rejects > MAX_STROKE_VERTICES_INPUT (memory protection)', () => {
    const r = checkG0(lineNorth(MAX_STROKE_VERTICES_INPUT + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too_long');
      expect(r.threshold).toBe(MAX_STROKE_VERTICES_INPUT);
    }
  });
});

// === G0_post_simplify ======================================================

describe('checkG0PostSimplify', () => {
  test('passes 2-point simplified stroke', () => {
    expect(checkG0PostSimplify(lineNorth(2)).ok).toBe(true);
  });

  test('rejects 1-point simplified stroke (DP collapsed)', () => {
    const r = checkG0PostSimplify([{ lng: 174.7, lat: -36.8 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too_short_after_simplify');
    }
  });

  test('rejects 0-point simplified stroke', () => {
    const r = checkG0PostSimplify([]);
    expect(r.ok).toBe(false);
  });
});

// === G0.5 ==================================================================

describe('checkG0_5 (Mapbox response shape)', () => {
  test('passes a 5-point snap polyline', () => {
    expect(checkG0_5(lineNorth(5)).ok).toBe(true);
  });

  test('rejects 1-point snap', () => {
    const r = checkG0_5([{ lng: 174.7, lat: -36.8 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('snap_too_short');
    }
  });

  test('rejects 0-point snap', () => {
    expect(checkG0_5([]).ok).toBe(false);
  });
});

// === G1 — authoritative impl in store; tests live alongside it ==============
//
// G1 (anchor 50m) is enforced by useRouteEditStore.strokeAnchorsToBaseline,
// which is exercised end-to-end by validateStrokes.test.ts. The previously
// duplicated free-standing helper here was removed (R4 dead-code review).

// === G3 — corridor ==========================================================

describe('checkG3 (250m corridor)', () => {
  test('passes when snap follows stroke closely', () => {
    const stroke = lineNorth(10, 174.7, -36.8, 200);
    const snap = lineNorth(10, 174.7, -36.8, 200); // identical
    expect(checkG3({ stroke, snap }).ok).toBe(true);
  });

  test('passes when snap is offset by 100m from stroke', () => {
    const stroke = lineNorth(10, 174.7, -36.8, 200);
    const snap = offsetEast(lineNorth(10, 174.7, -36.8, 200), 100);
    expect(checkG3({ stroke, snap }).ok).toBe(true);
  });

  test('rejects when snap exits corridor (300m offset)', () => {
    const stroke = lineNorth(10, 174.7, -36.8, 200);
    const snap = offsetEast(lineNorth(10, 174.7, -36.8, 200), 300);
    const r = checkG3({ stroke, snap });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('snap_exits_corridor');
      expect(r.threshold).toBe(CORRIDOR_M);
      expect(r.metric_value).toBeGreaterThan(CORRIDOR_M);
    }
  });

  test('rejects when ANY snap point exits corridor (single outlier)', () => {
    const stroke = lineNorth(10, 174.7, -36.8, 200);
    const snap = lineNorth(10, 174.7, -36.8, 200);
    // Push one mid snap point ~400m east — short outlier should reject.
    const offsetForOne = offsetEast([snap[5]], 400)[0];
    snap[5] = offsetForOne;
    const r = checkG3({ stroke, snap });
    expect(r.ok).toBe(false);
  });

  test('rejects empty snap (defensive)', () => {
    const stroke = lineNorth(10, 174.7, -36.8, 200);
    expect(checkG3({ stroke, snap: [] }).ok).toBe(false);
  });

  test('rejects empty stroke (defensive)', () => {
    expect(checkG3({ stroke: [], snap: lineNorth(10) }).ok).toBe(false);
  });

  test('boundary: snap at exactly CORRIDOR_M offset passes', () => {
    const stroke = lineNorth(10, 174.7, -36.8, 200);
    const snap = offsetEast(lineNorth(10, 174.7, -36.8, 200), CORRIDOR_M);
    expect(checkG3({ stroke, snap }).ok).toBe(true);
  });
});

// === All-gate sanity ========================================================

describe('all-gate happy path', () => {
  test('plausible city stroke passes G0 + G3 (G1 covered in store-level test)', () => {
    const stroke = lineNorth(20, 174.765, -36.844, 200); // along baseline
    const snap = offsetEast(stroke, 5); // Mapbox snap 5m east — typical

    expect(checkG0(stroke).ok).toBe(true);
    expect(checkG0PostSimplify(stroke).ok).toBe(true);
    expect(checkG0_5(snap).ok).toBe(true);
    expect(checkG3({ stroke, snap }).ok).toBe(true);
  });
});
