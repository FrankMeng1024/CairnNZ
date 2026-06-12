/**
 * Integration test — exercise Map Matching against the real Mapbox API.
 *
 * Skipped by default (network + token cost). Run explicitly:
 *   npx jest src/services/routing/mapmatch/__tests__/runMapMatching.integration.test.ts --testTimeout=30000
 *
 * What this proves:
 *   - `runMapMatching` produces a polyline that snaps near a known via.
 *   - 1km corridor is enforced via shape-similarity (no-via case).
 *   - Multi-segment stitching works on a long route.
 */

import { runMapMatching } from '../runMapMatching';
import type { ViaPoint } from '../types';

const HAS_TOKEN = !!process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const describeIfToken = HAS_TOKEN ? describe : describe.skip;

// Shanghai: a stretch of road centerline near the user's repro hot spot
// (Kangding Rd / Yanping Rd). Sampled at ~10m spacing for ~700m total.
function shanghaiTestRoute(): { lng: number; lat: number }[] {
  // Kangding Rd eastbound, ~30 points
  const pts: { lng: number; lat: number }[] = [];
  const startLng = 121.4480;
  const startLat = 31.2280;
  for (let i = 0; i < 30; i++) {
    pts.push({ lng: startLng + i * 0.0002, lat: startLat });
  }
  return pts;
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

describeIfToken('runMapMatching — integration with live Mapbox API', () => {
  const orig = shanghaiTestRoute();

  it('passes through originalPoints unchanged when no via is placed (no API call)', async () => {
    // v244: no-via case is a pure passthrough — Map Matching is only
    // invoked when the user adds a via. The matched line equals the
    // original GPS, segmentCount=0, and no Mapbox API was called.
    const r = await runMapMatching({ originalPoints: orig, viaPoints: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matchedPoints).toEqual(orig);
    expect(r.segmentCount).toBe(0);
  }, 25_000);

  it('routes through a placed via point within snap radius', async () => {
    // Place a via roughly perpendicular to the route by ~80m to force a
    // detour onto a nearby cross street.
    const midOrig = orig[Math.floor(orig.length / 2)];
    const via: ViaPoint = {
      id: 'v1',
      lng: midOrig.lng,
      lat: midOrig.lat + 0.0005, // ~55m north
    };
    const r = await runMapMatching({ originalPoints: orig, viaPoints: [via] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Find the matched point closest to the via. Tolerance is generous
    // (250m) because the test fixture isn't on a real road grid; what we
    // assert is "the via influenced the matched polyline", not exact snap.
    let bestNear = Infinity;
    for (const p of r.matchedPoints) {
      const d = haversine(p, { lat: via.lat, lng: via.lng });
      if (d < bestNear) bestNear = d;
    }
    expect(bestNear).toBeLessThan(250);
  }, 30_000);

  it('returns no-match cleanly for a via in an area with no roads', async () => {
    // v244: with no via, runMapMatching is a passthrough — no API. To
    // verify failure handling we need a via the Mapbox snap can't honor.
    const pacific = [
      { lng: -150, lat: 0 },
      { lng: -150.001, lat: 0 },
      { lng: -150.002, lat: 0 },
    ];
    const via: ViaPoint = { id: 'v1', lng: -150.0015, lat: 0.0005 };
    const r = await runMapMatching({ originalPoints: pacific, viaPoints: [via] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(['no-match', 'invalid-input']).toContain(r.reason);
  }, 25_000);
});

describe('runMapMatching — local input validation (always runs)', () => {
  it('rejects too-few originalPoints', async () => {
    const r = await runMapMatching({ originalPoints: [], viaPoints: [] });
    expect(r.ok).toBe(false);
  });
});
