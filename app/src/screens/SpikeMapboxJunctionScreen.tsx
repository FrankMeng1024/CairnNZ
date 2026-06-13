/**
 * SpikeMapboxJunctionScreen — Mini-Spike B (Mapbox vector tile junction extraction)
 *
 * Decision-gate spike. NOT a product feature. NOT for shipping.
 *
 * Purpose: answer 3 PASS/FAIL questions before committing Sprint capacity to
 * the "Mapbox vector tile + local junction extraction" global data source.
 *
 *   Q1: With airplane mode ON and an offline pack created for the visible
 *       region, does querySourceFeatures('composite', _, ['road']) return
 *       any features? (Validates offline-mode usability.)
 *
 *   Q2: Does an expo-location GPS fix in mainland China (e.g. Shanghai)
 *       align to the Mapbox vector tile road geometry within < 5m?
 *       (Validates whether GCJ-02 conversion is needed.)
 *
 *   Q3: How long does the RN bridge take to deliver ~8000 vertices and
 *       does InteractionManager-wrapped processing keep the UI responsive?
 *       (Validates whether tile-level batching is required.)
 *
 * The screen is a single MapView + 3 buttons + a textual log. No navigation
 * away. Results are displayed on-screen so the user can read them without
 * connecting a debugger.
 *
 * OTA-safe: no new native deps, no changes to native build config.
 */
import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';

// Conditional Mapbox import — same pattern as the rest of the app so this
// screen still mounts in Expo Go (with a fallback panel + a dev message).
let MapView: any = null;
let CameraComponent: any = null;
let offlineManager: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    offlineManager = Mapbox.offlineManager;
  } catch {
    // Mapbox not installed in this build — UI will show fallback.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Geometry helpers (inline; turf not installed)
// ─────────────────────────────────────────────────────────────────────────

const EARTH_R = 6_371_000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance between two lng/lat points, in metres. */
function haversineM(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa =
    s1 * s1 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(aa)));
}

/**
 * Approximate point-to-segment distance in metres. Projects the point onto
 * a local equirectangular plane around `p` so we can use straight-line
 * vector math; accurate to <1% for distances under a few hundred metres,
 * which is well within the < 5m precision Q2 cares about.
 */
function pointToSegmentM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [plng, plat] = p;
  const cosLat = Math.cos(toRad(plat));
  const toXY = (q: [number, number]): [number, number] => [
    (q[0] - plng) * 111_000 * cosLat,
    (q[1] - plat) * 111_000,
  ];
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const segLen2 = dx * dx + dy * dy;
  if (segLen2 < 1e-9) {
    return Math.hypot(ax, ay);
  }
  let t = -(ax * dx + ay * dy) / segLen2;
  t = Math.max(0, Math.min(1, t));
  const projx = ax + t * dx;
  const projy = ay + t * dy;
  return Math.hypot(projx, projy);
}

/** Walk a feature collection of LineString / MultiLineString roads and find
 *  the smallest perpendicular distance from `p` to any segment. */
function nearestRoadDistanceM(
  features: any[],
  p: [number, number],
): { minM: number; segCount: number; vertexCount: number } {
  let minM = Infinity;
  let segCount = 0;
  let vertexCount = 0;
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    const lines: number[][][] =
      g.type === 'LineString'
        ? [g.coordinates]
        : g.type === 'MultiLineString'
          ? g.coordinates
          : [];
    for (const line of lines) {
      vertexCount += line.length;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as [number, number];
        const b = line[i] as [number, number];
        const d = pointToSegmentM(p, a, b);
        if (d < minM) minM = d;
        segCount++;
      }
    }
  }
  return { minM, segCount, vertexCount };
}

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

type LogLine = { ts: number; level: 'info' | 'pass' | 'fail'; text: string };

export function SpikeMapboxJunctionScreen() {
  const nav = useNavigation();
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const [center, setCenter] = useState<[number, number]>([121.4737, 31.2304]); // Shanghai default
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const append = useCallback((level: LogLine['level'], text: string) => {
    setLog(prev => [...prev, { ts: Date.now(), level, text }]);
  }, []);

  const clear = useCallback(() => setLog([]), []);

  // ── Q1: Offline pack + querySourceFeatures ──────────────────────────────
  const runQ1 = useCallback(async () => {
    if (busy) return;
    setBusy('Q1');
    append('info', '── Q1: Offline querySourceFeatures ──');
    try {
      if (!mapRef.current) {
        append('fail', 'No MapView ref. Aborting.');
        return;
      }
      // Step 1: report pack status (does NOT create — user pre-creates a
      // pack covering the visible region before flipping airplane mode on).
      if (offlineManager) {
        try {
          const packs = await offlineManager.getPacks();
          append('info', `offlineManager.getPacks() → ${packs.length} pack(s)`);
          for (const p of packs) {
            try {
              const status = await p.status();
              append(
                'info',
                `  pack="${p.name}" state=${status.state} completed=${status.completedResourceCount}/${status.requiredResourceCount}`,
              );
            } catch {
              append('info', `  pack="${p.name}" status unavailable`);
            }
          }
        } catch (e: any) {
          append('info', `getPacks failed: ${e?.message ?? e}`);
        }
      } else {
        append('fail', 'offlineManager not available — Mapbox not loaded');
        return;
      }

      // Step 2: querySourceFeatures on the composite source / road layer.
      const t0 = Date.now();
      const fc = await mapRef.current.querySourceFeatures(
        'composite',
        [],
        ['road'],
      );
      const elapsed = Date.now() - t0;
      const count = fc?.features?.length ?? 0;
      append('info', `querySourceFeatures elapsed=${elapsed}ms`);
      if (count > 0) {
        append('pass', `PASS Q1 — got ${count} road features offline`);
        // Sample first feature so user can see we got real data
        const first = fc.features[0];
        const cls = first?.properties?.class ?? '?';
        append('info', `  sample[0] class=${cls}, geom=${first?.geometry?.type}`);
      } else {
        // Fallback: try queryRenderedFeaturesInRect on the visible viewport.
        // querySourceFeatures only returns currently-loaded tiles for the
        // visible viewport in Mapbox's vector tile model — if it returns 0,
        // try the rendered-features path before declaring FAIL.
        append('info', 'querySourceFeatures returned 0; trying queryRenderedFeaturesInRect');
        try {
          const rendered = await mapRef.current.queryRenderedFeaturesInRect(
            [],
            [],
            ['road'],
          );
          const renderedCount = rendered?.features?.length ?? 0;
          if (renderedCount > 0) {
            append(
              'pass',
              `PASS Q1 (via rendered) — ${renderedCount} road features in viewport`,
            );
          } else {
            append(
              'fail',
              'FAIL Q1 — 0 features from both query paths. Either offline pack does not cover this view, or Mapbox does not expose road tiles offline.',
            );
          }
        } catch (e: any) {
          append('fail', `FAIL Q1 — queryRenderedFeaturesInRect threw: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      append('fail', `FAIL Q1 — exception: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [append, busy]);

  // ── Q2: GPS vs Mapbox tile road offset (China test) ─────────────────────
  const runQ2 = useCallback(async () => {
    if (busy) return;
    setBusy('Q2');
    append('info', '── Q2: GPS vs Mapbox road offset ──');
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        const req = await Location.requestForegroundPermissionsAsync();
        if (!req.granted) {
          append('fail', 'FAIL Q2 — location permission denied');
          return;
        }
      }
      append('info', 'Acquiring high-accuracy GPS fix (up to 15s)…');
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      const gps: [number, number] = [fix.coords.longitude, fix.coords.latitude];
      const acc = fix.coords.accuracy ?? -1;
      append('info', `GPS lng=${gps[0].toFixed(6)} lat=${gps[1].toFixed(6)} accuracy=${acc.toFixed(1)}m`);

      // Recenter map on the GPS fix so querySourceFeatures returns features
      // around the user's actual location, not whatever the screen had open.
      if (cameraRef.current) {
        cameraRef.current.setCamera({
          centerCoordinate: gps,
          zoomLevel: 17,
          animationDuration: 600,
        });
      }
      setCenter(gps);
      // Wait for camera + tiles to settle. 1.5s is empirical for native
      // Mapbox to actually request, decode, and load the new tile.
      await new Promise(r => setTimeout(r, 1500));

      if (!mapRef.current) {
        append('fail', 'FAIL Q2 — no MapView ref');
        return;
      }
      const fc = await mapRef.current.queryRenderedFeaturesInRect(
        [],
        [],
        ['road'],
      );
      const features = fc?.features ?? [];
      append('info', `road features in viewport: ${features.length}`);
      if (features.length === 0) {
        append('fail', 'FAIL Q2 — no road features near GPS fix; cannot measure offset');
        return;
      }
      const { minM, segCount, vertexCount } = nearestRoadDistanceM(features, gps);
      append('info', `analyzed ${segCount} segments / ${vertexCount} vertices`);
      append('info', `nearest road segment distance = ${minM.toFixed(2)}m`);
      // Note: device GPS in China is usually GCJ-02-corrected by the
      // OS/Apple Maps stack, so a clean < 5m is normal there. But if the
      // device delivers raw WGS-84 (some Android ROMs), we'll see the
      // characteristic 50–500m offset.
      if (minM < 5) {
        append('pass', `PASS Q2 — offset < 5m, no GCJ-02 conversion needed`);
      } else if (minM < 20) {
        append('info', `BORDERLINE Q2 — ${minM.toFixed(1)}m. Acceptable but margin tight.`);
      } else {
        append(
          'fail',
          `FAIL Q2 — offset ${minM.toFixed(1)}m. GCJ-02 conversion required.`,
        );
      }
    } catch (e: any) {
      append('fail', `FAIL Q2 — exception: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [append, busy]);

  // ── Q3: 8000-vertex bridge timing + UI responsiveness ───────────────────
  const runQ3 = useCallback(async () => {
    if (busy) return;
    setBusy('Q3');
    append('info', '── Q3: 8000-vertex RN bridge + InteractionManager ──');
    try {
      if (!mapRef.current) {
        append('fail', 'FAIL Q3 — no MapView ref');
        return;
      }
      // Zoom out a touch so we get more roads in the viewport for a fairer
      // vertex-count test. We don't WANT 8000 unless the road density
      // supplies it — the test reports actual count.
      if (cameraRef.current) {
        cameraRef.current.setCamera({
          centerCoordinate: center,
          zoomLevel: 14,
          animationDuration: 300,
        });
      }
      await new Promise(r => setTimeout(r, 600));

      // Phase A: raw query timing (no InteractionManager) — measures how
      // long the bridge takes to ship the FeatureCollection across.
      const tA0 = Date.now();
      const fcA = await mapRef.current.queryRenderedFeaturesInRect(
        [],
        [],
        ['road'],
      );
      const tA1 = Date.now();
      const featA = fcA?.features ?? [];
      let vertA = 0;
      for (const f of featA) {
        const g = f?.geometry;
        if (g?.type === 'LineString') vertA += g.coordinates.length;
        else if (g?.type === 'MultiLineString') {
          for (const l of g.coordinates) vertA += l.length;
        }
      }
      append('info', `Phase A (no IM): ${featA.length} features, ${vertA} vertices, bridge=${tA1 - tA0}ms`);

      // Phase B: same query wrapped in InteractionManager.runAfterInteractions
      // + chunked vertex processing, so we can compare with/without yielding.
      append('info', 'Phase B starting — InteractionManager-wrapped processing…');
      const tB0 = Date.now();
      await new Promise<void>(resolve => {
        InteractionManager.runAfterInteractions(async () => {
          const fcB = await mapRef.current.queryRenderedFeaturesInRect(
            [],
            [],
            ['road'],
          );
          const featB = fcB?.features ?? [];
          let vertB = 0;
          // Process in chunks of 500 vertices, yielding to the JS event
          // loop between chunks so any pending UI work (button taps,
          // animations) can run.
          const CHUNK = 500;
          let chunkBuf = 0;
          for (const f of featB) {
            const g = f?.geometry;
            const lines: number[][][] =
              g?.type === 'LineString'
                ? [g.coordinates]
                : g?.type === 'MultiLineString'
                  ? g.coordinates
                  : [];
            for (const line of lines) {
              vertB += line.length;
              chunkBuf += line.length;
              if (chunkBuf >= CHUNK) {
                chunkBuf = 0;
                // Yield. setTimeout(_, 0) is enough to give RN a chance to
                // dispatch any queued events before we resume.
                await new Promise(r => setTimeout(r, 0));
              }
            }
          }
          const tB1 = Date.now();
          append(
            'info',
            `Phase B (IM + chunked): ${featB.length} features, ${vertB} vertices, total=${tB1 - tB0}ms`,
          );
          // Verdict: if Phase A bridge < 500ms AND Phase B finished
          // without errors, the path is viable for production. The IM
          // wrap mainly buys jank avoidance for very large viewports;
          // raw bridge cost is the hard floor.
          if (tA1 - tA0 < 500) {
            append('pass', `PASS Q3 — bridge cost ${tA1 - tA0}ms < 500ms threshold`);
          } else if (tA1 - tA0 < 2000) {
            append(
              'info',
              `BORDERLINE Q3 — ${tA1 - tA0}ms. Above 500ms target but under 2000ms ceiling. Tile batching recommended.`,
            );
          } else {
            append(
              'fail',
              `FAIL Q3 — bridge ${tA1 - tA0}ms exceeds 2000ms; must split per-tile and stream results.`,
            );
          }
          resolve();
        });
      });
    } catch (e: any) {
      append('fail', `FAIL Q3 — exception: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [append, busy, center]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Mini-Spike B</Text>
        <TouchableOpacity onPress={clear} style={styles.clearBtn}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mapBox}>
        {MapView ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            styleURL="mapbox://styles/mapbox/outdoors-v12"
            logoEnabled={false}
            attributionEnabled={false}
            scaleBarEnabled={false}
            compassEnabled={false}
          >
            {CameraComponent && (
              <CameraComponent
                ref={cameraRef}
                centerCoordinate={center}
                zoomLevel={14}
              />
            )}
          </MapView>
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>
              @rnmapbox/maps not loaded in this build.{'\n'}
              Spike requires the EAS dev build.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.btn, busy === 'Q1' && styles.btnBusy]}
          onPress={runQ1}
          disabled={!!busy}
        >
          <Text style={styles.btnText}>{busy === 'Q1' ? '…' : 'Q1 Offline'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, busy === 'Q2' && styles.btnBusy]}
          onPress={runQ2}
          disabled={!!busy}
        >
          <Text style={styles.btnText}>{busy === 'Q2' ? '…' : 'Q2 GCJ-02'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, busy === 'Q3' && styles.btnBusy]}
          onPress={runQ3}
          disabled={!!busy}
        >
          <Text style={styles.btnText}>{busy === 'Q3' ? '…' : 'Q3 Perf'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.logBox} contentContainerStyle={{ padding: 8 }}>
        {log.length === 0 ? (
          <Text style={styles.logEmpty}>
            Tap a button above. Log lines appear here.{'\n'}
            Read research/spike-b-readme.md before starting.
          </Text>
        ) : (
          log.map((l, i) => (
            <Text
              key={i}
              style={[
                styles.logLine,
                l.level === 'pass' && styles.logPass,
                l.level === 'fail' && styles.logFail,
              ]}
            >
              {new Date(l.ts).toLocaleTimeString()} {l.text}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0e12' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#11151b',
  },
  backBtn: { padding: 6 },
  backText: { color: '#9cb', fontSize: 14, fontWeight: '600' },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  clearBtn: { padding: 6 },
  clearText: { color: '#9cb', fontSize: 14, fontWeight: '600' },
  mapBox: { height: 220, backgroundColor: '#000' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fallbackText: { color: '#fa6', textAlign: 'center', fontSize: 13 },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    backgroundColor: '#11151b',
  },
  btn: {
    flex: 1,
    backgroundColor: '#264',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnBusy: { backgroundColor: '#642' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  logBox: { flex: 1, backgroundColor: '#0b0e12' },
  logEmpty: { color: '#678', fontSize: 13, lineHeight: 18 },
  logLine: {
    color: '#cde',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  logPass: { color: '#5e6' },
  logFail: { color: '#f87' },
});
