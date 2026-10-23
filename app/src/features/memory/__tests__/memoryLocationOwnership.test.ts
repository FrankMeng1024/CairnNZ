import { memoryUserLocationShouldMount } from '../services/memoryLocationOwnership';

describe('Memory RNMapbox UserLocation ownership', () => {
  test.each([
    ['visible foreground Memory', true, true, true, true],
    ['retained but blurred Memory', true, false, true, false],
    ['focused Memory while app backgrounded', true, true, false, false],
    ['focused Memory without a live coordinate', false, true, true, false],
  ] as const)('%s', (_name, coordinateAvailable, screenFocused, appActive, expected) => {
    expect(memoryUserLocationShouldMount({ coordinateAvailable, screenFocused, appActive })).toBe(expected);
  });

  test('rapid blur/refocus and background/foreground transitions have one exclusive owner state', () => {
    const lifecycle = [
      { coordinateAvailable: true, screenFocused: true, appActive: true },
      { coordinateAvailable: true, screenFocused: false, appActive: true },
      { coordinateAvailable: true, screenFocused: true, appActive: true },
      { coordinateAvailable: true, screenFocused: true, appActive: false },
      { coordinateAvailable: true, screenFocused: false, appActive: false },
      { coordinateAvailable: true, screenFocused: true, appActive: true },
    ];
    expect(lifecycle.map(memoryUserLocationShouldMount)).toEqual([true, false, true, false, false, true]);
  });
});
