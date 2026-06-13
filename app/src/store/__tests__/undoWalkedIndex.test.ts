/**
 * undoWalkedIndex.test.ts — verify v6.3 plan §3 bug #1 fix.
 *
 * Pre-v6.3 behavior: undo restored matchedPoints + brushStrokes but did
 * NOT rebuild walkedIndex. Subsequent endpoint-snap and corridor checks
 * ran against stale post-edit geometry — root cause of the PO snap122
 * "reset 后画到旁边也接受" class of bugs.
 *
 * v6.3: undo MUST rebuild walkedIndex around the restored matched line.
 *
 * Plan §6.1 spec: "undo / reset 后 walkedIndex 重建,nearest 查询匹配
 *                  last.matchedPoints"
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

import { useRouteEditStore } from '../useRouteEditStore';
import { PointCloudIndex } from '../../services/routing/corridor/PointCloudIndex';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

function originalLine(): LngLat[] {
  // 1km east at NZ lat with ~10m resolution.
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

/** Inject a synthetic editing session into the store. */
function attachSession(opts: {
  originalPoints: LngLat[];
  matchedPoints: LngLat[];
  undoStack?: Array<{
    brushStrokes: any[];
    trimStartFrac: number;
    trimEndFrac: number;
    matchedPoints: LngLat[];
  }>;
}): void {
  useRouteEditStore.setState({
    sessionId: 's1',
    routeId: 'r1',
    originalPoints: opts.originalPoints,
    matchedPoints: opts.matchedPoints,
    workingPoints: opts.matchedPoints.slice(),
    walkedIndex: buildWalkedIndex(opts.matchedPoints),
    undoStack: opts.undoStack ?? [],
    isOpen: true,
  });
}

beforeEach(() => {
  // Reset store to pristine state.
  useRouteEditStore.setState((s) => ({
    ...s,
    isOpen: false,
    isSaving: false,
    isComputing: false,
    sessionId: null,
    routeId: null,
    originalPoints: [],
    matchedPoints: [],
    workingPoints: [],
    brushStrokes: [],
    undoStack: [],
    walkedIndex: null,
    activeStrokeId: null,
    hasCommittedEdit: false,
    previewMatchedPoints: null,
    previewIsCurrent: true,
    validationErrors: [],
    trimStartFrac: 0,
    trimEndFrac: 1,
    editOpSeq: 0,
    editCount: 0,
    lastError: null,
    lastWarning: null,
  }));
});

describe('undo walkedIndex rebuild (v6.3 plan §3 bug #1)', () => {
  test('after undo, walkedIndex.nearest matches restored matchedPoints', () => {
    const store = useRouteEditStore;
    const orig = originalLine();
    // Simulate "post-Preview-commit" state — matchedPoints diverged from orig.
    const postEdit: LngLat[] = orig.map((p) => ({
      lng: p.lng + 0.0005, // ~50m offset throughout
      lat: p.lat,
    }));
    attachSession({
      originalPoints: orig,
      matchedPoints: postEdit,
      undoStack: [
        {
          brushStrokes: [],
          trimStartFrac: 0,
          trimEndFrac: 1,
          matchedPoints: orig,
        },
      ],
    });

    // Trigger undo.
    store.getState().undo();

    // After undo: walkedIndex rebuilt around orig (the restored matched line).
    const idxAfter = store.getState().walkedIndex;
    expect(idxAfter).not.toBeNull();
    if (!idxAfter) return; // appease TS
    // Querying near orig[50] — should now hit a point essentially ON orig[50].
    const nearestPost = idxAfter.nearest(orig[50].lng, orig[50].lat, 1);
    const pointPost = idxAfter.get(nearestPost[0]);
    expect(pointPost).toBeDefined();
    if (pointPost) {
      // Point should be at orig coords (within haversine micro-noise).
      expect(pointPost.lng).toBeCloseTo(orig[50].lng, 5);
      expect(pointPost.lat).toBeCloseTo(orig[50].lat, 5);
    }
  });

  test('undo also clears lastWarning and activeStrokeId', () => {
    const store = useRouteEditStore;
    const orig = originalLine();
    attachSession({
      originalPoints: orig,
      matchedPoints: orig,
      undoStack: [
        {
          brushStrokes: [],
          trimStartFrac: 0,
          trimEndFrac: 1,
          matchedPoints: orig,
        },
      ],
    });
    // Plant lastWarning + activeStrokeId from a prior op.
    useRouteEditStore.setState({
      lastWarning: 'something stale',
      activeStrokeId: 'old-stroke-id',
    });
    store.getState().undo();
    expect(store.getState().lastWarning).toBeNull();
    expect(store.getState().activeStrokeId).toBeNull();
  });

  test('resetEdits rebuilds walkedIndex around originalPoints', () => {
    const store = useRouteEditStore;
    const orig = originalLine();
    const postEdit: LngLat[] = orig.map((p) => ({
      lng: p.lng + 0.0005,
      lat: p.lat,
    }));
    attachSession({
      originalPoints: orig,
      matchedPoints: postEdit,
    });
    store.getState().resetEdits();
    const idx = store.getState().walkedIndex;
    expect(idx).not.toBeNull();
    if (!idx) return;
    const nearest = idx.nearest(orig[50].lng, orig[50].lat, 1);
    const p = idx.get(nearest[0]);
    expect(p).toBeDefined();
    if (p) {
      expect(p.lng).toBeCloseTo(orig[50].lng, 5);
      expect(p.lat).toBeCloseTo(orig[50].lat, 5);
    }
    expect(store.getState().matchedPoints).toEqual(orig);
    expect(store.getState().lastWarning).toBeNull();
    expect(store.getState().activeStrokeId).toBeNull();
  });
});
