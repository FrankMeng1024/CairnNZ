/**
 * runPreviewFinally.test.ts — verify v6.3 plan §1.2 / R1v3 contract.
 *
 * The runPreview Promise can resolve via SUCCESS, REJECT, FENCE, or THROW.
 * On every path, the `finally` block MUST clear `isComputing` so the
 * Preview button is never permanently disabled.
 *
 * Plan §6.1 spec:
 *   "R1v3:Preview 各失败路径(throw / abort / fence trigger / Mapbox NoMatch /
 *    corridor 拒)`isComputing` 必清,timeoutId 必清,Preview 按钮恢复点击"
 *
 * Also covers double-tap (R1v3): if isComputing=true, runPreview returns
 * immediately without sending another Mapbox call.
 */

// Stub AsyncStorage before any import that pulls it in transitively.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

// Mock matchSegment so we never hit real Mapbox in unit tests.
jest.mock('../../services/routing/mapmatch/MapMatchingClient', () => ({
  matchSegment: jest.fn(),
}));

import { useRouteEditStore } from '../useRouteEditStore';
import { matchSegment } from '../../services/routing/mapmatch/MapMatchingClient';
import { PointCloudIndex } from '../../services/routing/corridor/PointCloudIndex';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

const matchSegmentMock = matchSegment as unknown as jest.Mock;

function originalLine(): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= 100; i++) {
    out.push({ lng: 174.7 + i * 0.0001, lat: -36.8 });
  }
  return out;
}

function buildWalkedIndex(points: LngLat[]): PointCloudIndex {
  return new PointCloudIndex(
    points.map((p, i) => ({
      lng: p.lng,
      lat: p.lat,
      source: 'original' as const,
      refId: `r:${i}`,
    })),
  );
}

/** Inject a session with a single brush stroke ready for Preview.
 * Each call uses a unique stroke id to defeat the in-module strokeSnapCache.
 */
let strokeIdCounter = 0;
function attachWithStroke(): void {
  strokeIdCounter += 1;
  const orig = originalLine();
  // Stroke runs along the line at indices 30..50 with a tiny offset.
  // Each call uses a unique horizontal offset large enough to defeat the
  // module-internal strokeSnapCache (whose fingerprint truncates to 5
  // decimal degrees ≈ 1m). Tests are otherwise independent.
  const eps = strokeIdCounter * 0.00002; // ~2m per attach
  const strokePts: LngLat[] = [];
  for (let i = 30; i <= 50; i++) {
    strokePts.push({ lng: orig[i].lng + eps, lat: orig[i].lat - 0.00001 });
  }
  useRouteEditStore.setState({
    sessionId: 's-test',
    routeId: 'r-test',
    originalPoints: orig,
    matchedPoints: orig,
    workingPoints: orig.slice(),
    walkedIndex: buildWalkedIndex(orig),
    brushStrokes: [{ id: `stroke-${strokeIdCounter}`, points: strokePts }],
    undoStack: [],
    isOpen: true,
    isComputing: false,
    isSaving: false,
    editOpSeq: 1,
    previewIsCurrent: false,
    lastError: null,
    lastWarning: null,
    activeStrokeId: null,
    validationErrors: [],
    trimStartFrac: 0,
    trimEndFrac: 1,
    hasCommittedEdit: false,
  });
}

beforeEach(() => {
  matchSegmentMock.mockReset();
  attachWithStroke();
});

describe('runPreview finally contract (v6.3 R1v3)', () => {
  test('isComputing clears after SUCCESS', async () => {
    matchSegmentMock.mockResolvedValue({
      ok: true,
      matchedPoints: useRouteEditStore.getState().brushStrokes[0].points,
      confidence: 0.9,
      durationMs: 50,
    });
    const r = await useRouteEditStore.getState().runPreview();
    expect(r.ok).toBe(true);
    expect(useRouteEditStore.getState().isComputing).toBe(false);
  });

  test('isComputing clears after Mapbox NoMatch reject', async () => {
    matchSegmentMock.mockResolvedValue({
      ok: false,
      reason: 'no-match',
      durationMs: 50,
    });
    const r = await useRouteEditStore.getState().runPreview();
    expect(r.ok).toBe(false);
    expect(useRouteEditStore.getState().isComputing).toBe(false);
  });

  test('isComputing clears after timeout reject', async () => {
    matchSegmentMock.mockResolvedValue({
      ok: false,
      reason: 'timeout',
      durationMs: 8000,
    });
    const r = await useRouteEditStore.getState().runPreview();
    expect(r.ok).toBe(false);
    expect(useRouteEditStore.getState().isComputing).toBe(false);
  });

  test('isComputing clears even if matchSegment THROWS', async () => {
    matchSegmentMock.mockImplementation(() => {
      throw new Error('synchronous boom');
    });
    const r = await useRouteEditStore.getState().runPreview();
    expect(r.ok).toBe(false);
    // THIS is the critical assertion: pre-v6.3 a thrown error left the
    // Preview button stuck. v6.3 finally guarantees it clears.
    expect(useRouteEditStore.getState().isComputing).toBe(false);
  });

  test('isComputing clears after fence trigger (editOpSeq bump mid-await)', async () => {
    matchSegmentMock.mockImplementation(async () => {
      // Bump editOpSeq during the await — simulates user hitting hardware-back.
      useRouteEditStore.setState((s) => ({ editOpSeq: s.editOpSeq + 1 }));
      return {
        ok: true,
        matchedPoints: useRouteEditStore.getState().brushStrokes[0].points,
        confidence: 0.9,
        durationMs: 50,
      };
    });
    const r = await useRouteEditStore.getState().runPreview();
    expect(r.ok).toBe(false);
    expect(useRouteEditStore.getState().isComputing).toBe(false);
  });
});

describe('runPreview double-tap (v6.3 R1v3)', () => {
  test('second call while isComputing=true returns immediately, no extra fetch', async () => {
    let resolveFn: (value: any) => void = () => {};
    matchSegmentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    // Fire 1st preview but DON'T await — leave it pending.
    const p1 = useRouteEditStore.getState().runPreview();
    // Tiny tick to let async setup run.
    await Promise.resolve();
    expect(useRouteEditStore.getState().isComputing).toBe(true);

    // 2nd tap arrives while 1st is still pending.
    const r2 = await useRouteEditStore.getState().runPreview();
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/computing/i);
    // matchSegment should have been called exactly ONCE — second call
    // short-circuited.
    expect(matchSegmentMock).toHaveBeenCalledTimes(1);

    // Now resolve the first call to clean up.
    resolveFn({
      ok: true,
      matchedPoints: useRouteEditStore.getState().brushStrokes[0].points,
      confidence: 0.9,
      durationMs: 50,
    });
    await p1;
    expect(useRouteEditStore.getState().isComputing).toBe(false);
  });
});
