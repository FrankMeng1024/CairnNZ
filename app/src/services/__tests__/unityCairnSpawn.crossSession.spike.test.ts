// v0.2.4 spike sandbox: 用 production buildSpawnRequest 真验证 4 大 AR 问题中
// **可在 Editor sandbox 验证的 C# / TS 逻辑层部分**.
//
// 真验证 ≠ unit test.每个 case 是用户场景的精确数值复现:
//   - 同 session plant 后 walk away 回来:Tier-A 应命中,不飘
//   - 跨 session re-enter (新 GPS origin lock 漂 11m):应 fallback Tier-B
//   - 跨 session ARKit relocalize 跳变(GPS origin 没变,但 ARKit XYZ 已不可信):**Tier-A 错误命中** → subagent#2 issue 4
//   - 老 marker(无 arkitX 字段)cross-session re-enter:永远走 Tier-B → subagent#2 issue 12
//
// **验证不了的**(必须真机):
//   - ARF 6 free-floating ARAnchor 是否真被 subsystem 注册(真 ARKit 才有 trackingState)
//   - SLAM relocalize 真行为
//   - link.xml IL2CPP strip(需要真 iOS Release build)

import {
  buildSpawnRequest,
  geoToArkitWorld,
  type UnitySpawnRequest,
} from '../unityCairnSpawn';

// 抑制 production console.log 噪音(production code 会 emit telemetry)
const origLog = console.log;
beforeAll(() => { console.log = jest.fn(); });
afterAll(() => { console.log = origLog; });

const NZ_AUCKLAND = { lat: -36.8485, lng: 174.7633 };  // 真新西兰用户坐标

describe('v0.2.4 spike: cross-session 飞天 / 漂移 / Tier 决策', () => {
  // ────────────────────────────────────────────────────────────────────
  // 场景 A — 同 session plant 后 walk away 回来
  // 用户原话:"同一次 app 操作 必须保证 mark 在同一点位"
  // ────────────────────────────────────────────────────────────────────
  test('SCENARIO_A_same_session_walk_away_walk_back: Tier-A 命中, 用持久化 ARKit XYZ', () => {
    const marker = {
      id: 'cairn-001', type: 'cairn',
      lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng,
      arkitX: 1.5, arkitY: 0.0, arkitZ: -2.3,
      arOriginLat: NZ_AUCKLAND.lat,
      arOriginLng: NZ_AUCKLAND.lng,
    };
    const origin = { lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng };
    const result = buildSpawnRequest(marker, origin, null);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('A');
    expect(result!.x).toBe(1.5);
    expect(result!.y).toBe(0.0);
    expect(result!.z).toBe(-2.3);
  });

  // ────────────────────────────────────────────────────────────────────
  // 场景 B — 跨 session re-enter,GPS origin 自然漂 8m
  // 用户原话:"AR plant 的 mark 没用 arkit 的世界坐标 用的是 GPS 所以每次打开都飘逸"
  // 期望: Tier-A 应被拒(originDelta > 5m), fallback Tier-B
  // ────────────────────────────────────────────────────────────────────
  test('SCENARIO_B_cross_session_gps_drift_8m: Tier-A 拒绝, Tier-B fallback', () => {
    const marker = {
      id: 'cairn-002', type: 'cairn',
      lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng,
      arkitX: 1.5, arkitY: 0.0, arkitZ: -2.3,
      arOriginLat: NZ_AUCKLAND.lat,
      arOriginLng: NZ_AUCKLAND.lng,
    };
    // 新 origin 在北方 8m 处(lat 漂 0.0001 ≈ 11m)
    const newOrigin = { lat: NZ_AUCKLAND.lat + 0.0000718, lng: NZ_AUCKLAND.lng };
    const result = buildSpawnRequest(marker, newOrigin, 0.0);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('B');  // 应 fallback
  });

  // ────────────────────────────────────────────────────────────────────
  // 场景 C — 跨 session ARKit relocalize 失败 (subagent#2 BLOCKER #1)
  // 用户最关心的"二次打开后飞天":
  //   - GPS origin 一致 (用户在同一点 re-launch)
  //   - 但 ARKit world frame 重新初始化,arkitX/Y/Z 不再代表同一物理位置
  //   - Tier-A 5m 阈值检查 GPS origin delta = 0,Tier-A **错误命中**
  //   - 结果:cairn 被放在新 ARKit world 的 (1.5, 0.0, -2.3) — 但这个坐标在新 frame 里是任意位置
  //
  // 这个测试的目的不是 PASS/FAIL,是 EXPOSE 当前代码缺陷:
  // **buildSpawnRequest 完全没有"ARKit session 是否同一个"的概念,无法识别 relocalize**
  // ────────────────────────────────────────────────────────────────────
  test('SCENARIO_C_cross_session_ARKit_relocalize_BLOCKER: Tier-A 错误命中 (代码无法识别新 ARKit session)', () => {
    const marker = {
      id: 'cairn-003', type: 'cairn',
      lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng,
      arkitX: 1.5, arkitY: 0.0, arkitZ: -2.3,
      arOriginLat: NZ_AUCKLAND.lat,
      arOriginLng: NZ_AUCKLAND.lng,
    };
    // 用户在同一物理点重开 app — GPS origin 完全一致
    const sameOrigin = { lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng };
    const result = buildSpawnRequest(marker, sameOrigin, null);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('A');
    // ⚠️ 漏洞:Tier-A 命中,但新 ARKit session world frame 跟旧的完全不一样
    //    (1.5, 0.0, -2.3) 在新 frame 可能在天上 / 地下 / 邻居家
    // 代码层无法 detect 这个,需要 ARWorldMap 或 ARSession-id 持久化
    expect(result!.x).toBe(1.5);  // 这就是 bug:用旧坐标
  });

  // ────────────────────────────────────────────────────────────────────
  // 场景 D — 老 marker (升级前,无 arkitX) cross-session
  // subagent#2 issue 12: schema migration silent gap
  // 期望: 永远走 Tier-B (no-arkit-xyz),修复对老用户隐形
  // ────────────────────────────────────────────────────────────────────
  test('SCENARIO_D_legacy_marker_no_arkitXYZ: 永走 Tier-B (修复对老用户无效)', () => {
    const marker = {
      id: 'cairn-004', type: 'cairn',
      lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng,
      // arkitX/Y/Z/arOrigin 全部 undefined (老 schema)
    };
    const origin = { lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng };
    const result = buildSpawnRequest(marker, origin, 0.0);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('B');
    // 验证:即使在同一 session 同一物理点,Tier-A 修复对老 marker 无效
  });

  // ────────────────────────────────────────────────────────────────────
  // 场景 E — Low accuracy GPS (室内 / 多云)
  // R2.3 要求: lowAccuracy 时收紧 Tier-A 阈值 5→2m
  // 期望: 即使 originDelta=3m, Tier-A 也应被拒
  // ────────────────────────────────────────────────────────────────────
  test('SCENARIO_E_low_accuracy_origin: Tier-A 阈值收紧 5→2m', () => {
    const marker = {
      id: 'cairn-005', type: 'cairn',
      lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng,
      arkitX: 1.5, arkitY: 0.0, arkitZ: -2.3,
      arOriginLat: NZ_AUCKLAND.lat,
      arOriginLng: NZ_AUCKLAND.lng,
    };
    // 新 origin 漂 3m, lowAccuracy=true → 应拒绝(>2m)
    const lowAccOrigin = {
      lat: NZ_AUCKLAND.lat + 0.0000270,  // ~3m N
      lng: NZ_AUCKLAND.lng,
      lowAccuracy: true,
    };
    const result = buildSpawnRequest(marker, lowAccOrigin, 0.0);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('B');  // 收紧后应拒
  });

  // 同样 3m delta, 高精度 origin → 应命中 (5m 阈值)
  test('SCENARIO_E2_normal_accuracy_origin_3m_drift: Tier-A 命中 (5m 阈值)', () => {
    const marker = {
      id: 'cairn-006', type: 'cairn',
      lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng,
      arkitX: 1.5, arkitY: 0.0, arkitZ: -2.3,
      arOriginLat: NZ_AUCKLAND.lat,
      arOriginLng: NZ_AUCKLAND.lng,
    };
    const origin = {
      lat: NZ_AUCKLAND.lat + 0.0000270,  // ~3m N
      lng: NZ_AUCKLAND.lng,
      // 不传 lowAccuracy
    };
    const result = buildSpawnRequest(marker, origin, 0.0);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('A');  // 5m 阈值内
  });

  // ────────────────────────────────────────────────────────────────────
  // 场景 F — geoToArkitWorld 反算误差(Tier-B 路径)
  // subagent#2 issue 7: 长距离反算误差累积
  // 用户走 1km 后 plant 的老 marker, re-enter 时反算精度
  // ────────────────────────────────────────────────────────────────────
  test('SCENARIO_F_geoToArkitWorld_long_distance: 1km 距离反算精度', () => {
    // origin 在 NZ Auckland, marker plant 在北方 1km
    const origin = { lat: NZ_AUCKLAND.lat, lng: NZ_AUCKLAND.lng };
    const markerLat = NZ_AUCKLAND.lat + 0.009;  // ~1km N

    const xz = geoToArkitWorld(markerLat, NZ_AUCKLAND.lng, origin);
    expect(xz).not.toBeNull();
    // 期望 z 约 -1000m(北方)
    expect(Math.abs(xz!.z + 1000)).toBeLessThan(50);  // 50m 容忍
    // 这暴露了 cosLat 修正在 NZ 纬度下的精度
  });
});
