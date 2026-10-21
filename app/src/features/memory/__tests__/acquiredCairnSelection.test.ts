import { createAcquiredCairnSelectionController } from '../components/acquiredCairnSelection';

function single(markerId: string) {
  return { features: [{ properties: { markerId }, geometry: { coordinates: [121.4, 31.2] } }] };
}

function cluster(id: string, count = 2) {
  return { features: [{ id, properties: { point_count: count }, geometry: { coordinates: [121.4, 31.2] } }] };
}

function leaves(prefix: string) {
  return [0, 1].map(index => ({
    properties: { markerId: `${prefix}-${index + 1}` },
    geometry: { coordinates: [121.4, 31.2] },
  }));
}

describe('latest acquired-Cairn map selection wins', () => {
  test('delayed cluster A cannot open after a newer single B', async () => {
    const controller = createAcquiredCairnSelectionController();
    let resolveA!: (value: any) => void;
    const source = {
      getClusterLeaves: jest.fn(() => new Promise(resolve => { resolveA = resolve; })),
    };
    const opened: string[] = [];
    const callbacks = {
      currentViewerId: () => 'viewer-a',
      onOpenSingle: (id: string) => opened.push(`single:${id}`),
      onOpenGroup: (ids: string[]) => opened.push(`group:${ids.join(',')}`),
      onExpandCluster: jest.fn(),
      onClusterError: jest.fn(),
    };
    const pendingA = controller.select(cluster('A'), source, 'viewer-a', callbacks);
    await Promise.resolve();
    await controller.select(single('B'), source, 'viewer-a', callbacks);
    resolveA({ features: leaves('A') });
    await pendingA;

    expect(opened).toEqual(['single:B']);
    expect(callbacks.onClusterError).not.toHaveBeenCalled();
  });

  test('delayed cluster A cannot open after a newer cluster B', async () => {
    const controller = createAcquiredCairnSelectionController();
    let resolveA!: (value: any) => void;
    const source = {
      getClusterLeaves: jest.fn((feature: any) => feature.id === 'A'
        ? new Promise(resolve => { resolveA = resolve; })
        : Promise.resolve({ features: leaves('B') })),
    };
    const groups: string[][] = [];
    const callbacks = {
      currentViewerId: () => 'viewer-a',
      onOpenSingle: jest.fn(),
      onOpenGroup: (ids: string[]) => groups.push(ids),
      onExpandCluster: jest.fn(),
      onClusterError: jest.fn(),
    };
    const pendingA = controller.select(cluster('A'), source, 'viewer-a', callbacks);
    await Promise.resolve();
    await controller.select(cluster('B'), source, 'viewer-a', callbacks);
    resolveA({ features: leaves('A') });
    await pendingA;
    expect(groups).toEqual([['B-1', 'B-2']]);
  });

  test.each(['back/dismiss', 'theme or source generation'])('%s invalidates loading selection', async () => {
    const controller = createAcquiredCairnSelectionController();
    let resolveA!: (value: any) => void;
    const source = { getClusterLeaves: () => new Promise(resolve => { resolveA = resolve; }) };
    const callbacks = {
      currentViewerId: () => 'viewer-a',
      onOpenSingle: jest.fn(), onOpenGroup: jest.fn(), onExpandCluster: jest.fn(), onClusterError: jest.fn(),
    };
    const pending = controller.select(cluster('A'), source, 'viewer-a', callbacks);
    await Promise.resolve();
    controller.invalidate();
    resolveA({ features: leaves('A') });
    await pending;
    expect(callbacks.onOpenGroup).not.toHaveBeenCalled();
    expect(callbacks.onClusterError).not.toHaveBeenCalled();
  });

  test('account switch and stale failure cannot issue camera, sheet, or fallback work', async () => {
    const controller = createAcquiredCairnSelectionController();
    let rejectA!: (reason: Error) => void;
    let viewer = 'viewer-a';
    const source = { getClusterLeaves: () => new Promise((_resolve, reject) => { rejectA = reject; }) };
    const callbacks = {
      currentViewerId: () => viewer,
      onOpenSingle: jest.fn(), onOpenGroup: jest.fn(), onExpandCluster: jest.fn(), onClusterError: jest.fn(),
    };
    const pending = controller.select(cluster('A'), source, 'viewer-a', callbacks);
    await Promise.resolve();
    viewer = 'viewer-b';
    rejectA(new Error('leaf request failed'));
    await pending;
    expect(callbacks.onOpenSingle).not.toHaveBeenCalled();
    expect(callbacks.onOpenGroup).not.toHaveBeenCalled();
    expect(callbacks.onExpandCluster).not.toHaveBeenCalled();
    expect(callbacks.onClusterError).not.toHaveBeenCalled();
  });
});
