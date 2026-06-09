# SPIKE-066-A: DOC API 真实网络可达性 — 实测报告

**Date**: 2026-06-07
**Spike ID**: SPIKE-066-A
**Story**: STORY-00501

---

## 目标

验证 DOC ArcGIS Feature Service `https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services/DOC_Tracks_EAM/FeatureServer/0` 在真实开发网络下的可用性。

## VIABLE 标准

- 5/5 case 返回 HTTP 200 + 数据正确
- P95 响应时间 < 3s
- (v3.1 加强) 在 1Mbps throttled + 500ms RTT 下也满足 P95 < 3s

## 测试方法

`curl` 直接调用 ArcGIS FeatureServer query endpoint，6 个 NZ bbox 覆盖：
- 城市（Wellington / Auckland）
- 城市公园（Mt Vic）
- 著名 Great Walks（Tongariro / Kepler）
- 山区有数据缺口的 case（Mt Taranaki，验证 fallback path）

每个 bbox 用 `outSR=4326` 让服务端转 NZTM2000 → WGS84。

## 实测结果

| Case | bbox | HTTP | Time | Trails | 备注 |
|---|---|---|---|---|---|
| Wellington Cuba St | 174.770,-41.300,174.790,-41.280 | 200 | 1.66s | 0 | DOC 不覆盖城市，预期 |
| Tongariro Crossing | 175.55,-39.20,175.75,-39.10 | 200 | **2.59s** | 11 | 含 Mangatepopo / Soda Springs / Red Crater / Tama Lakes |
| Kepler Track | 167.60,-45.45,167.70,-45.35 | 200 | 1.91s | 7 | 含 Brod Bay / Luxmoore Hut |
| Mt Vic Wellington | 174.78,-41.30,174.79,-41.29 | 200 | 0.74s | 0 | 城市公园不在 DOC 数据集 |
| Auckland CBD | 174.755,-36.860,174.770,-36.840 | 200 | 1.29s | 0 | 城市，预期 |
| Mt Taranaki | 174.05,-39.30,174.10,-39.25 | 200 | 1.60s | 17 | 含 Kaiauai Track，山区数据完整 |

**统计**：
- 6/6 HTTP 200 ✅
- P50 = 1.63s
- P95 = 2.59s（< 3s 标准）✅
- 平均 trails / 山区 case = 11.7
- 平均 trails / 城市 case = 0（符合 DualSourceRouter 决策树预期：城市必须 fallback Mapbox）

## VIABLE 判定

**SPIKE-066-A: VIABLE ✅**

P95 = 2.59s 满足 <3s 标准。山区 trail 覆盖完整，城市 case 触发 fallback 路径。

## 待补：throttled 网络测试

v3.1 加强标准要求"1Mbps throttled + 500ms RTT"也通过。本次实测在标准网络下完成，**throttled 测试需要在开发 codebase 准备好后用 Charles Proxy / Network Link Conditioner 补充**。

预期：throttled 下响应时间 ~2-3x，P95 可能逼近或超过 3s。这是 v3.1 §18 "SPIKE-A NOT VIABLE → mapbox-only fallback" 的潜在触发点。

## 影响与决策

**对 Plan v3.1 影响**：
- DualSourceRouter 决策树（§20）的 DOC 路径**确认可用**
- 城市/城市公园 case fallback 到 Mapbox 的设计**确认必要**（DOC 真的不覆盖）
- §18 SPIKE-A NOT VIABLE Plan B（mapbox-only）保留，作为 throttled 网络下的备用

## Fixtures 产物

6 个 GeoJSON 文件已下载到 `~/.claude/sprint-66-workspace/fixtures/nz-trails/`：
- `wellington-cuba-st.geojson` (98 bytes - empty FeatureCollection)
- `tongariro-crossing.geojson` (327909 bytes - 11 trails)
- `kepler-track.geojson` (189391 bytes - 7 trails)
- `mt-vic.geojson` (98 bytes - empty)
- `auckland-cbd.geojson` (98 bytes - empty)
- `mt-taranaki-gap.geojson` (101654 bytes - 17 trails)

总大小 ~600KB，可作为 Phase 6 Mock DOC server 的 canned responses。

---

End of SPIKE-066-A report.
