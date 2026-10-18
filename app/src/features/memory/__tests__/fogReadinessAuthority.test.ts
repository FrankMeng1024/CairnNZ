import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Memory fog readiness authority', () => {
  test('Cairns cannot be revealed by a timer or a previous account/mount', () => {
    const map = read('src/features/memory/components/MemoryMap.tsx');
    const fog = read('src/features/memory/components/FogLayer.tsx');
    const screen = read('src/features/memory/screens/MemoryScreen.tsx');

    expect(map).toContain('{fogReady && pinsAuthorityReady && (');
    expect(map).not.toMatch(/setTimeout\(\(\) => setFogReady/);
    expect(map).toContain('onDidFinishRenderingFrameFully');
    expect(map).toContain('fogGeometryReadyKeyRef.current !== readinessKey');
    expect(map).toContain('memoryFogPaintEvidenceReady({');
    expect(map).toContain('renderedProbe(layerIds, readinessKey)');
    expect(map).toContain('A timer is not paint evidence.');
    expect(map).not.toContain('confirmCurrentFogPaintRef.current();');
    expect(map).toContain('fogReadinessKeyRef.current === expectedKey');
    expect(fog).toContain("displayedFogShape.properties?.cairnReadinessKey ?? 'pending'");
    expect(fog).toContain('id="memory-fog-src"');
    expect(map).toContain('localHydration.ownerUserId === activeAccountId');
    expect(map).toContain("localHydration.initialReconcile === 'success'");
    expect(screen).not.toContain('_fogEverReady');
    expect(screen).toContain('onFogReady={() =>');
  });

  test('content changes stale-filter async work while hydration bookkeeping cannot invalidate painted fog', () => {
    const fog = read('src/features/memory/components/FogLayer.tsx');
    expect(fog).toContain('readinessKeyRef.current !== readinessKey');
    expect(fog).toContain('preparedMemoryStatus !== \'error\'');
    expect(fog).toContain('const presentationKey = `${authority}|${contentSignature}`');
    expect(fog).toContain("const readinessKey = `${presentationKey}|authority-ready:${fogAuthorityReady ? 'yes' : 'no'}`");
    expect(fog).toContain('onFogPreparingRef.current?.(presentationKey)');
    expect(fog).toContain('onFogUnavailableRef.current?.(presentationKey)');
    expect(fog).toContain('onFogReadyRef.current(presentationKey');
    expect(fog).not.toMatch(/readinessKey = .*localHydration\.revision/);
  });

  test('durable Memory can center the map without claiming a live position puck', () => {
    const screen = read('src/features/memory/screens/MemoryScreen.tsx');
    const map = read('src/features/memory/components/MemoryMap.tsx');
    expect(screen).toContain('const ownedEvidenceForCamera = useMemo(() =>');
    expect(screen).toContain('localHydration.ownerUserId !== activeOwnerId');
    expect(screen).toContain('const cachedMemoryCenter = useMemo(');
    expect(screen).toContain('const nextMapCenter = resolveMemoryInitialMapCenter({');
    expect(screen).toContain('cachedMemoryCenter,');
    expect(screen).toContain('showUserLocation={Boolean(stableCoord)}');
    expect(map).toContain('{showUserLocation ? <UserLocation');
  });

  test('same-authority rebuilds retain prior fog and web emits the correlated paint callback', () => {
    const fog = read('src/features/memory/components/FogLayer.tsx');
    const web = read('src/features/memory/services/mapboxAdapter.web.tsx');
    expect(fog).toContain('sameAuthorityShape ?? mineFallbackShape ?? solidFogShape()');
    expect(fog).toContain('_moduleSelfFogShape');
    expect(fog).toContain('fog.display_cache_read_failed');
    expect(fog).toContain('fog.display_cache_write_failed');
    expect(web).toContain('onDidFinishRenderingFrameFully?: () => void;');
    expect(web).toContain('onDidFinishRenderingFrameFully?.();');
    expect(fog).toMatch(/const displayedFogShape = authoritativeEmpty\s+\? sameAuthorityShape \?\? solidFogShape\(\)/);
  });

  test('the first Friends transition retains exact Mine fog while authorized union geometry builds', () => {
    const fog = read('src/features/memory/components/FogLayer.tsx');
    expect(fog).toMatch(/const reusableCachedSelf = !syntheticQaAuthority\s+&& _moduleSelfAccount/);
    expect(fog).not.toMatch(/const reusableCachedSelf[\s\S]{0,140}friendCells\.length === 0/);
    expect(fog).toMatch(/const mineFallbackShape = !syntheticQaAuthority\s+&& _moduleSelfAccount/);
    expect(fog).not.toMatch(/const mineFallbackShape[\s\S]{0,140}friendCells\.length === 0/);
    expect(fog).toContain('sameAuthorityShape ?? mineFallbackShape ?? solidFogShape()');
    expect(fog).toMatch(/if \(friendGeometries\.length === 0\s+&& _moduleFogAuthority === authority/);
  });
});
