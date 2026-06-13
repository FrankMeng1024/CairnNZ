# Brush Edit Spike 归档(v6.2 设计依据)

**目的**:v6.2 brush-edit 算法 / UX / 数据决策的依据。所有 spike 实测结果归档,后续 v7 / NZ 山区 / 优化时直接拿。

**日期**:2026-06-13
**Spike 总数**:8 个
**Test corpus**:250 真实笔(5 subagent 各产 50)

---

## 1. 产品红线(锁定)

| # | 要求 | 来源 |
|---|---|---|
| 1 | Mapbox 渲染的路 → 能画就能 snap | PO 反复强调 |
| 2 | 沿路画 → 干净 snap,不歪扭 | v249-v255 痛点 |
| 3 | 正常画 + 一段斜穿小区 → 自动靠路 | PO 250m 内允许微调 |
| 4 | 250m 外乱画 → 拒收 | corridor 守门 |
| 5 | 城市 FA(误接受)≈ 0 | 红线 |
| 6 | 山区无 Mapbox 数据 → 拒收(未来再补) | 接受 |

---

## 2. Spike 索引

| # | Spike | 输出 | 关键发现 |
|---|---|---|---|
| 1 | 上海地区覆盖 | `spike-coverage-tests.txt` | 12 笔实测 100% snap,城市 OK |
| 2 | NZ 多区域 | `spike-nz-tests.txt` | 城市 GREEN,NZ 山区 NoMatch 普遍 |
| 3 | Mapbox 内部 + bearings | `spike-deep-tests.txt` | confidence 不可信;bearings 提升 5e+05× |
| 4 | 替代方法 | `spike-methods-tests.txt` | queryRenderedFeatures 可用;tracepoint distance 单独不够 |
| 5 | 最后 3 漏洞(国内网/多笔/eraser) | `spike-china-net.txt` 等 | 国内 173ms,无超时;eraser 不对称 bug |
| 6 | 大样本判据 121 case | `spike-thresholds-corpus.txt` | 6 条判据 70% 误拒 → 改 2 条(J1+J6) |
| 7 | 250 case 终极 | `spike-jury-results.csv` | J1+J6 仍漏 4 case → 加 bearing 判据 |
| 8 | 非阈值判据(Tilequery + 建筑)| `spike-final-NT.txt` | Tilequery / 建筑判据效果差 → bearing 是答案 |
| 9 | 海拔(alt) | `spike-mapbox-alt.txt` | Mapbox API 不返回 alt;SDK `queryTerrainElevation` 本地查 0 网络 |
| 10 | 导航兼容 | `spike-nav-compat.txt` `spike-nav-e2e.txt` | 导航数学已对的;数据字段对未来导航够用 |
| 11 | 业界做法 | `spike-H-industry.txt` | 没人做过用户私有 GPS snap;LINZ 是 NZ 护城河 |
| 12 | NZ 数据源 | `spike-I-data-sources.txt` | OSM + LINZ 实测覆盖完整 |

---

## 3. 锁定的算法判据(v6.2 ship)

**所有阈值都是 250 case 实测出来的,不是猜的**。

### 输入 Mapbox /matching/v5/walking 参数

```
profile = walking
radiuses = 3 per coord (effective 9m search ring)
bearings = computed per stroke segment, ±15° tolerance
annotations = distance
tidy = false  (don't let Mapbox drop our points)
geometries = geojson
overview = full
```

### 拒收门(必须 ALL pass 才接受)

**门 1 — 锚点规则**:笔起点或终点之一必须在原 route 50m 内
- 实测:防止"挂靠链"飘到 100m 外的攻击(v249-v255 的 267m 直线 bug 根因)

**门 2 — 几何偏移**:笔每个点离 Mapbox snap 出来的路 ≤ 10m
- 实测 250 case:阈值 10m → FA=0%(对 4 个穿楼/穿水中 3 个),FR ≈ 16%
- 阈值 8m 更紧,FR 18%。10m 是 Pareto 最优。

**门 3 — 朝向一致**:笔的方向 vs Mapbox snap 路的方向 ≤ 15°
- 实测:杀掉"草坪上画 → Mapbox 强 snap 到旁边路"的 case
- J4-SH-007 = 52° → 拒 ✓
- J4-SH-010 = 15° → 拒 ✓
- J4-SH-011 = 18° → 拒 ✓
- J2-039 漏(草地平行小路 6°,与真路同向 — 已知边界)

**门 4 — Mapbox 自报错**:`code != 'Ok'` → 直接拒(NoMatch / NoSegment / 网络)

### 已删的判据(实测 0 区分能力)

- ❌ `confidence ≥ 0.5` — 在我们目标地区合法 snap 也常返 0
- ❌ `tracepoint distance ≤ 8m` — 跟正确性不相关
- ❌ `null tracepoint ratio` — 250 case 多次误判
- ❌ `alternatives_count ≤ 5` — 250 case 没区分能力
- ❌ `matched_len 50%-150%` — 250 case 误拒率太高

---

## 4. 关键发现(避免未来再走弯路)

### Mapbox confidence 在我们地区是噪音
- 上海 / Auckland CBD 干净 snap 也常返 confidence ≈ 0
- **不能当判据**

### 真正有用的判据是几何
- 笔点离 snap 路距离(门 2)
- 笔方向 vs snap 方向(门 3)
- 这两个**几何级**判据,不依赖 Mapbox 自评

### 已知边界(无法用阈值解决)
- **J2-039 类型**:用户在小区里画 10m 直线,平行于旁边的真路,方向也一致
- 任何阈值算法都把它判成"沿路画"
- 这种 case 概率很低(用户要刻意进小区平行画),且我们有 undo 兜底
- **future fix**:OSM Overpass 后端验证(SubagentI 方案,~1 周工程)

### NZ 山区
- Tongariro / Mt Cook / Abel Tasman / Routeburn 在 Mapbox /matching 全 NoMatch
- **现状 = 拒收**,文案"未识别到这条路"
- **future fix**:LINZ + OSM NZ 数据(SubagentH+I 方案,~2-3 周工程)

---

## 5. UX 决策(锁定)

| 项 | 决定 |
|---|---|
| 起笔规则 | 第一笔起点必须在原 route 50m 内,后续笔可从已存 stroke 接 |
| 拒收文案 | "未识别到这条路,请重画或贴近主干道"(中性) |
| Preview | 手动按钮(用户主动) |
| 拒收笔处理 | 立即从画布消失 + 红字提示 |
| Save 名字 | 必须用户填,无默认 |
| Cancel/Save 位置 | Cancel 左,Save 右(全局规则) |
| 错误提示 | 单行 XOR(error 红 / warning 黄 / hint 灰),顶部不再有 pill |
| 颜色 | 只 sage(成功)/ 红(拒收),不上 amber 多色 |
| 用户错误兜底 | 算法漏少数 case → 用户 undo / reset |

---

## 6. 数据存储决策

### Route schema(对未来导航 100% 够用)

```ts
Route {
  id, name, description, createdAt, updatedAt
  points: { lat, lng, alt?: number | null }[]   // alt 必须保留(v6.2 修复)
  originalPoints?: RoutePoint[]
  segments?: EditSegment[]
  waypoints, distanceM, elevationGainM, ...
}
```

### 海拔保留(v6.2 必须修)

| 路径 | 海拔来源 |
|---|---|
| Save-as-route 不编辑 | 原 GPS 的 alt(必须修复:RouteEditorScreen 不再 strip) |
| Brush 编辑过的段 | Mapbox SDK `queryTerrainElevation([lng,lat])` 本地查,**0 网络** |
| 原 GPS 段(splice 头尾)| 原 GPS 的 alt 保留(splice 时插值) |

### 数据完整性

- snap 后 distance / elevationGainM 重算
- 顶点密度:Mapbox snap 实测中位 7m,最大 35m(实测,不是 83m)
- 现有导航数学(`distanceToPolylineM` etc.)是 segment-based 已经对,无需改

---

## 7. API 消耗模型

### 一次 edit 调用

- 画过程:queryRenderedFeatures(本地)+ 0 网络
- Preview:每笔 stroke = 1 次 /matching call(stroke 指纹缓存命中复用)
- Save:0 Mapbox 调用(写自己 backend)
- queryTerrainElevation 海拔:本地 0 网络

### 估算

| DAU | 假设 | /matching/月 | 钱(超 100k 免费 + $0.50/1k) |
|---|---|---|---|
| 1,000 | 2 edit/日 × 3 笔 | 180k | $40 |
| 10,000 | 同 | 1.8M | $850 |
| 100,000 | 同 | 18M | $8,950 |

### v6.2 不做优化(PO 拍板)

未来优化路径(留 v7+):
- 多笔合并请求(省 70%)
- 后端代理 + 全局缓存(省 30-50%)
- queryRenderedFeatures 加查"建筑/水"(省 20-30%)

---

## 8. NZ 山区未来路线图(留 v7+)

### Phase 2 — own-map(用户自己 GPS 历史)
- Cairn 已有 `PointCloudIndex`(kdbush)和 sessionStore
- 用户自己以前走过的 trail → 这次画到那 → snap 到自己轨迹
- 工程 ~1 周(后端 + client wire,数据已有)
- 局限:第一次去的地方没用

### Phase 3 — LINZ + OSM(NZ 全国官方 trail)
- LINZ Track Centrelines:CC BY 4.0 免费,vector polylines,~50MB,Tongariro/Routeburn/Milford/Mt Cook/Abel Tasman 全覆盖
- OSM NZ extract:GeoFabrik 397MB PBF,ODbL,实测 Overpass 在所有 NZ 标志性 trail 都有完整数据
- 后端服务 `/api/trails/near` + 客户端 fallback
- 工程 ~2-3 周(后端 + 客户端)
- 这是真正的 NZ "走过的路才是路" 实现

### Phase 4 — 导航接通
- 7 处 wire(start-on-route 按钮、route 传 tracking、调 computeOffRoute、播报、进度、完成检测)
- 数据已经够,数学已经对
- 工程 ~1 周

---

## 9. 已知 v6.2 范围外

- 多名同名 routes(以后)
- 离线编辑(以后)
- routes 列表 thumbnail 实时(以后)
- 多笔合并 API 调用优化(以后)
- 后端缓存(以后)
- 转弯播报 / 街名播报(以后,用 Directions API live)

---

## 10. 文件位置

- 7 个 spike 报告:`/c/Users/I585134/spike-*.txt` `.json`
- 5 subagent 250 case:`spike-jury-J1.json` 到 `J5.json`
- 250 case 跑出来的判据矩阵:`spike-jury-results.csv` `spike-jury-summary.json`
- 缓存的 Mapbox 响应:`/c/Users/I585134/spike-cache/`(可重跑验证)

---

**最后更新**:2026-06-13 — v6.2 plan 写之前
**下一步**:写 v6.2 完整开发 plan,subagent 严审,开发,严审,推 OTA
