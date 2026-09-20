import fs from 'fs';
import path from 'path';

const read = (name: string) => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');

describe('normal Personal Cairn commit single-flight boundary', () => {
  test('full Plant uses the shared synchronous gate and retains it after durable acceptance', () => {
    const source = read('PlantScreen.tsx');
    const transaction = source.indexOf('return executeCairnCommit({');
    const gate = source.indexOf('gate: commitGateRef.current,', transaction);
    const durableCommit = source.indexOf('return addMarker({', gate);
    const terminalLock = source.indexOf('releaseOnCommittedCurrent: false,', durableCommit);

    expect(transaction).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(transaction);
    expect(durableCommit).toBeGreaterThan(gate);
    expect(terminalLock).toBeGreaterThan(durableCommit);
    expect(source.slice(durableCommit, terminalLock)).toContain('activityContext,');
    expect(source.slice(transaction, durableCommit)).toContain('isContextCurrent: contextIsCurrent');
  });

  test('Run Quick Cairn uses the shared gate, exact late link, and visible busy state', () => {
    const source = read('RunningScreen.tsx');
    const handler = source.indexOf('async function handlePlantCairn()');
    const transaction = source.indexOf('await executeCairnCommit({', handler);
    const gate = source.indexOf('gate: quickCairnGateRef.current,', transaction);
    const durableCommit = source.indexOf('return addMarker({', gate);
    const exactLink = source.indexOf('linkMarker(result.marker.id, activityContext)', durableCommit);
    const release = source.indexOf('releaseOnCommittedCurrent: true,', exactLink);

    expect(handler).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(handler);
    expect(gate).toBeGreaterThan(transaction);
    expect(durableCommit).toBeGreaterThan(gate);
    expect(exactLink).toBeGreaterThan(durableCommit);
    expect(release).toBeGreaterThan(exactLink);
    expect(source.slice(durableCommit, exactLink)).toContain('activityContext,');
    expect(source).toContain('cairnDisabled={!locationAvailable || quickCairnInFlight}');
  });
});
