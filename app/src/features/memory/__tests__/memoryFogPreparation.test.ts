import {
  memoryFogPreparationInFlightForTest,
  runSharedMemoryFogPreparation,
} from '../services/memoryFogPreparation';

describe('Memory Fog background preparation coordination', () => {
  test('Home schedules cancellable Mine-only work after interactions without mounting a map or emitting UX', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../screens/HomeScreen.tsx'), 'utf8');
    const preparation = source.slice(source.indexOf('// Prepare only the account-scoped Mine geometry'), source.indexOf('// The bounded registry'));
    expect(preparation).toContain('InteractionManager.runAfterInteractions');
    expect(preparation).toContain('setTimeout(() => {');
    expect(preparation).toContain('}, 600);');
    expect(preparation).toContain("import('../features/memory/components/FogLayer')");
    expect(preparation).toContain('runSharedMemoryFogPreparation');
    expect(preparation).toContain('cancelledBeforeStart');
    expect(preparation).toContain('useMemoryStore.getState().geometryVersion !== geometryVersion');
    expect(preparation).toContain("transitionState !== 'idle'");
    expect(preparation).not.toContain('<MapView');
    expect(preparation).not.toContain('Toast');
    expect(preparation).not.toContain('getCurrentPosition');
    expect(preparation).not.toContain('friend-sharing/projections');
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
