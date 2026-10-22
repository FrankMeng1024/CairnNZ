import { guardMapboxGl2RetiredDispatcher } from '../mapboxGl2LifecycleGuard';

function dispatcher() {
  const actor = { send: jest.fn((..._args: any[]) => ({ cancel: jest.fn() })) };
  const getActor = jest.fn(() => actor);
  const value = {
    actors: [actor],
    getActor,
  };
  return { actor, getActor, value };
}

describe('Mapbox GL JS v2 retired-dispatcher guard', () => {
  test('preserves the real actor while a style is live and no-ops only after retirement', () => {
    const current = dispatcher();
    const map = {
      _setCacheLimits: jest.fn(),
      style: { dispatcher: current.value },
      remove: jest.fn(() => { current.value.actors = []; }),
      setStyle: jest.fn(),
    };

    expect(guardMapboxGl2RetiredDispatcher(map)).toBe(true);
    expect(current.value.getActor()).toBe(current.actor);
    expect(current.getActor).toHaveBeenCalledTimes(1);

    map.remove();
    const retired = current.value.getActor();
    expect(() => retired.send('enforceCacheSizeLimit', 500)).not.toThrow();
    expect(retired.send('late-load', null).cancel).toEqual(expect.any(Function));
    expect(current.getActor).toHaveBeenCalledTimes(1);
  });

  test('protects the outgoing and replacement dispatchers across setStyle', async () => {
    const outgoing = dispatcher();
    const replacement = dispatcher();
    const map: any = {
      _setCacheLimits: jest.fn(),
      style: { dispatcher: outgoing.value },
      remove: jest.fn(),
      setStyle: jest.fn(() => {
        outgoing.value.actors = [];
        map.style = { dispatcher: replacement.value };
      }),
    };

    guardMapboxGl2RetiredDispatcher(map);
    map.setStyle({ version: 8, sources: {}, layers: [] });
    replacement.value.actors = [];
    await Promise.resolve();

    expect(() => outgoing.value.getActor().send('late-outgoing')).not.toThrow();
    expect(() => replacement.value.getActor().send('late-replacement')).not.toThrow();
    expect(outgoing.getActor).not.toHaveBeenCalled();
    expect(replacement.getActor).not.toHaveBeenCalled();
  });

  test('does not patch an unknown future Mapbox shape', () => {
    const current = dispatcher();
    const map = { style: { dispatcher: current.value }, remove: jest.fn(), setStyle: jest.fn() };

    expect(guardMapboxGl2RetiredDispatcher(map)).toBe(false);
    current.value.actors = [];
    expect(current.value.getActor()).toBe(current.actor);
    expect(current.getActor).toHaveBeenCalledTimes(1);
  });
});
