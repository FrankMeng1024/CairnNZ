/**
 * expo-location mock — 签名与真实 API 完全对齐
 * LocationObject 结构与 expo-location@19.x 一致
 * 保证 Layer 1 (Jest) 通过 = Layer 3 (设备) 逻辑正确
 */

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
};

export const mockLocation = {
  coords: {
    latitude: -39.1548,   // Tongariro National Park 附近
    longitude: 175.6320,
    altitude: 850,
    accuracy: 5,
    altitudeAccuracy: 10,
    heading: 45,
    speed: 2.5,
  },
  timestamp: Date.now(),
};

export const requestForegroundPermissionsAsync = jest.fn().mockResolvedValue({
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never',
});

export const requestBackgroundPermissionsAsync = jest.fn().mockResolvedValue({
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never',
});

export const getCurrentPositionAsync = jest.fn().mockResolvedValue(mockLocation);

// watchPositionAsync: 立即触发一次回调，返回可 remove 的 subscription
export const watchPositionAsync = jest.fn().mockImplementation(
  (_options: any, callback: (loc: typeof mockLocation) => void) => {
    callback(mockLocation);
    return Promise.resolve({ remove: jest.fn() });
  }
);

export const startLocationUpdatesAsync = jest.fn().mockResolvedValue(undefined);
export const stopLocationUpdatesAsync = jest.fn().mockResolvedValue(undefined);
export const hasStartedLocationUpdatesAsync = jest.fn().mockResolvedValue(false);

export type LocationObject = typeof mockLocation;
export type LocationSubscription = { remove: () => void };
