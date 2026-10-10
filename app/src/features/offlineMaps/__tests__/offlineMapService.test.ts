import { OfflineMapService, type OfflineManagerBridge } from '../offlineMapService';

function managerFixture() {
  const packs = new Map<string, any>();
  const manager: jest.Mocked<OfflineManagerBridge> = {
    createPack: jest.fn(async (options, progress) => {
      const pack = {
        name: options.name,
        metadata: options.metadata,
        status: async () => ({ name: options.name, state: 1, percentage: 100, completedResourceSize: 2048, completedTileCount: 8, completedResourceCount: 10, requiredResourceCount: 10 }),
        pause: jest.fn(async () => undefined),
        resume: jest.fn(async () => undefined),
      };
      packs.set(options.name, pack);
      progress(pack, { name: options.name, state: 0, percentage: 20, completedResourceSize: 512 });
    }),
    getPacks: jest.fn(async () => [...packs.values()]),
    getPack: jest.fn(async name => packs.get(name)),
    deletePack: jest.fn(async name => { packs.delete(name); }),
    invalidatePack: jest.fn(async (_name: string) => undefined),
    unsubscribe: jest.fn(),
    setProgressEventThrottle: jest.fn(),
  };
  return { manager, packs };
}

describe('OfflineMapService', () => {
  test('creates a bounded versioned pack and reports native bytes', async () => {
    const { manager } = managerFixture();
    const service = new OfflineMapService(manager);
    const progress = jest.fn();
    const name = await service.create({ center: { lat: -41.28, lng: 174.77 }, radiusKm: 5 }, progress, jest.fn(), 123456);
    expect(name).toBe('cairn-offline-v1-2n9c');
    expect(manager.setProgressEventThrottle).toHaveBeenCalledWith(1000);
    expect(manager.createPack).toHaveBeenCalledWith(expect.objectContaining({
      name,
      styleURL: expect.stringMatching(/^mapbox:\/\//),
      minZoom: 10,
      maxZoom: 15,
      metadata: expect.objectContaining({ owner: 'cairn-device', radiusKm: 5, createdAt: 123456 }),
    }), expect.any(Function), expect.any(Function));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ name, percentage: 20, completedResourceSize: 512 }));
    expect((await service.list())[0]).toEqual(expect.objectContaining({ name, percentage: 100, completedResourceSize: 2048 }));
  });

  test('pause, resume, refresh and remove act only on Cairn-owned packs', async () => {
    const { manager } = managerFixture();
    const service = new OfflineMapService(manager);
    const name = await service.create({ center: { lat: 0, lng: 0 }, radiusKm: 2 }, jest.fn(), jest.fn(), 1000);
    const pack = await manager.getPack(name);
    await service.pause(name);
    await service.resume(name);
    await service.refresh(name);
    await service.remove(name);
    expect(pack?.pause).toHaveBeenCalledTimes(1);
    expect(pack?.resume).toHaveBeenCalledTimes(1);
    expect(manager.invalidatePack).toHaveBeenCalledWith(name);
    expect(manager.unsubscribe).toHaveBeenCalledWith(name);
    expect(manager.deletePack).toHaveBeenCalledWith(name);
    await expect(service.remove('foreign-pack')).rejects.toThrow('only change maps it created');
  });

  test('unsupported platforms fail closed without touching a native manager', async () => {
    const service = new OfflineMapService(null);
    expect(service.supported).toBe(false);
    expect(await service.list()).toEqual([]);
    await expect(service.create({ center: { lat: 0, lng: 0 }, radiusKm: 2 }, jest.fn(), jest.fn())).rejects.toThrow('native Cairn build');
  });
});
