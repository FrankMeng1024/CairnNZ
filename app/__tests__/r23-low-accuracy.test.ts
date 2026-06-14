/**
 * R2.3 isLowAccuracy data flow test
 *
 * 验证: ARScreen 设 origin.lowAccuracy → markerStore 持久化 → buildSpawnRequest
 * 收紧 Tier-A 阈值 (5m → 2m)
 *
 * 反 self-licking: 真调 buildSpawnRequest,真断言阈值切换
 */

import { buildSpawnRequest } from '../src/services/unityCairnSpawn';

describe('R2.3 isLowAccuracy threshold tightening', () => {
  const baseMarker = {
    id: 'test',
    type: 'cairn',
    lat: 30.0,
    lng: 120.0,
    arkitX: 0,
    arkitY: 0,
    arkitZ: 0,
    arOriginLat: 30.0,
    arOriginLng: 120.0,
  };

  it('high accuracy origin: Tier-A allowed at 4m delta (< 5m threshold)', () => {
    // origin 位移让 originDeltaM ≈ 4m
    const origin = { lat: 30.000036, lng: 120.0, lowAccuracy: false };
    const req = buildSpawnRequest(baseMarker, origin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('A');
  });

  it('high accuracy origin: Tier-A rejected at 6m delta (> 5m threshold)', () => {
    // ~6m 位移
    const origin = { lat: 30.000054, lng: 120.0, lowAccuracy: false };
    const req = buildSpawnRequest(baseMarker, origin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('B');  // fallback
  });

  it('LOW accuracy origin: Tier-A rejected at 4m delta (> 2m low-acc threshold)', () => {
    // 4m 在 high-acc 是允许的,low-acc 应改 reject
    const origin = { lat: 30.000036, lng: 120.0, lowAccuracy: true };
    const req = buildSpawnRequest(baseMarker, origin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('B');  // R2.3: low-acc 收紧到 2m,4m 超 → fallback
  });

  it('LOW accuracy origin: Tier-A allowed at 1m delta (< 2m low-acc threshold)', () => {
    // ~1m 位移 (≈ 0.000009 lat)
    const origin = { lat: 30.000009, lng: 120.0, lowAccuracy: true };
    const req = buildSpawnRequest(baseMarker, origin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('A');  // 仍 < 2m,Tier-A OK
  });

  it('lowAccuracy undefined defaults to high-accuracy threshold (5m)', () => {
    // 4m 位移,lowAccuracy 字段缺失 → 走 high-acc 5m 路径 → Tier-A
    const origin = { lat: 30.000036, lng: 120.0 };
    const req = buildSpawnRequest(baseMarker, origin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('A');
  });
});
