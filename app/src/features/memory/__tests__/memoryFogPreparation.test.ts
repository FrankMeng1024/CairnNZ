import {
  memoryFogPreparationInFlightForTest,
  runSharedMemoryFogPreparation,
} from '../services/memoryFogPreparation';

describe('Memory Fog background preparation coordination', () => {
  test('Home does not reintroduce the legacy full-history Fog prewarm', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../screens/HomeScreen.tsx'), 'utf8');
    expect(source).not.toContain('InteractionManager.runAfterInteractions');
    expect(source).not.toContain("import('../features/memory/components/FogLayer')");
    expect(source).not.toContain('runSharedMemoryFogPreparation');
    expect(source).not.toContain('buildTiledMemoryDisplayEvidence');
    expect(source).not.toContain('writeFogDisplayCache');
  });

  test('Home and visible Memory join the exact same account/content job', async () => {
    let release!: (value: string) => void;
    const task = jest.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const home = runSharedMemoryFogPreparation('account-a', 'signature-1', task);
    const memory = runSharedMemoryFogPreparation('account-a', 'signature-1', task);
    await Promise.resolve();

    expect(memory).toBe(home);
    expect(task).toHaveBeenCalledTimes(1);
    expect(memoryFogPreparationInFlightForTest('account-a', 'signature-1')).toBe(true);
    release('prepared');
    await expect(memory).resolves.toBe('prepared');
    expect(memoryFogPreparationInFlightForTest('account-a', 'signature-1')).toBe(false);
  });

  test('different accounts or content signatures cannot share work', async () => {
    const task = jest.fn(async () => 'done');
    await Promise.all([
      runSharedMemoryFogPreparation('account-a', 'signature-1', task),
      runSharedMemoryFogPreparation('account-b', 'signature-1', task),
      runSharedMemoryFogPreparation('account-a', 'signature-2', task),
    ]);
    expect(task).toHaveBeenCalledTimes(3);
  });

  test('visible Memory retries once when a joined prewarm was fenced empty', async () => {
    let cancelPrewarm!: (value: null) => void;
    const prewarm = runSharedMemoryFogPreparation(
      'account-a',
      'signature-cancelled',
      () => new Promise<null>(resolve => { cancelPrewarm = resolve; }),
    );
    const visibleTask = jest.fn(async () => 'visible-prepared');
    const visible = runSharedMemoryFogPreparation(
      'account-a',
      'signature-cancelled',
      visibleTask,
      { retryAfterEmpty: true },
    );
    await Promise.resolve();
    cancelPrewarm(null);

    await expect(prewarm).resolves.toBeNull();
    await expect(visible).resolves.toBe('visible-prepared');
    expect(visibleTask).toHaveBeenCalledTimes(1);
  });
});
import fs from 'node:fs';
import path from 'node:path';
