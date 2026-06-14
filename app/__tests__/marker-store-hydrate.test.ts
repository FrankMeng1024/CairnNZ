/**
 * R2.3 marker store hydrate roundtrip test.
 *
 * 真测: setArOriginIfMissing → AsyncStorage save → re-instantiate store → hydrate
 * → arOrigin.lowAccuracy 字段必须保留。这是跨 session 持久化路径。
 *
 * 反 self-licking: 真 import useMarkerStore + 真 mock AsyncStorage。
 */

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    __reset: () => { Object.keys(store).forEach((k) => delete store[k]); },
    __dump: () => ({ ...store }),
  };
});

// Mock expo-secure-store (deps chain: useMarkerStore → apiService → tokenStore)
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../src/services/crashLogger', () => ({
  crashLogger: {
    breadcrumb: jest.fn(),
    log: jest.fn(),
    capture: jest.fn(),
    record: jest.fn(),
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarkerStore } from '../src/store/useMarkerStore';

describe('R2.3 marker store hydrate lowAccuracy roundtrip', () => {
  const KEY = (userId: string) => `cairn_ar_origin_v1_${userId}`;

  beforeEach(() => {
    (AsyncStorage as any).__reset();
    // reset store state
    useMarkerStore.setState({ arOrigin: null, userId: null, markers: [], syncing: false });
  });

  it('high-accuracy origin: lowAccuracy=false 写入 + 读出', async () => {
    await useMarkerStore.getState().hydrate('user-1');
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 30.5, lng: 120.5, alt: 50, lowAccuracy: false,
    });
    const stored = (AsyncStorage as any).__dump();
    expect(stored[KEY('user-1')]).toBeTruthy();
    const parsed = JSON.parse(stored[KEY('user-1')]);
    expect(parsed.lowAccuracy).toBe(false);

    // Simulate cold restart: new hydrate call should restore lowAccuracy
    useMarkerStore.setState({ arOrigin: null });
    await useMarkerStore.getState().hydrate('user-1');
    const o = useMarkerStore.getState().arOrigin;
    expect(o).not.toBeNull();
    expect(o!.lowAccuracy).toBe(false);
  });

  it('low-accuracy origin: lowAccuracy=true 写入 + 读出', async () => {
    await useMarkerStore.getState().hydrate('user-2');
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 30.5, lng: 120.5, alt: 50, lowAccuracy: true,
    });

    useMarkerStore.setState({ arOrigin: null });
    await useMarkerStore.getState().hydrate('user-2');
    const o = useMarkerStore.getState().arOrigin;
    expect(o!.lowAccuracy).toBe(true);
  });

  it('legacy origin (无 lowAccuracy 字段) 反序列化为 false (not undefined)', async () => {
    // 仿真 v0.2.3 用户 — AsyncStorage 里只有 lat/lng/alt 没 lowAccuracy
    await (AsyncStorage as any).setItem(
      KEY('user-legacy'),
      JSON.stringify({ lat: 30.5, lng: 120.5, alt: 50 }),
    );
    await useMarkerStore.getState().hydrate('user-legacy');
    const o = useMarkerStore.getState().arOrigin;
    expect(o).not.toBeNull();
    // hydrate 把 !!o.lowAccuracy → false (markerStore.ts:299 `lowAccuracy: !!o.lowAccuracy`)
    expect(o!.lowAccuracy).toBe(false);
  });

  it('clearArOrigin removes both state + storage', async () => {
    await useMarkerStore.getState().hydrate('user-3');
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 30.5, lng: 120.5, alt: 50, lowAccuracy: true,
    });
    useMarkerStore.getState().clearArOrigin();
    expect(useMarkerStore.getState().arOrigin).toBeNull();
    const stored = (AsyncStorage as any).__dump();
    expect(stored[KEY('user-3')]).toBeUndefined();
  });

  it('setArOriginIfMissing 是真 if-missing — 已有 origin 不覆盖', async () => {
    await useMarkerStore.getState().hydrate('user-4');
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 30.5, lng: 120.5, alt: 50, lowAccuracy: false,
    });
    // try overwrite with low-acc — should be no-op
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 31.0, lng: 121.0, alt: 60, lowAccuracy: true,
    });
    const o = useMarkerStore.getState().arOrigin;
    expect(o!.lat).toBe(30.5);  // 第一次的值仍在
    expect(o!.lowAccuracy).toBe(false);
  });
});
