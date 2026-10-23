import { memoryCameraAtTarget, memoryCameraCenterFromEvent } from '../services/memoryCameraTransition';
import fs from 'node:fs';
import path from 'node:path';

describe('cross-region Memory camera readiness', () => {
  test('a stale Shanghai frame cannot satisfy a Kuala Lumpur destination', () => {
    const kualaLumpur: [number, number] = [101.6869, 3.1390];
    expect(memoryCameraAtTarget(kualaLumpur, [121.4737, 31.2304])).toBe(false);
    expect(memoryCameraAtTarget(kualaLumpur, [101.6872, 3.1392])).toBe(true);
  });

  test('installed Mapbox terminal events own completion without a wall-clock slow verdict', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../components/MemoryMap.tsx'), 'utf8');
    expect(source).toContain("settlePendingCameraFromMap('map-loaded')");
    expect(source).toContain("settlePendingCameraFromMap('frame-fully-rendered')");
    expect(source).toContain("settlePendingCameraAtCenter([Number(center[0]), Number(center[1])], 'map-idle')");
    expect(source).toContain('renderedCameraCenterRef.current = [Number(c[0]), Number(c[1])]');
    expect(source).not.toContain('pendingFlySlowTimerRef');
    expect(source).not.toContain("onCameraTransitionState?.('slow')");
  });

  test('accepts both native and Web Mapbox camera event shapes', () => {
    expect(memoryCameraCenterFromEvent({ properties: { center: [101.6869, 3.1390] } }))
      .toEqual([101.6869, 3.1390]);
    expect(memoryCameraCenterFromEvent({ geometry: { coordinates: [174.779, -41.286] } }))
      .toEqual([174.779, -41.286]);
    expect(memoryCameraCenterFromEvent({ geometry: { coordinates: ['bad', 1] } })).toBeNull();
  });
});
