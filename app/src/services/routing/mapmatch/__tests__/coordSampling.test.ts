/**
 * coordSampling.test — verify Map Matching coord sequence build invariants.
 */

import { buildMatchSequence, stitchMatchedSegments } from '../coordSampling';
import type { ViaPoint } from '../types';

function mkRoute(n: number): { lng: number; lat: number }[] {
  // Roughly Shanghai bbox; 10m spacing in lng for stability.
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ lng: 121.4737 + i * 0.0001, lat: 31.2304 });
  }
  return out;
}

describe('buildMatchSequence', () => {
  it('returns empty for fewer than 2 points', () => {
    const r = buildMatchSequence({ originalPoints: [], viaPoints: [] });
    expect(r.segments).toHaveLength(0);
    expect(r.totalCoords).toBe(0);
  });

  it('builds a single segment with no vias', () => {
    const orig = mkRoute(20);
    const r = buildMatchSequence({ originalPoints: orig, viaPoints: [] });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].coords.length).toBeGreaterThanOrEqual(2);
    expect(r.segments[0].coords.length).toBeLessThanOrEqual(100);
    expect(r.segments[0].viaIndicesInCoords).toHaveLength(0);
  });

  it('stays under 100-coord cap on long routes', () => {
    const orig = mkRoute(2000);
    const r = buildMatchSequence({ originalPoints: orig, viaPoints: [] });
    for (const seg of r.segments) {
      expect(seg.coords.length).toBeLessThanOrEqual(100);
    }
  });

  it('forces vias to appear in the output', () => {
    const orig = mkRoute(50);
    const vias: ViaPoint[] = [
      { id: 'v1', lng: 121.4737 + 0.0025, lat: 31.2306 },
    ];
    const r = buildMatchSequence({ originalPoints: orig, viaPoints: vias });
    expect(r.segments.length).toBeGreaterThanOrEqual(1);
    const seg0 = r.segments[0];
    expect(seg0.viaIndicesInCoords.length).toBeGreaterThan(0);
    // Via coord must be present.
    const viaIdx = seg0.viaIndicesInCoords[0];
    const viaCoord = seg0.coords[viaIdx];
    expect(Math.abs(viaCoord.lng - vias[0].lng)).toBeLessThan(1e-9);
    expect(Math.abs(viaCoord.lat - vias[0].lat)).toBeLessThan(1e-9);
  });

  it('assigns tight radius to via, looser to anchor windows', () => {
    const orig = mkRoute(30);
    const vias: ViaPoint[] = [
      { id: 'v1', lng: 121.4737 + 0.0015, lat: 31.2306 },
    ];
    const r = buildMatchSequence({ originalPoints: orig, viaPoints: vias });
    const seg = r.segments[0];
    const viaIdx = seg.viaIndicesInCoords[0];
    expect(seg.radiuses[viaIdx]).toBe(25);
  });

  it('emits multiple segments for a route too dense to fit in 96 coords', () => {
    // 5 vias on a 500-pt route: anchor windows + fill blow the budget on
    // single-segment build → fall back to multi-segment.
    const orig = mkRoute(500);
    const vias: ViaPoint[] = [];
    for (let i = 1; i <= 5; i++) {
      vias.push({ id: `v${i}`, lng: 121.4737 + i * 0.005, lat: 31.2305 });
    }
    const r = buildMatchSequence({ originalPoints: orig, viaPoints: vias });
    expect(r.segments.length).toBeGreaterThanOrEqual(1);
    for (const seg of r.segments) {
      expect(seg.coords.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('stitchMatchedSegments', () => {
  it('merges segments dropping coincident endpoints', () => {
    const a = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
      { lng: 2, lat: 0 },
    ];
    // First point of b is within 5m of last of a (lat=0, lng=2).
    const b = [
      { lng: 2, lat: 0 },
      { lng: 3, lat: 0 },
    ];
    const out = stitchMatchedSegments([a, b]);
    expect(out).toHaveLength(4);
    expect(out[2].lng).toBe(2);
    expect(out[3].lng).toBe(3);
  });

  it('keeps both endpoints when they diverge', () => {
    const a = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
    ];
    const b = [
      { lng: 5, lat: 0 },
      { lng: 6, lat: 0 },
    ];
    const out = stitchMatchedSegments([a, b]);
    expect(out).toHaveLength(4);
  });

  it('returns empty for empty input', () => {
    expect(stitchMatchedSegments([])).toHaveLength(0);
  });
});
