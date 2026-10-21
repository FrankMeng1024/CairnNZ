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

  test('Run Cairn delegates to full Plant with the exact Activity owner and no direct blank commit', () => {
    const source = read('RunningScreen.tsx');
    const handoff = source.indexOf("nav.navigate('Plant', {");
    const origin = source.indexOf("kind: 'activity',", handoff);
    const activityId = source.indexOf('clientActivityId: sessionId,', origin);
    const generation = source.indexOf('ownerGeneration: liveOwnerGeneration,', activityId);
    const mode = source.indexOf("activityMode: 'running',", generation);

    expect(handoff).toBeGreaterThan(-1);
    expect(origin).toBeGreaterThan(handoff);
    expect(activityId).toBeGreaterThan(origin);
    expect(generation).toBeGreaterThan(activityId);
    expect(mode).toBeGreaterThan(generation);
    expect(source).not.toContain('handlePlantCairn');
    expect(source).not.toContain('quickCairnGateRef');
    expect(source).not.toContain('executeCairnCommit');
    expect(source).not.toContain('addMarker({');
  });
});
