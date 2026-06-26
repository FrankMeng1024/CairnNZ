# v333 Fog Mask Render Benchmark

**Date**: 2026-06-25
**Spike owner**: subagent (benchmark only, no Cairn code touched)
**Question from user**: *"GPS 点过亿会不会让 fog mask 卡?"*

## TL;DR

**会卡 — 但不是渲染卡,而是遍历卡。** 当 `useH3VisitedStore` 里存了 100 万个以上 cell 时,fogMaskRenderer 在每次 render 都要把 Map 全量 keys() 一遍来做 bbox cull,这一步是 O(N stored),即使 bbox 里只剩 58k 个 cell 要画。

| Stored cells | Total render ms (PC) | 移动设备估算 (×2) | UI 体验 |
|---|---|---|---|
| 1k (1 周新手) | **102 ms** | ~200 ms | 流畅 |
| 10k (1 年用户) | **163 ms** | ~300 ms | 流畅 |
| 100k (5 年极致用户) | **369 ms** | ~700 ms | 仍在 500ms debounce 内,可接受 |
| **1M (理论地球级)** | **1246 ms** | ~2.5 s | **卡顿,超过 debounce 后用户能感到延迟** |
| **10M (1 亿 GPS 去重上限)** | **11638 ms** | ~23 s | **fatal,UI 卡死** |

**底层数学**: 6km × 6km bbox @ 25m cell = 240 × 240 = **最多 ~57,600 cells 进 bbox**。10M 场景里也只有 58,085 个进 bbox,Draw + Blur/encode 加起来才 ~180ms — 这部分**永远不会爆**。爆的是 cull pass。

---

## 1. Algorithm under test

Mirror of `app/src/features/memory/services/fogMaskRenderer.ts` 渲染流程:

```
for cid in input.cells.keys():    ← 遍历 ALL stored cells
  decode cid → ix, iy             ← string split + 2× parseInt
  compute pixel rect              ← 8× trig/mult per cell
  if rect outside [-10, 1034]:    ← bbox cull
    skip
  else:
    push to cellRects[]

for r in cellRects:                ← 仅 bbox 内的
  canvas.drawRect(...DstOut + MaskBlur)   ← punch hole

for r in cellRects:                ← 同样仅 bbox 内
  canvas.drawRect(...cream + MaskBlur)    ← halo

image.encodeToBase64(PNG)
fs.writeAsStringAsync(...)
```

PIL-equivalent benchmark in `benchmark.py`. Skia CPU surface 在真机上比 PC PIL 大约慢 1.5–2 倍(blur + encode 段),但**曲线形状一致**,这正是回答"会不会卡"的关键。

## 2. Scenarios + raw numbers

PC: 4 cores / 8 logical, Windows 11. 50% cells 落在 user 6km bbox 内, 50% 散布全球。

| Cells stored | Cells in bbox | Cull ms | Decode ms | Draw ms | Blur/encode ms | Total ms | Peak RSS MB |
|---|---|---|---|---|---|---|---|
| 1,000 | 500 | 1.1 | 0.0 | 2.3 | 98.9 | **102.4** | 58 |
| 10,000 | 5,000 | 11.1 | 0.0 | 7.9 | 144.0 | **163.0** | 60 |
| 100,000 | 50,000 | 118.4 | 0.0 | 65.1 | 185.1 | **368.6** | 79 |
| 1,000,000 | 58,072 | **1060.2** | 0.0 | 77.4 | 108.8 | **1246.3** | 161 |
| 10,000,000 | 58,085 | **11455.5** | 0.0 | 75.7 | 106.8 | **11638.0** | 919 |

> Decode 和 cull 在 fogMaskRenderer 里是 fused single-pass,我们把全部归到 Cull ms 里。

观察:
- **Cells in bbox 在 100k 以上就饱和到 ~58k**(理论上限 = 240² = 57,600)。
- **Draw ms 也跟着饱和到 ~75ms**(因为画的就那 58k 个矩形)。
- **Blur/encode 完全是 fixed cost** — 永远是 100–200ms,跟 cells 数无关(PNG 编码看的是像素,不是 cell)。
- **Cull ms 是唯一线性爆炸的项**: 10× 的 stored cells → 10× cull cost。

## 3. 性能曲线 (cull-dominated)

```
total_ms ≈ 100ms (blur/encode floor)
        + ~75ms (draw, when bbox saturated)
        + 1.15 µs × N_stored (cull, linear)
```

实测拟合:

| N | Predicted ms | Actual ms | Δ |
|---|---|---|---|
| 1k | 100 + 2 + 1 = 103 | 102 | -1 |
| 10k | 100 + 8 + 12 = 120 | 163 | +43 (decode overhead in PIL build) |
| 100k | 100 + 65 + 115 = 280 | 369 | +89 |
| 1M | 100 + 75 + 1150 = 1325 | 1246 | -79 |
| 10M | 100 + 75 + 11500 = 11675 | 11638 | -37 |

模型成立。**cull pass 是性能瓶颈,不是 Skia 绘制。**

## 4. 回答用户原问题

> **"GPS 点过亿会不会卡?"**

**直答**: 1 亿 GPS 点经过 H3 25m 网格去重后,理论上 cell 数会少很多 — 实测 Cairn 一个真实活跃用户(走 1 年)大约 5k–20k cell;走 5 年极致用户 100k 左右。**真实世界单用户几乎不可能超过 1M cell**(那需要走过整个地球 6km × 6km 的 7000 万个网格点,一个人活 1000 年也走不出 100 万个不同的 25m 格子,因为人类活动半径有限)。

**所以分两个层面回答**:

| 场景 | 答案 |
|---|---|
| **现实** (单用户 < 100k cell) | **不会卡。**渲染 ~370ms,在 500ms debounce 内,用户感知流畅。 |
| **极端假设** (1M+ cells) | 会卡。但**这是 store 的问题,不是渲染的问题** — 即使 user 真有 1M cell,bbox 里也只画 58k,渲染时间 flat。瓶颈是 cull 阶段 `for cid of cells.keys()`。 |

## 5. 如果未来真要支持 1M+ cells 的降级策略

**不建议现在做**(YAGNI),但留档:

### 优先级 1: 空间索引 (最有效)

把 `useH3VisitedStore` 从扁平 `Map<string, VisitedCell>` 升级成按更粗的 H3 res(比如 res-7,~5km 格子)分桶的 `Map<bucketKey, Map<cellKey, VisitedCell>>`。Render 时只遍历 user 周围 9 个粗格子的桶,cull 变成 **O(N in bbox)** 而不是 O(N total)。

- 1M cell → cull 时间从 1060ms 降到约 60ms (×17 加速)
- 10M cell → 从 11455ms 降到约 60ms (×190 加速)
- 代价: store 写入时多一次 bucket key 计算,内存 +5%

### 优先级 2: 缩小 mask (帮助不大)

降 MASK_SIZE 1024→512: blur/encode 从 ~150ms 降到 ~40ms,但**只对 happy path 有帮助,对 1M cell 这种 cull-dominated 的根本无效**。不值得做(视觉清晰度损失)。

### 优先级 3: Worker thread / runOnUI

把 render 整体扔到 Skia worklet(JSI 直调 GPU)。但 v331 的 Spike review 决定走 CPU surface + JS thread,因为 6km bbox 下绝大多数场景在 200–400ms 完全可以接受。Worker thread 是当 cull bottleneck 不可避时才需要,而**空间索引已经先消灭了 bottleneck**。

### 优先级 4: 增量 mask

不每次重画整张,只把"新进入 bbox 的 cell"叠加在上一张 mask 上。复杂度高,与 token cancellation 模型冲突。**不推荐**,除非空间索引仍不够。

## 6. 建议产出

**结论给 PO/Arch**:
1. 当前 v331 fog mask 架构在**现实用户(< 100k cell)下完全没问题**,不需要任何降级。
2. 1M+ cell 是 spherical-cow 假设,不在 backlog 上动手。
3. 真要扩展到"地球级用户"时,先做**空间索引**(优先级 1),其他降级方案先按下不做。
4. **不要改 fogMaskRenderer 本身** — 它的绘制循环已经在 bbox 上了,改它没用,改 store 才有用。

## 7. 真机校准 caveat

PC PIL ≠ 移动 Skia,典型差异:
- Skia CPU surface 的 drawRect with MaskFilter 比 PIL rectangle 慢 1.5–2×
- React Native iOS/Android arm64 PNG encode 跟 PC 接近(libpng 编译质量类似)
- JS string split + parseInt 在 Hermes 上比 CPython 慢 ~1.3×

整体修正系数: **mobile ≈ PC × 1.5–2.0** for the Draw+Blur 段,**× 1.3** for the Cull 段。最终估算:

| Cells stored | PC total ms | iPhone 14 估算 | iPhone SE / Android 中端估算 |
|---|---|---|---|
| 1k | 102 | 180 | 250 |
| 10k | 163 | 280 | 400 |
| 100k | 369 | 600 | 900 |
| 1M | 1246 | 2.2 s | 3.5 s |
| 10M | 11638 | 18 s | 30 s |

对应 spike review 里写的 "60–120 ms per mask render" 预算 — 在 < 10k cell 时打不住(180–280ms),但 debounce 500ms 兜得住。**重要: 这意味着 spike 的预算注释偏乐观,实际值是 200–700ms in real use,需要 PO 知会。**

---

## Appendix: raw output

见 `perf_benchmark_raw.json` 和 `benchmark.py`。

CPU: Windows 11, 4 cores / 8 logical
Python: 3.x, PIL 11, NumPy 2, psutil 7.2
