import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const repoRoot = path.resolve(appRoot, '..');
const readApp = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');
const readRepo = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('Memory session recovery red/green source contracts', () => {
  test('camera commands never own the shared coverage loader', () => {
    const map = readApp('src/features/memory/components/MemoryMap.tsx');
    expect(map).not.toContain("onCameraTransitionState?.('loading')");
  });

  test('camera viewport is excluded from authoritative Fog content identity', () => {
    const fog = readApp('src/features/memory/components/FogLayer.tsx');
    expect(fog).not.toContain("|viewport:${viewport?.key ?? 'legacy'}|mine:");
  });

  test('computed empty Mine-only coverage never falls back to complete Mine', () => {
    const fog = readApp('src/features/memory/components/FogLayer.tsx');
    expect(fog).not.toContain('combined?.mineEvidence ?? selfEvidence');
  });

  test('cached Fog reuse requires the exact requested scope and selection', () => {
    const fog = readApp('src/features/memory/components/FogLayer.tsx');
    expect(fog).toContain('memoryFogSceneMatchesSelection({');
    expect(fog).toContain('const exactCachedAuthority =');
    const exactCacheBlock = fog.slice(
      fog.indexOf('const exactCachedAuthority ='),
      fog.indexOf('const retainedAuthorizedCombinedScene ='),
    );
    expect(exactCacheBlock).toContain('memoryFogSceneMatchesSelection({');
  });

  test('child navigation focus does not clear manual camera guards', () => {
    const screen = readApp('src/features/memory/screens/MemoryScreen.tsx');
    const focusBlock = screen.slice(screen.indexOf('useFocusEffect('), screen.indexOf('// R4 + S1'));
    expect(focusBlock).not.toContain('manualBrowseThisMountRef.current = false');
    expect(focusBlock).not.toContain('currentCityAppliedRef.current = null');
    expect(focusBlock).toContain('returningToRetainedSession');
    expect(focusBlock).toContain('manualBrowseThisMountRef.current = true');
    expect(focusBlock).toContain('activeSession.camera');
  });

  test('Route location dot explicitly renders above its own ring', () => {
    const route = readApp('src/screens/OrderedRouteEditorScreen.tsx');
    const dot = route.slice(route.indexOf('id="ordered-route-user-location-dot"'), route.indexOf('id="ordered-route-user-location-dot"') + 650);
    expect(dot).toContain('aboveLayerID="ordered-route-user-location-ring"');
  });

  test('Friend snapshot 409 parses AUTHORIZATION_CHANGED before generic status mapping', () => {
    const store = readApp('src/features/memory/store/useFriendMemoryStore.ts');
    expect(store).toContain("payload?.code === 'AUTHORIZATION_CHANGED'");
  });

  test('backend supplies epoch-bound snapshot proof renewal without source-list scans', () => {
    const route = readRepo('backend/src/routes/friend-sharing.js');
    expect(route).toContain("router.post('/coverage-proof-renewal'");
    expect(route).toContain('grant_epoch: grant.grant_epoch');
    expect(route).toContain('friendship_episode_id: String(grant.friendship_episode_id)');
  });
});
