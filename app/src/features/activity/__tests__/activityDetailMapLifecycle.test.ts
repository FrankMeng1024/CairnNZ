import {
  activityDetailMapBindingIdentity,
  activityDetailMapNeedsCameraFit,
  initialActivityDetailMapLifecycle,
  reduceActivityDetailMapLifecycle,
} from '../activityDetailMapLifecycle';

function apply(types: Array<Parameters<typeof reduceActivityDetailMapLifecycle>[1]>) {
  return types.reduce(reduceActivityDetailMapLifecycle, initialActivityDetailMapLifecycle);
}

describe('Activity Detail native map lifecycle', () => {
  test('cold/delayed style load rebinds Final geometry and then fits it', () => {
    const beforeStyle = apply([
      { type: 'geometry', identity: 'final-r2' },
      { type: 'map-will-load' },
    ]);
    expect(activityDetailMapNeedsCameraFit(beforeStyle, null)).toBe(false);
    const ready = reduceActivityDetailMapLifecycle(
      reduceActivityDetailMapLifecycle(beforeStyle, { type: 'style-ready' }),
      { type: 'map-ready' },
    );
    expect(ready.styleGeneration).toBe(1);
    expect(activityDetailMapNeedsCameraFit(ready, null)).toBe(true);
  });

  test('fast cached style and Final-before-map converge to the same binding', () => {
    const finalBeforeMap = apply([
      { type: 'geometry', identity: 'final-r2' },
      { type: 'style-ready' },
      { type: 'map-ready' },
    ]);
    const mapBeforeFinal = apply([
      { type: 'style-ready' },
      { type: 'map-ready' },
      { type: 'geometry', identity: 'final-r2' },
    ]);
    expect(activityDetailMapBindingIdentity(
      finalBeforeMap.geometryIdentity!, finalBeforeMap.styleGeneration,
    )).toBe(activityDetailMapBindingIdentity(
      mapBeforeFinal.geometryIdentity!, mapBeforeFinal.styleGeneration,
    ));
    expect(activityDetailMapNeedsCameraFit(mapBeforeFinal, 'base-r1-style-1')).toBe(true);
  });

  test('style reload and app resume each invalidate the native binding without changing geometry truth', () => {
    const ready = apply([
      { type: 'geometry', identity: 'final-r2' },
      { type: 'style-ready' },
      { type: 'map-ready' },
    ]);
    const reloaded = reduceActivityDetailMapLifecycle(
      reduceActivityDetailMapLifecycle(ready, { type: 'map-will-load' }),
      { type: 'style-ready' },
    );
    const resumed = reduceActivityDetailMapLifecycle(reloaded, { type: 'app-resume' });
    expect(resumed.geometryIdentity).toBe('final-r2');
    expect(resumed.styleGeneration).toBe(3);
    expect(activityDetailMapBindingIdentity('final-r2', resumed.styleGeneration))
      .not.toBe(activityDetailMapBindingIdentity('final-r2', ready.styleGeneration));
  });
});
