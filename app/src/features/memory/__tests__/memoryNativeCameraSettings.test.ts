import {
  memoryCameraDefaultSettings,
  memoryWebInitialViewState,
} from '../services/memoryCameraSettings';

describe('Memory native Camera recreation settings', () => {
  test('passes the saved orientation through RNMapbox CameraStop.heading', () => {
    const defaultSettings = memoryCameraDefaultSettings({
      center: [116.32, 39.9], zoom: 18, bearing: 42, pitch: 35, actionId: 20,
    }, [174.8, -41.3], 16.5);

    expect(defaultSettings).toEqual({
      centerCoordinate: [116.32, 39.9], zoomLevel: 18, heading: 42, pitch: 35,
    });
    expect(defaultSettings).not.toHaveProperty('bearing');
  });

  test('a fresh Web map lifecycle receives the recreated heading and pitch', () => {
    const firstMount = memoryWebInitialViewState(
      memoryCameraDefaultSettings(null, [174.8, -41.3], 16.5),
      undefined,
    );
    const recreatedMount = memoryWebInitialViewState(
      memoryCameraDefaultSettings({
        center: [121.47, 31.23], zoom: 17.5, bearing: 126, pitch: 48, actionId: 99,
      }, [174.8, -41.3], 16.5),
      undefined,
    );

    expect(firstMount).toMatchObject({ bearing: 0, pitch: 0 });
    expect(recreatedMount).toEqual({
      longitude: 121.47,
      latitude: 31.23,
      zoom: 17.5,
      bearing: 126,
      pitch: 48,
    });
  });
});
