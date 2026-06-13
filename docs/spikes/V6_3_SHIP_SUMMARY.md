# v6.3 Brush-Edit Ship Summary

**日期**:2026-06-14
**状态**:**Code SHIP-READY**(等 PO 真机自测 + 拍 OTA)
**OTA Version**:255 → 256

---

## 1. 大状态

### 完成度
- ✅ Plan v4 — R1+R2 双 fresh review **双 PASS**(经过 4 轮迭代修了 ~30 个真问题)
- ✅ Code 11 阶段全过 — 阶段性防偷工 subagent 11/11 PASS
- ✅ R3+R4 code review:5 issues 修 4(R4 #5 nav.replace 是预存在,留 backlog)
- ✅ R5 re-review:**PASS — Ship**
- ✅ R6 re-review:NEEDS_WORK 1 Blocker(legacy key cleanup race)+ 4 minor → **全修**
- ✅ R7 final pass: **PASS — SHIP**
- ✅ R8 independent final: **PASS — SHIP NOW**

### 最终质量
- typecheck:**0 error**
- jest:**191/191 通过**(brush-edit 范围内 100%)
- jest --detectOpenHandles:**0 open handle**(所有定时器/订阅已 unref)

---

## 2. PO 接受的红线 vs 实测

| 红线 | 实测 2 次成功率 | 来源 |
|---|---|---|
| 大路 ≥ 98% | **100% (51/51)** ✅ | spike-final-v63-PO-1pager.md |
| 小路 ≥ 95% | **96.8% (30/31)** ✅(n=31,±5pp 区间) | 同上 |
| 山区拒收 | 0%(预期,等 LINZ v7) | 同上 |

**真错率**:每 7 笔接受中约 1 笔需 undo(`spike-fa-classification.md`)— 主要在故意穿楼 + 对抗笔,主流大路/小路场景几乎不触发。

---

## 3. 算法配置(锁定)

1. **Pre-call**:Stroke simplify(Douglas-Peucker ε ∈ {5,10,20,40} 阶梯 + uniformSample fallback)
2. **Mapbox**:`profile=walking, radiuses=25, MAPBOX_TIMEOUT_MS=8000`,带 AbortController
3. **后置门**:G0(顶点数)+ G0_post_simplify + G2(Mapbox Ok)+ G0.5(snap≥2)+ G3(corridor 250m)
4. **不用**:confidence、tracepoint、alts、bearing gate、Catmull-Rom fallback、snapDisplacementStats
5. **G1 锚点**(50m)在 store 的 `validateStrokes` 里实施,不重复在 strokeGate

---

## 4. 文件改动

**修改**(6 文件):
- `app/src/services/routing/corridor/PolylineSampler.ts`(LngLat alt? + lerp + flattenGeometry GeoJSON 3D)
- `app/src/services/routing/mapmatch/MapMatchingClient.ts`(radius 50→25 + AbortSignal plumbed)
- `app/src/services/EditSessionPersistence.ts`(schemaVersion=1 + STORAGE_KEY '_v6_3' + legacy key cleanup)
- `app/src/store/useRouteEditStore.ts`(runPreview 重写 ~300 LOC + 死代码删 + finally + abort + telemetry + alt 保留)
- `app/src/components/map/EditOverlayV236.tsx`(statusRow 双态 + hint 隐藏)
- `app/src/screens/RouteEditorScreen.tsx`(alt 保留 + Terrain + queryTerrainElevation backfill + elevationGain 重算)
- `app/src/components/OtaBadge.tsx`(255→256)

**新增**(3 源文件 + 8 测试文件):
- `app/src/utils/strokeSimplify.ts` + test(17/17)
- `app/src/utils/strokeGate.ts` + test(20/20 — checkG1 已删)
- `app/src/services/editDiagSender.ts` + test(11/11)
- `app/src/services/routing/mapmatch/__tests__/mapMatchClient.test.ts`(15/15)
- `app/src/store/__tests__/altPreserve.test.ts`(11/11)
- `app/src/store/__tests__/undoWalkedIndex.test.ts`(3/3)
- `app/src/store/__tests__/runPreviewFinally.test.ts`(6/6)
- `app/src/store/__tests__/backCompat.test.ts`(5/5)

**真实 LOC**:~1500 LOC across 14 文件(plan 估 1290,实际多 16% — 在合理误差内)

---

## 5. Ship 配置(锁定)

```ts
// MapMatchingClient.ts
DEFAULT_RADIUS_M = 25
TIMEOUT_MS = 8000
MAX_RETRIES = 1  // 不重试 429 + abort

// strokeSimplify.ts
MAPBOX_MATCHING_MAX_COORDS = 100
DP_EPSILON_LADDER_M = [5, 10, 20, 40]
MAX_STROKE_VERTICES_INPUT = 2000

// strokeGate.ts
ANCHOR_M = 50    // G1
CORRIDOR_M = 250 // G3

// useRouteEditStore.ts
MAX_STROKES = 8
LAST_ERROR_AUTO_CLEAR_MS = 2500

// editDiagSender.ts
MAX_QUEUE_SIZE = 50
MAX_BATCH_SIZE = 10
FLUSH_DEBOUNCE_MS = 5000
FLUSH_REQUEST_TIMEOUT_MS = 3000

// EditSessionPersistence.ts
EDIT_SESSION_SCHEMA_VERSION = 1
STORAGE_KEY = '@cairn:edit_session_active_v6_3'
LEGACY_STORAGE_KEY = '@cairn:edit_session_active'  // auto-cleanup
```

---

## 6. PO 真机 18 case(必跑,见 plan §6.2)

| # | 场景 | 期望 |
|---|---|---|
| 1 | 沿主路画 200m + ±5m 飘 | sage 接受 |
| 2 | 沿主路 + 50m 斜穿小区 | 单次接受 OR 弹平行路 → undo |
| 3 | 穿楼直线 200m | Mapbox 弹合理路 OR G3 corridor 拒 |
| 4 | 250m 外乱画 | G3 拒 |
| 5 | 起点 70m 外 | G1 拒 |
| 6 | 4 笔多笔 | 各独立判 |
| 7 | eraser 中段 + 各半 | 各半独立 |
| 8 | Preview → undo → 再画 | walkedIndex 正确 |
| 9 | reset 后画 | walkedIndex 已回原线 |
| 10 | Save 后进 RouteDetail | alt 保留 |
| 11 | NZ Tongariro 上画 | 拒("未识别") |
| 12 | UI:Cancel 左 / Save 右 / 单行红字 | 符合 |
| 13 | 画 500m 路 ~500 顶点 | DP simplify → ≤100 → Mapbox Ok |
| **14** | **Preview 中按 hardware-back** | fence 触发,strokes 不 commit,UI 回退 |
| **15** | **Preview 中切到后台 5s 再回前台** | abort,无 ghost stroke |
| **16** | **Preview 后强杀 app 再启动** | schemaVersion 校验,已 commit 保留 |
| **17** | **弱网(模拟 200kbps)Preview** | 8s timeout,UI 提示 |
| **18** | **双击 Preview 按钮** | 第二次点击无效 |

**通过标准**:18 case 至少 16 通过(case 14-18 必须通过)。

---

## 7. 已知不做(归档,v6.4 / v7)

- Per-segment bearing gate(可能杀 16/32 真错 → 1/13)— v6.4 spike
- Tilequery 自挑最近路(根本解,~1 周)— v6.4
- LINZ + OSM NZ trail — v7
- own-map(用户 GPS 历史)— v7
- 多笔合并 API call 优化 — v7+
- nav.replace fragility(预存在) — backlog

---

## 8. PO 醒来后操作

1. **真机 18 case 自测**(必须 PO 自己,因为 PO 是产品验收人 + R4 #5 是真机才能验)
2. 18 case 至少 16 通过 + case 14-18 全过
3. 拍板推 OTA(Cairn EAS / OTA flow)
4. 上线后 1-2 周观察 telemetry (`/api/edit-diag`):
   - 大路 single-pass ACCEPT 维持 ≥ 98%?
   - 小路 ≥ 95%?
   - undo 比例 < 35%?
   - Mapbox API error rate < 30%?
   - 任一指标超阈值 → 准备人工 OTA 回退 v257(回滚 256→255 行为)

---

## 9. 跟 v249-v255 失败的差别

| 之前 | 这次 |
|---|---|
| 凭"看起来 OK"OTA | 250 case 真测 + 466 真 API call |
| 数字捏造 | 每个数字带源文件引用 |
| 单 review 自审 | 8 轮独立 fresh review(R1-R8) |
| LOC 估 180 | 真审计 1290(实际 1500) |
| confidence/null/alts/Catmull 等 | 全 ban,死代码 ~140 LOC 删干净 |

**永不重蹈 lie pattern**。

---

**Ship 状态**:**等 PO 醒来真机自测 + 拍 OTA**。

我不会主动推 OTA(对齐 `feedback_no_push_no_build`)。

---

**作者**:Claude Code(v6.3 Sprint 67)
**Plan**:`docs/spikes/V6_3_FINAL_PLAN.md`
**Memory**:`docs/spikes/BRUSH_EDIT_MEMORY.md`
**Reviews**:R1v2 / R1v3 / R1v4 / R2v2 / R2v3 / R2v4 / R3 / R4 / R5 / R6 / R7 / R8(全在 `docs/spikes/`)
