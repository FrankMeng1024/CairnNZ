describe('passive background Memory native boundary', () => {
  afterEach(() => jest.resetModules());

  test('Build 62 is deliberately foreground-only despite having the Activity background entitlement', () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    jest.doMock('expo-application', () => ({ nativeBuildVersion: '62' }));
    const { passiveBackgroundMemoryCapability } = require('../services/passiveMemoryCapability');
    expect(passiveBackgroundMemoryCapability()).toEqual({
      supported: false,
      reason: 'native-build-required',
      nativeBuild: 62,
    });
  });
});
