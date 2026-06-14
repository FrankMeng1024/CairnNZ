/**
 * R2.3 sub#3 BLOCKER fix verification — UnityAROverlay caller 真透传 lowAccuracy。
 *
 * 反 self-licking v2: 真 import services/originPropagation projectOrigin (UnityAROverlay
 * 也调同一函数)。如果生产代码回退,jest 一定 fail,因为它们调同一函数。
 */

import { buildSpawnRequest } from '../src/services/unityCairnSpawn';
import { projectOrigin } from '../src/services/originPropagation';

describe('R2.3 caller-chain lowAccuracy propagation (真调 services/originPropagation)', () => {
  const baseMarker = {
    id: 'caller-test',
    type: 'cairn',
    lat: 30.0,
    lng: 120.0,
    arkitX: 0, arkitY: 0, arkitZ: 0,
    arOriginLat: 30.0, arOriginLng: 120.0,
  };

  it('persisted origin with lowAccuracy=true 真传到 buildSpawnRequest 收紧阈值', () => {
    const arOrigin = { lat: 30.000036, lng: 120.0, alt: null, lowAccuracy: true };
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(arOrigin, live);
    expect(projOrigin).toHaveProperty('lowAccuracy', true);
    // 4m delta > 2m low-acc threshold -> Tier-B
    const req = buildSpawnRequest(baseMarker, projOrigin, null);
    expect(req!.tier).toBe('B');
  });

  it('persisted origin with lowAccuracy=false 走原 5m 阈值', () => {
    const arOrigin = { lat: 30.000036, lng: 120.0, alt: null, lowAccuracy: false };
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(arOrigin, live);
    expect(projOrigin).toHaveProperty('lowAccuracy', false);
    const req = buildSpawnRequest(baseMarker, projOrigin, null);
    expect(req!.tier).toBe('A');
  });

  it('persisted origin without lowAccuracy field 走默认 (undefined falsy = high-acc)', () => {
    const arOrigin = { lat: 30.000036, lng: 120.0, alt: null };
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(arOrigin, live);
    expect(projOrigin.lowAccuracy).toBeUndefined();
    const req = buildSpawnRequest(baseMarker, projOrigin, null);
    expect(req!.tier).toBe('A');
  });

  it('null origin 走 live (无 lowAccuracy)', () => {
    const live = { lat: 30.0, lng: 120.0 };
    const projOrigin = projectOrigin(null, live);
    expect(projOrigin.lat).toBe(30.0);
    expect(projOrigin.lng).toBe(120.0);
    expect(projOrigin.lowAccuracy).toBeUndefined();
  });

  it('reverse-verify: 直接在 origin 字段缺失时低精度收紧不生效 (sub#3 报告的死字段症状)', () => {
    const live = { lat: 30.0, lng: 120.0 };
    // 模拟 BUG: 字段缺失
    const buggyOrigin = { lat: 30.000036, lng: 120.0 };
    const req = buildSpawnRequest(baseMarker, buggyOrigin, null);
    expect(req!.tier).toBe('A');  // 5m 默认走 Tier-A,低精度用户没被收紧 = 死字段
  });
});

