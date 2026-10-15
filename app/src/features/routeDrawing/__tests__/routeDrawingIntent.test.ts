import type { LngLat } from '../../../services/routing/corridor/PolylineSampler';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveProviderOwnedLegacyGeometry,
  resolveRouteDrawing,
  routeDrawingDistanceM,
  type DrawingViewport,
} from '../routeDrawingIntent';
import { HUMAN_ROUTE_DRAWING_FIXTURES } from '../humanIntentFixtures';
import { replayRouteDrawingFixture } from '../routeDrawingTrace';

const ORIGIN: LngLat = { lng: 174.764, lat: -36.848 };

function point(eastM: number, northM: number): LngLat {
  const lat = ORIGIN.lat + northM / 111_000;
  const lng = ORIGIN.lng + eastM / (111_000 * Math.cos(ORIGIN.lat * Math.PI / 180));
  return { lng, lat };
}

function viewport(zoom: number): DrawingViewport {
  return { width: 390, height: 844, center: ORIGIN, zoom, bearing: 0, pitch: 0 };
}

function hasPointNear(points: LngLat[], expected: LngLat, toleranceM = 3): boolean {
  return points.some(candidate => routeDrawingDistanceM(candidate, expected) <= toleranceM);
}

describe('human Route drawing intent', () => {
  test('Scenario A — a straight stroke flattens a V and removes the obsolete apex', () => {
    const apex = point(50, 75);
    const original = [point(0, 0), apex, point(100, 0)];
    const raw = [point(0, 0), point(25, 1), point(50, -1), point(75, 1), point(100, 0)];
    const providerWithOldApex = [point(0, 0), point(48, 72), point(100, 0)];

    const decision = resolveRouteDrawing({
      originalRoute: original,
      rawStroke: raw,
      providerGeometry: providerWithOldApex,
      viewport: viewport(16),
    });

    expect(decision.status).toBe('accepted');
    expect(decision.intent).toBe('straight-replacement');
    expect(decision.selectionSource).toBe('drawn-intent');
    expect(decision.divergenceStage).toBe('provider');
    expect(hasPointNear(decision.finalGeometry, apex, 20)).toBe(false);
    expect(decision.metrics.selected.sharpTurns).toBe(0);
    expect(decision.metrics.selected.spikes).toBe(0);
  });

  test('Scenario B — a faithful nearly-straight road match is accepted without a new turn', () => {
    const original = [point(0, 0), point(120, 0)];
    const raw = [point(0, 0), point(30, 2), point(60, -1), point(90, 1), point(120, 0)];
    const provider = [point(0, 0), point(40, 1), point(80, 1), point(120, 0)];
    const decision = resolveRouteDrawing({ originalRoute: original, rawStroke: raw, providerGeometry: provider, viewport: viewport(17) });

    expect(decision.status).toBe('accepted');
    expect(decision.intent).toBe('straight-replacement');
    expect(decision.selectionSource).toBe('provider');
    expect(decision.metrics.selected.sharpTurns).toBe(0);
    expect(decision.metrics.selected.pathLengthInflation).toBeLessThan(1.1);
  });

  test('Scenario C — Draw-to-Point continuation stays locally continuous at the tool boundary', () => {
    const original = [point(0, 0), point(140, 0)];
    // First three observations model Draw; the final two model Point taps.
    const mixedInput = [point(0, 0), point(35, 1), point(70, 0), point(105, 1), point(140, 0)];
    const provider = [point(0, 0), point(70, 0.5), point(140, 0)];
    const decision = resolveRouteDrawing({ originalRoute: original, rawStroke: mixedInput, providerGeometry: provider, viewport: viewport(16) });

    expect(decision.status).toBe('accepted');
    expect(decision.metrics.selected.maxTurnDeg).toBeLessThan(20);
    expect(decision.metrics.selected.spikes).toBe(0);
    expect(decision.metrics.selected.seamEntryTurnDeg).toBeLessThan(20);
    expect(decision.metrics.selected.seamExitTurnDeg).toBeLessThan(20);
  });

  test('Scenario D — an intentional L-shaped turn is not straightened by the provider', () => {
    const original = [point(0, 0), point(120, 0)];
    const raw = [point(0, 0), point(55, 0), point(55, 55), point(120, 0)];
    const providerThatCutsCorner = [point(0, 0), point(120, 0)];
    const decision = resolveRouteDrawing({
      originalRoute: original,
      rawStroke: raw,
      providerGeometry: providerThatCutsCorner,
      viewport: viewport(17),
    });

    expect(decision.status).toBe('accepted');
    expect(decision.intent).toBe('intentional-turn');
    expect(decision.selectionSource).toBe('drawn-intent');
    expect(decision.metrics.selected.sharpTurns).toBeGreaterThan(0);
    expect(hasPointNear(decision.selectedReplacement, point(55, 55), 5)).toBe(true);
  });

  test('Scenario E — unique endpoint anchors replace across multiple interior crossings', () => {
    const original = [
      point(0, 0), point(30, 30), point(60, -30), point(90, 30), point(120, 0),
    ];
    const raw = [point(0, 0), point(120, 0)];
    const decision = resolveRouteDrawing({ originalRoute: original, rawStroke: raw, providerGeometry: raw, viewport: viewport(15) });

    expect(decision.status).toBe('accepted');
    expect(decision.intent).toBe('straight-replacement');
    expect(decision.selectionSource).not.toBe('original-preserved');
    expect(decision.attachments.crossingCount).toBeGreaterThanOrEqual(2);
    expect(decision.finalGeometry).toEqual(raw);
    expect(decision.metrics.selected.spikes).toBe(0);
  });

  test('Scenario F — the same obvious operation is stable across neighborhood and wide zooms', () => {
    const original = [point(0, 0), point(50, 65), point(100, 0)];
    const raw = [point(0, 0), point(50, 2), point(100, 0)];
    const provider = [point(0, 0), point(48, 60), point(100, 0)];
    const wideViewport = viewport(13);
    const neighborhoodViewport = viewport(17);
    const wide = resolveRouteDrawing({ originalRoute: original, rawStroke: raw, providerGeometry: provider, viewport: wideViewport });
    const neighborhood = resolveRouteDrawing({ originalRoute: original, rawStroke: raw, providerGeometry: provider, viewport: neighborhoodViewport });

    expect(wide.intent).toBe('straight-replacement');
    expect(neighborhood.intent).toBe('straight-replacement');
    expect(wide.selectionSource).toBe('drawn-intent');
    expect(neighborhood.selectionSource).toBe('drawn-intent');
    expect(wide.finalGeometry).toEqual(neighborhood.finalGeometry);
    expect(wideViewport.zoom).toBe(13);
    expect(neighborhoodViewport.zoom).toBe(17);
  });

  test('separate true ambiguity — retraced endpoint occurrences preserve the original safely', () => {
    const original = [point(0, 0), point(60, 0), point(0, 0), point(60, 0), point(120, 0)];
    const raw = [point(0, 0), point(30, 30), point(60, 0)];
    const decision = resolveRouteDrawing({ originalRoute: original, rawStroke: raw, providerGeometry: raw, viewport: viewport(16) });
    expect(decision.status).toBe('preserved');
    expect(decision.intent).toBe('ambiguous');
    expect(decision.attachments.ambiguous).toBe(true);
    expect(decision.finalGeometry).toEqual(original);
  });

  test('legacy provider-owned attachment reproduces the old sharp-corner defect', () => {
    const apex = point(50, 70);
    const original = [point(0, 0), apex, point(100, 0)];
    const raw = [point(0, 0), point(100, 0)];
    // Provider lands on the old first arm near the apex before continuing.
    const provider = [point(15, 20), point(47, 66), point(100, 0)];
    const legacy = resolveProviderOwnedLegacyGeometry({ originalRoute: original, rawStroke: raw, providerGeometry: provider, viewport: viewport(16) });
    const current = resolveRouteDrawing({ originalRoute: original, rawStroke: raw, providerGeometry: provider, viewport: viewport(16) });

    expect(hasPointNear(legacy, apex, 10)).toBe(true);
    expect(hasPointNear(current.finalGeometry, apex, 15)).toBe(false);
  });
});

afterAll(() => {
  const outputDir = process.env.CAIRN_O82_REPLAY_EVIDENCE_DIR ?? process.env.CAIRN_O81_REPLAY_EVIDENCE_DIR;
  if (!outputDir) return;
  fs.mkdirSync(outputDir, { recursive: true });
  const expectations: Record<string, (replay: ReturnType<typeof replayRouteDrawingFixture>) => boolean> = {
    flattenV: replay => replay.decision.status === 'accepted'
      && replay.decision.intent === 'straight-replacement'
      && replay.decision.metrics.selected.spikes === 0,
    straightRoad: replay => replay.decision.selectionSource === 'provider'
      && replay.decision.metrics.selected.sharpTurns === 0,
    mixedTool: replay => replay.decision.metrics.selected.spikes === 0
      && replay.decision.metrics.selected.maxTurnDeg < 20,
    intentionalTurn: replay => replay.decision.intent === 'intentional-turn'
      && replay.decision.metrics.selected.sharpTurns > 0,
    ambiguousCrossing: replay => replay.decision.status === 'accepted'
      && replay.decision.selectionSource !== 'original-preserved'
      && replay.decision.metrics.selected.spikes === 0,
    trueAmbiguousOccurrences: replay => replay.decision.status === 'preserved'
      && replay.decision.selectionSource === 'original-preserved',
    flattenVWideZoom: replay => replay.decision.intent === 'straight-replacement'
      && replay.decision.metrics.selected.spikes === 0,
  };
  Object.entries(HUMAN_ROUTE_DRAWING_FIXTURES).forEach(([key, fixture]) => {
    const replay = replayRouteDrawingFixture(fixture);
    const alternateZoom = key === 'flattenVWideZoom'
      ? replayRouteDrawingFixture({ ...fixture, viewport: { ...fixture.viewport, zoom: 17 } })
      : null;
    const artifact = {
      schemaVersion: 1,
      task: 'O82',
      scenarioKey: key,
      outcome: expectations[key]?.(replay) ? 'PASS' : 'FAIL',
      fixture: replay.fixture,
      providerOutput: replay.overlays.providerCandidate,
      finalAcceptedGeometry: replay.overlays.finalGeometry,
      legacyComparatorGeometry: replay.legacyGeometry,
      decision: replay.decision,
      zoomComparison: alternateZoom ? {
        wideZoom: fixture.viewport.zoom,
        neighborhoodZoom: alternateZoom.fixture.viewport.zoom,
        finalGeometryEqual: JSON.stringify(replay.decision.finalGeometry) === JSON.stringify(alternateZoom.decision.finalGeometry),
        wideMetrics: replay.decision.metrics.selected,
        neighborhoodMetrics: alternateZoom.decision.metrics.selected,
      } : null,
    };
    fs.writeFileSync(
      path.join(outputDir, `${String(Object.keys(HUMAN_ROUTE_DRAWING_FIXTURES).indexOf(key) + 1).padStart(2, '0')}-${key}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
  });
});
