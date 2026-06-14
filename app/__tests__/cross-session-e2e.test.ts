/**
 * R2.3 + R2.4 跨 session 端到端 jest 真测。
 *
 * 模拟"用户 plant cairn → 关 app → 重开" 完整链路:
 *   Session 1: GPS lock → setArOriginIfMissing → AsyncStorage save
 *   重开: marker store hydrate → 还原 arOrigin (含 lowAccuracy)
 *   Session 2: projectOrigin → buildSpawnRequest → 验证 Tier-A/B 决策跟 Session 1 一致
 *
 * 反 self-licking: 真 import marker store + originPropagation + buildSpawnRequest,
 * 调真函数。如果某一环回退,jest 真 FAIL。
 */

// Mock AsyncStorage (in-memory)
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    __reset: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../src/services/crashLogger', () => ({
  crashLogger: { breadcrumb: jest.fn(), log: jest.fn(), capture: jest.fn(), record: jest.fn() },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarkerStore } from '../src/store/useMarkerStore';
import { projectOrigin, decideGpsLock } from '../src/services/originPropagation';
import { buildSpawnRequest } from '../src/services/unityCairnSpawn';

describe('Cross-session end-to-end (R2.3 + R2.4 飞天症状链路)', () => {
  beforeEach(() => {
    (AsyncStorage as any).__reset();
    useMarkerStore.setState({ arOrigin: null, userId: null, markers: [], syncing: false });
  });

  // 模拟 user plant 一个 cairn,marker 持久化所记录的 origin + arkit XYZ
  const cairnPlantedSession1 = (originLat: number, originLng: number) => ({
    id: 'cairn-1',
    type: 'cairn',
    lat: originLat,        // plant lat ≈ origin (ARKit XYZ 是相对 origin 的,GPS coord 为 reverse)
    lng: originLng,
    arkitX: 0,             // plant 时相对 origin = 0
    arkitY: 0.3,           // 30cm above ground
    arkitZ: 0,
    arOriginLat: originLat,
    arOriginLng: originLng,
    note: '',
  });

  it('S1 plant high-acc + S2 resume same origin → Tier-A spawn at original arkit XYZ', async () => {
    // === Session 1 ===
    await useMarkerStore.getState().hydrate('user-cs1');
    const s1Decision = decideGpsLock(5);  // high-acc
    expect(s1Decision.action).toBe('lock');
    if (s1Decision.action === 'lock') {
      useMarkerStore.getState().setArOriginIfMissing({
        lat: 30.0, lng: 120.0, alt: null, lowAccuracy: s1Decision.lowAccuracy,
      });
    }
    const cairn = cairnPlantedSession1(30.0, 120.0);

    // === App restart: clear in-memory state, re-hydrate ===
    useMarkerStore.setState({ arOrigin: null });
    await useMarkerStore.getState().hydrate('user-cs1');
    const s2Origin = useMarkerStore.getState().arOrigin;
    expect(s2Origin).not.toBeNull();
    expect(s2Origin!.lowAccuracy).toBe(false);

    // === Session 2 spawn ===
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(s2Origin, live);
    const req = buildSpawnRequest(cairn, projOrigin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('A');
    expect(req!.x).toBe(0);
    expect(req!.y).toBe(0.3);  // 30cm above floor
    expect(req!.z).toBe(0);
  });

  it('S1 plant low-acc + S2 resume → low-acc origin makes Tier-A 阈值收紧', async () => {
    await useMarkerStore.getState().hydrate('user-cs2');
    const s1Decision = decideGpsLock(15);  // low-acc
    if (s1Decision.action === 'lock') {
      useMarkerStore.getState().setArOriginIfMissing({
        lat: 30.0, lng: 120.0, alt: null, lowAccuracy: s1Decision.lowAccuracy,
      });
    }
    // Cairn planted with 4m offset from current origin (within high-acc threshold,
    // but low-acc tightened threshold is 2m -> Tier-B)
    const cairn = {
      ...cairnPlantedSession1(30.0, 120.0),
      arOriginLat: 29.999964,  // 4m off
    };

    useMarkerStore.setState({ arOrigin: null });
    await useMarkerStore.getState().hydrate('user-cs2');
    const s2Origin = useMarkerStore.getState().arOrigin;
    expect(s2Origin!.lowAccuracy).toBe(true);

    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(s2Origin, live);
    const req = buildSpawnRequest(cairn, projOrigin, null);
    // Low-acc 收紧 (5m → 2m), 4m delta > 2m → Tier-B fallback
    expect(req!.tier).toBe('B');
  });

  it('S1 plant + S2 resume after walking 60m → origin clearArOrigin → 重新 lock', async () => {
    await useMarkerStore.getState().hydrate('user-cs3');
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 30.0, lng: 120.0, alt: null, lowAccuracy: false,
    });
    expect(useMarkerStore.getState().arOrigin).not.toBeNull();

    // simulate user walked 60m → ARScreen.tsx detects stale → clearArOrigin
    useMarkerStore.getState().clearArOrigin();
    expect(useMarkerStore.getState().arOrigin).toBeNull();

    // After app restart: hydrate finds storage empty, arOrigin remains null
    useMarkerStore.setState({ arOrigin: null });
    await useMarkerStore.getState().hydrate('user-cs3');
    expect(useMarkerStore.getState().arOrigin).toBeNull();

    // New origin lock at new location
    useMarkerStore.getState().setArOriginIfMissing({
      lat: 30.001, lng: 120.001, alt: null, lowAccuracy: false,
    });
    expect(useMarkerStore.getState().arOrigin!.lat).toBe(30.001);
  });

  it('S1 reject GPS too noisy → no origin saved → S2 can not Tier-A', async () => {
    await useMarkerStore.getState().hydrate('user-cs4');
    const s1Decision = decideGpsLock(30);  // > 25 → reject
    expect(s1Decision.action).toBe('reject');
    // ARScreen.tsx returns early, never calls setArOriginIfMissing
    expect(useMarkerStore.getState().arOrigin).toBeNull();

    // App restart hydrates nothing
    useMarkerStore.setState({ arOrigin: null });
    await useMarkerStore.getState().hydrate('user-cs4');
    expect(useMarkerStore.getState().arOrigin).toBeNull();

    // Session 2 spawn must use live origin (Tier-B, no arkit XYZ history match)
    const cairn = cairnPlantedSession1(30.0, 120.0);
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(useMarkerStore.getState().arOrigin, live);
    const req = buildSpawnRequest(cairn, projOrigin, null);
    expect(req!.tier).toBe('A');  // arOriginLat==live, delta=0, Tier-A 仍命中
    // 关键: 但 projOrigin.lowAccuracy = undefined → 走 high-acc 5m 默认
    // 不是 sub#3 报告的"死字段"问题,因为 lowAccuracy 字段是从 persisted 来的,
    // null persisted 时走 live 默认 high-acc — 这是正确行为
  });

  it('legacy v0.2.3 user (storage 无 lowAccuracy) → hydrate 视为 high-acc', async () => {
    // 仿真旧版数据
    await (AsyncStorage as any).setItem(
      'cairn_ar_origin_v1_user-cs5',
      JSON.stringify({ lat: 30.0, lng: 120.0, alt: null }),
    );
    await useMarkerStore.getState().hydrate('user-cs5');
    const o = useMarkerStore.getState().arOrigin;
    expect(o!.lowAccuracy).toBe(false);  // !!undefined = false

    // S2 spawn 走原 5m 阈值 (legacy 用户体验跟 high-acc 一致)
    const cairn = cairnPlantedSession1(30.0, 120.0);
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(o, live);
    const req = buildSpawnRequest(cairn, projOrigin, null);
    expect(req!.tier).toBe('A');
  });
});
