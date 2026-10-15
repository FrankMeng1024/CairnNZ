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

const mockMatchSegment = jest.fn();
jest.mock('../../services/routing/mapmatch/MapMatchingClient', () => ({
  matchSegment: (...args: unknown[]) => mockMatchSegment(...args),
}));

import type { LngLat } from '../../services/routing/corridor/PolylineSampler';
import { PointCloudIndex } from '../../services/routing/corridor/PointCloudIndex';
import { routeDrawingDistanceM } from '../../features/routeDrawing/routeDrawingIntent';
import { useRouteEditStore } from '../useRouteEditStore';

const ORIGIN: LngLat = { lng: 174.764, lat: -36.848 };
function point(eastM: number, northM: number): LngLat {
  return {
    lng: ORIGIN.lng + eastM / (111_000 * Math.cos(ORIGIN.lat * Math.PI / 180)),
    lat: ORIGIN.lat + northM / 111_000,
  };
}

function index(points: LngLat[]): PointCloudIndex {
  return new PointCloudIndex(points.map((p, i) => ({
    ...p, source: 'original' as const, refId: `route:${i}`,
  })));
}

beforeEach(() => {
  mockMatchSegment.mockReset();
  useRouteEditStore.setState({
    sessionId: 'route-drawing-test',
    routeId: 'route-v',
    isOpen: true,
    editOpSeq: 1,
    brushStrokes: [],
    trimStartFrac: 0,
    trimEndFrac: 1,
    activeTool: 'pan',
    activeStrokeId: null,
    hasCommittedEdit: false,
    previewMatchedPoints: null,
    previewIsCurrent: false,
    committedDraft: null,
    undoStack: [],
    isComputing: false,
    isSaving: false,
    lastError: null,
    lastWarning: null,
    validationErrors: [],
    drawingViewport: {
      width: 390, height: 844, center: ORIGIN, zoom: 16, bearing: 0, pitch: 0,
    },
  });
});

describe('production Route drawing integration', () => {
  test('runPreview removes a V apex even when the provider returns it', async () => {
    const apex = point(50, 75);
    const original = [point(0, 0), apex, point(100, 0)];
    const raw = [point(0, 0), point(25, 1), point(50, -1), point(75, 1), point(100, 0)];
    const provider = [point(0, 0), point(48, 72), point(100, 0)];
    useRouteEditStore.setState({
      originalPoints: original,
      matchedPoints: original,
      workingPoints: original,
      walkedIndex: index(original),
      brushStrokes: [{ id: 'stroke-v', points: raw, rawPoints: raw }],
    });
    mockMatchSegment.mockResolvedValue({
      ok: true,
      matchedPoints: provider,
      confidence: 0.94,
      segments: [{ points: provider, confidence: 0.94 }],
      durationMs: 4,
    });

    await expect(useRouteEditStore.getState().runPreview()).resolves.toEqual({ ok: true });
    const result = useRouteEditStore.getState().matchedPoints;
    expect(result.some(candidate => routeDrawingDistanceM(candidate, apex) < 20)).toBe(false);
    expect(useRouteEditStore.getState().undoStack.length).toBeGreaterThan(0);
  });

  test('Point continues the raw Draw geometry without retaining a magnet connector kink', () => {
    const original = [point(0, 0), point(140, 0)];
    const rawDraw = [point(0, 0), point(35, 1), point(70, 0)];
    const displayMagnet = point(72, 8);
    useRouteEditStore.setState({
      originalPoints: original,
      matchedPoints: original,
      workingPoints: original,
      walkedIndex: index(original),
      activeTool: 'point',
      brushStrokes: [{
        id: 'mixed-tool',
        rawPoints: rawDraw,
        points: [...rawDraw, displayMagnet],
      }],
    });

    const pointTap = point(105, 1);
    useRouteEditStore.getState().addPoint(pointTap);
    const continued = useRouteEditStore.getState().brushStrokes[0];
    expect(continued.points).toEqual([...rawDraw, pointTap]);
    expect(continued.rawPoints).toEqual([...rawDraw, pointTap]);
    expect(continued.points).not.toContain(displayMagnet);
    expect(useRouteEditStore.getState().undoStack).toHaveLength(1);
  });
});
