import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Memory fog readiness authority', () => {
  test('Cairns cannot be revealed by a timer or a previous account/mount', () => {
    const map = read('src/features/memory/components/MemoryMap.tsx');
    const screen = read('src/features/memory/screens/MemoryScreen.tsx');

    expect(map).toContain('{fogReady && pinsAuthorityReady && (');
    expect(map).not.toMatch(/setTimeout\(\(\) => setFogReady/);
    expect(map).toContain('onDidFinishRenderingFrameFully');
    expect(map).toContain('fogGeometryReadyKeyRef.current !== readinessKey');
    expect(map).toContain('localHydration.ownerUserId === activeAccountId');
    expect(map).toContain("localHydration.initialReconcile === 'success'");
    expect(screen).not.toContain('_fogEverReady');
    expect(screen).toContain('onFogReady={() =>');
  });

  test('revision-only authority changes rerun and stale-filter cache and geometry work', () => {
    const fog = read('src/features/memory/components/FogLayer.tsx');
    expect(fog).toContain('localHydration.initialReconcile');
    expect(fog).toContain('readinessKeyRef.current !== readinessKey');
    expect(fog).toMatch(/localHydrationReady, readinessKey\]\);/);
    expect(fog).toMatch(/points, readinessKey\]\);/);
    expect(fog).toContain('onFogUnavailableRef.current?.(readinessKey)');
  });

  test('durable Memory can center the map without claiming a live position puck', () => {
    const screen = read('src/features/memory/screens/MemoryScreen.tsx');
    const map = read('src/features/memory/components/MemoryMap.tsx');
    expect(screen).toContain('const ownedEvidenceCenter = useMemo<FixState | null>');
    expect(screen).toContain('localHydration.ownerUserId !== activeOwnerId');
    expect(screen).toContain('const nextMapCenter = stableCoord ?? ownedEvidenceCenter');
    expect(screen).toContain('showUserLocation={Boolean(stableCoord)}');
    expect(map).toContain('{showUserLocation ? <UserLocation');
  });

  test('same-authority rebuilds retain prior fog and web emits the correlated paint callback', () => {
    const fog = read('src/features/memory/components/FogLayer.tsx');
    const web = read('src/features/memory/services/mapboxAdapter.web.tsx');
    expect(fog).toContain('sameAuthorityShape ?? solidFogShape()');
    expect(fog).toContain('fog.display_cache_read_failed');
    expect(fog).toContain('fog.display_cache_write_failed');
    expect(web).toContain('onDidFinishRenderingFrameFully?: () => void;');
    expect(web).toContain('onDidFinishRenderingFrameFully?.();');
  });
});
