import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('shared Memory authority initialization', () => {
  test('authenticated app lifecycle starts local persistence, sync and a server reconcile', () => {
    const appRoot = read('App.tsx');
    const authorityStart = appRoot.indexOf('// O41: one account-scoped Memory authority');
    const authorityEffectStart = appRoot.indexOf('useEffect(() => {', authorityStart);
    const authorityBranch = appRoot.slice(
      authorityStart,
      appRoot.indexOf('useEffect(() => {', authorityEffectStart + 1),
    );
    expect(authorityBranch).toContain('if (!isLoggedIn || !simulatorOwnerUserId) return');
    expect(authorityBranch).toContain('await hydrateMemoryForUser(userId)');
    expect(authorityBranch).toContain('attachMemorySync(userId)');
    expect(authorityBranch).toContain("pullMemoryFromServer(userId, { reconcile: true })");
    expect(authorityBranch).not.toContain('await pullMemoryFromServer');
    expect(read('src/store/useAppStore.ts')).not.toContain('await hydrateMemoryForUser(user.id)');
  });

  test('Memory screen lifecycle cannot initialize or detach the shared point authority', () => {
    const manager = read('src/features/memory/components/ForegroundUnlockManager.tsx');
    expect(manager).not.toContain('pullMemoryFromServer');
    expect(manager).not.toContain('hydrateMemoryForUser');
    expect(manager).not.toContain('detachMemoryPersistence');
    expect(manager).not.toContain('detachMemorySync');
  });

  test('returning focus explicitly reacquires Memory viewport coverage after authorization', () => {
    const screen = read('src/features/memory/screens/MemoryScreen.tsx');
    expect(screen).toContain('let focusActive = true;');
    expect(screen).toContain('const memoryViewport = mapRef.current?.getCoverageViewport();');
    expect(screen).toContain('usePreparedMemoryCoverageStore.getState().loadViewport(memoryViewport)');
    expect(screen).toContain('useFriendMemoryStore.getState().loadSelectedProjections(undefined, memoryViewport)');
    expect(screen).toContain('focusActive = false;');
    expect(screen).toContain("if (!focusActive || authorityLoaded === false\n          || String(useAppStore.getState().user?.id ?? '') !== ownerId) return;");
    expect(screen.indexOf('focusActive = false;')).toBeGreaterThan(screen.indexOf('loadSelectedProjections(undefined, memoryViewport)'));
    const map = read('src/features/memory/components/MemoryMap.tsx');
    expect(map).toContain('getCoverageViewport: () => coverageViewportRef.current');
  });

  test('an authoritative empty Memory snapshot invalidates cached fog geometry', () => {
    const fogLayer = read('src/features/memory/components/FogLayer.tsx');
    const emptyBranchStart = fogLayer.lastIndexOf('if (coverageReadReady && !hasAnyEvidence)');
    const emptyBranch = fogLayer.slice(
      emptyBranchStart,
      fogLayer.indexOf('if (!authorityChanged && lastSigRef.current', emptyBranchStart),
    );
    expect(emptyBranch).toContain('_moduleFogSig = contentSignature');
    expect(emptyBranch).toContain('_moduleFogShape = solid');
    expect(emptyBranch).toContain('_moduleEvidenceShape = null');
    expect(emptyBranch).toContain('_moduleDisplayGeometryCache = null');
    expect(emptyBranch).not.toContain('return lastShapeRef.current');
  });
});
