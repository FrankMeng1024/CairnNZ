/**
 * R2.3+R2.5 buildSpawnRequest 全分支测试。
 *
 * 已有 r23-low-accuracy 测了 Tier-A 阈值,这个补:
 * - 缺 origin 走 Tier-B
 * - 缺 arkit XYZ 走 Tier-B + 标 reason=no-arkit-xyz
 * - 缺 arOriginLat 走 Tier-B
 * - origin null → buildSpawnRequest 整个返 null (geoToArkitWorld 没 origin)
 * - groundY 透传
 * - shader/color 字段填了
 */

import { buildSpawnRequest } from '../src/services/unityCairnSpawn';

describe('R2.3 + R2.5 buildSpawnRequest 全分支', () => {
  const fullMarker = {
    id: 'full', type: 'cairn', lat: 30.0, lng: 120.0,
    arkitX: 1.0, arkitY: 0.5, arkitZ: 2.0,
    arOriginLat: 30.0, arOriginLng: 120.0,
  };
  const matchingOrigin = { lat: 30.0, lng: 120.0 };

  it('origin null → 返 null (geoToArkitWorld no origin)', () => {
    const req = buildSpawnRequest({ ...fullMarker }, null, null);
    expect(req).toBeNull();
  });

  it('arkit XYZ + origin 同 origin: Tier-A', () => {
    const req = buildSpawnRequest(fullMarker, matchingOrigin, null);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('A');
    expect(req!.x).toBe(1.0);
    expect(req!.y).toBe(0.5);
    expect(req!.z).toBe(2.0);
  });

  it('arkit XYZ but missing arOriginLat → Tier-B', () => {
    const m: any = { ...fullMarker, arOriginLat: undefined };
    const req = buildSpawnRequest(m, matchingOrigin, 0.5);
    expect(req!.tier).toBe('B');
    expect(req!.y).toBe(0.5);  // groundY transmits
  });

  it('marker without arkitX → Tier-B', () => {
    const m: any = { id: 'noxyz', type: 'cairn', lat: 30.0, lng: 120.0 };
    const req = buildSpawnRequest(m, matchingOrigin, 1.0);
    expect(req!.tier).toBe('B');
    expect(req!.y).toBe(1.0);
  });

  it('Tier-B: groundY null → y=0', () => {
    const m: any = { id: 'noxyz2', type: 'cairn', lat: 30.0, lng: 120.0 };
    const req = buildSpawnRequest(m, matchingOrigin, null);
    expect(req!.y).toBe(0);
  });

  it('Tier-A high-acc origin, delta 4m → Tier-A (5m threshold)', () => {
    const m = { ...fullMarker, arOriginLat: 29.999964 };  // ~4m
    const origin = { lat: 30.0, lng: 120.0, lowAccuracy: false };
    const req = buildSpawnRequest(m, origin, null);
    expect(req!.tier).toBe('A');
  });

  it('Tier-A high-acc origin, delta 6m → Tier-B (>5m)', () => {
    const m = { ...fullMarker, arOriginLat: 29.999946 };  // ~6m
    const origin = { lat: 30.0, lng: 120.0, lowAccuracy: false };
    const req = buildSpawnRequest(m, origin, null);
    expect(req!.tier).toBe('B');
  });

  it('Tier-A low-acc origin, delta 3m → Tier-B (>2m low-acc threshold)', () => {
    const m = { ...fullMarker, arOriginLat: 29.999973 };  // ~3m
    const origin = { lat: 30.0, lng: 120.0, lowAccuracy: true };
    const req = buildSpawnRequest(m, origin, null);
    expect(req!.tier).toBe('B');
  });

  it('Tier-A low-acc origin, delta 1m → Tier-A (<2m)', () => {
    const m = { ...fullMarker, arOriginLat: 29.999991 };  // ~1m
    const origin = { lat: 30.0, lng: 120.0, lowAccuracy: true };
    const req = buildSpawnRequest(m, origin, null);
    expect(req!.tier).toBe('A');
  });

  it('color/shader 字段填了 (cairn type 默认)', () => {
    const req = buildSpawnRequest(fullMarker, matchingOrigin, null);
    expect(typeof req!.r).toBe('number');
    expect(typeof req!.g).toBe('number');
    expect(typeof req!.b).toBe('number');
    expect(typeof req!.scrollSpeed).toBe('number');
    expect(typeof req!.bloomBoost).toBe('number');
  });

  it('note 截断到 30 char', () => {
    const longNote = 'a'.repeat(50);
    const m = { ...fullMarker, note: longNote };
    const req = buildSpawnRequest(m, matchingOrigin, null);
    expect(req!.note!.length).toBe(30);
  });
});
