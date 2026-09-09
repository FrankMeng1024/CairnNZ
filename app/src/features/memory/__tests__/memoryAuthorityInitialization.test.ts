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

  test('an authoritative empty Memory snapshot invalidates cached fog geometry', () => {
    const fogLayer = read('src/features/memory/components/FogLayer.tsx');
    const emptyBranchStart = fogLayer.lastIndexOf('if (points.length === 0)');
    const emptyBranch = fogLayer.slice(
      emptyBranchStart,
      fogLayer.indexOf('// v356: content-hash short-circuit', emptyBranchStart),
    );
    expect(emptyBranch).toContain("_moduleFogSig = ''");
    expect(emptyBranch).toContain('_moduleFogShape = solidFog');
    expect(emptyBranch).not.toContain('return lastShapeRef.current');
  });
});
