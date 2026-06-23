# GPS 探索 app 业界调研报告(独立调研员 B)

**调研日期**:2026-06-22
**调研方法**:GLM 搜索 (24 个 query) + 训练数据中的公开知识
**重要说明**:本报告**前置标注证据强度**,任何"推测"项明确标记。Fog of World 搜索结果接近空(GLM 中文搜索引擎对该 app 覆盖差),核心结论依赖训练知识 + 工程推理,**用户应在执行 Fog of World 相关方案前再独立 Reddit / App Store 验证**。

---

## 0. 证据强度图例

| 强度 | 含义 |
|---|---|
| **HARD** | 本次调研有原始引文/截图证据 |
| **KNOWN** | 公开常识 / 训练数据强支持 (训练截止前材料丰富) |
| **INFERRED** | 基于 KNOWN 事实做工程推理,有合理性但未亲证 |
| **WEAK** | 单点信息源 / 调研失败,需独立验证 |

---

## 1. 视觉效果总览(表)

| 产品 | 风格 | 数据规模 | 实现猜测 | 用户卡顿评价 | 证据强度 |
|---|---|---|---|---|---|
| **Fog of World** | 深色像素 fog,网格化遮罩 | 单用户 4-8 年累计可达 5000-20000 tiles,有用户报告 50000+ | **栅格 tile-based**(0.0005° ≈ 50m grid)+ 持久化栅格图 | 老用户报告地图缩远后渲染慢、startup 慢、占空间大 | KNOWN + INFERRED |
| **Squadrats** | 几何方格(grid square) | 每 0.001°×0.0006° 一格 | OSM tile + 完成网格 overlay | 流畅(网格数有限) | KNOWN |
| **Pokemon GO** | 不是 fog,是 spawn 圈+POI 解锁 | 用户位置实时,无累积 | Niantic LBS 引擎,服务端瓦片 | 流畅,但电池耗大 | KNOWN |
| **Strava Personal Heatmap** | 半透明亮线 over basemap | 全用户所有活动累积 | 服务端 raster heatmap tile(WebMercator z0-z15) | 流畅(服务端预渲染) | KNOWN + HARD |
| **AllTrails / Komoot** | trail polyline 标注 | 单 trail < 几千点 | polyline 直接渲染 | 流畅 | KNOWN |
| **Google Maps Timeline** | 路径折线+地点 pin | 多年累积 | 服务端聚合,客户端只显示选定日期 | 流畅(不渲染全部) | KNOWN |
| **Pikmin Bloom** | 走过路径自动种花 | 当日路径 | 当日 polyline + AR | 流畅 | KNOWN |
| **OruxMaps** | 原生轨迹 polyline | 单 track 可数万点 | KML/GPX 直接绘 | 老 track 多了会卡 | WEAK |
| **Veil / Fog Explorer** | 类 Fog of World | 同 Fog of World | 同上 | 同上 | WEAK |
| **微信运动** | 简单 polyline | 单日 | 直接 polyline | 流畅 | KNOWN |

---

## 2. 深度分析(按重要性排序)

### 2.1 Fog of World (最重要参考) ⭐⭐⭐

**产品定位**:商业 GPS 探索 app,iOS / Android,2014 起售,买断制 + 订阅同步。世界地图被"未探索的迷雾"覆盖,你走到哪里,该区域的雾就被永久揭开。

**视觉风格** [KNOWN]:
- **深色 / 中性灰色雾遮罩**,饱和度低,**云絮颗粒质感**(并非纯几何方块)
- 揭开区域露出真实地图底图(可切换 Apple Maps / Google Maps)
- 揭开的"形状"实际是 tile-aligned 但边缘做了**羽化模糊处理**,看起来像真实云雾被驱散
- 没有动画解锁特效(老版本),新版本加了"雾消散"过渡

**实现推测** [INFERRED based on 公开开发者透露 + 行为观察]:
- **栅格 tile 系统**:经度 0.0005° × 纬度 0.0005° 划分(约 50m × 50m)
- 每个 tile 一旦走过 = 永久"explored",存为位图/位向量
- **渲染机制**:很可能是 **alpha mask texture** 叠加在地图 tile 上,而非每帧重画几何
  - 缩放级别低(看世界地图)时:服务端预生成的"探索摘要" tile
  - 缩放级别高(街区)时:客户端从本地存储的 explored tile 集合实时合成 mask
- **不是逐点(GPS point)渲染**,是 tile-aggregated,这是 Cairn 当前思路最大的区别 ⚠️
- 用 SQLite 或自定义二进制格式存 tile bitset

**性能数据** [INFERRED,需 Reddit 验证]:
- 4 年走过 数千 ~ 上万 tile 的用户报告:**正常**,缩放、平移 60fps
- 5+ 年极端用户(走全球、骑行长途)报告 50000+ tile:**有冷启动慢、地图加载慢、备份大(几十 MB)**
- **关键**:他们不是"渲染每个点",所以即使 tile 数膨胀,渲染负担线性可控
- Reddit 投诉点(模糊回忆,需验证): cloud sync 慢、Android 版优化差于 iOS

**为什么 Fog of World 不卡** [INFERRED]:
1. **离散化**:从 GPS 点流 → tile bitset,N 个 GPS 点折叠成 ≤N 个 tile(通常远少于,因密集 GPS 点落在同一 tile)
2. **mask 而非 mesh**:用一张半透明纹理覆盖整个视口,explored 区域 alpha=0,unexplored alpha=0.85。Shader 一次性合成,与 tile 数无关
3. **空间索引**:只把当前视口范围的 tile 装入 GPU texture
4. **持久化结构紧凑**:bitset(每 tile 1 bit),50000 tile = 6KB,IO 几乎免费

**启发点 → Cairn**:
- 当前 Cairn 如果是按"每个 GPS 点画一个圆"的思路 → **错路**,几千点必卡
- 应该 **离散化到 grid + 用 mask texture 渲染**
- 视觉精致度来自"边缘羽化 + 颜色质感",**不是来自点的密度**

### 2.2 Squadrats ⭐⭐

**产品定位** [KNOWN]:基于 Veloviewer 概念的 OSM grid square 追踪,显式"我探索了多少个 0.001°×0.0006° 的方格"。骑行 / 跑步爱好者用。

**视觉风格** [KNOWN]:
- 完全几何方格,**没有云雾感**,每个完成的格子= 半透明色块
- 提供"max square"(连续方格组成的最大正方形)和"max cluster"(连通块)挑战
- **不是遮罩,是高亮**——只画走过的格子,未走过的就是底图

**视觉精致度**:不追求美感,数据可视化风格。但**留存机制极强**:用户为了凑出 5×5 max square 会专门去某个区域走

**用户感受** [KNOWN]:
- 不卡(每个城市才几千格子)
- 像 RPG 任务地图,有"集齐成就感"
- 缺点:**机械感强**,不像 Fog of World 那种"探索未知"的诗意

**启发**:**几何方格的留存力**(凑方阵)比 fog 模糊揭示更强,但视觉感受差。Cairn 可以混合:大尺度看是诗意 fog,放大看可显示离散格子作为"步行勋章"。

### 2.3 Strava Personal Heatmap ⭐⭐

**视觉风格** [HARD - Strava 官网 + 知乎 Keep 文章对照]:
- 半透明亮色线条(单色或渐变)over 暗色地图底图
- **不是 fog**,是"高亮走过路径"
- 颜色不同= 密度不同(同一条路走的次数)

**实现** [KNOWN]:
- **服务端预渲染 raster tile**(WebMercator 标准切片,z0 到 z15)
- 客户端只是普通 map tile consumer,**完全不渲染 GPS 点**
- 全平台 1 亿用户的 heatmap 每天更新,扛得住,因为是离线生成

**关键**:Strava 走的是"**服务端 heavyweight 渲染 + 客户端 zero-cost 显示**"路线。本地手机端从来不知道有几亿条 GPS 点。

**Keep 案例**(国内 [HARD],基于知乎"四六文摘"文章):
- Keep 跑步地图用**不同颜色**(亮黄 = 高密度,深绿 = 中密度,浅绿 = 低密度)
- 用户**误读**:以为黄色 = 跑的人最多。实际是 keep 编码的别的语义
- 启示:**颜色语义必须清晰沟通**,不然用户会自己脑补错

**启发** → Cairn:
- 如果 Cairn 用户量级小、能纯本地,可以走 Fog of World 路线(本地 tile bitset)
- 如果想做社交化"全城热力",必须服务端 raster tile,**不要在手机上算几万点**

### 2.4 Pokemon GO ⭐

**注意** [KNOWN]:Pokemon GO **不是 fog of war 类型**,常被误归。它的"探索"是:
- 用户位置周围 50m 实时圈
- POI(PokéStop / Gym)从服务端拉取
- **没有累积探索状态**,昨天走过的地方今天不亮

**与 Cairn 相关性**:**低**。但有一点借鉴:
- Niantic 用 **S2 cell**(Google 的全球分层网格)做空间索引,这是世界级方案的代表
- 全球任何点都映射到一个 cell ID,server-side 用 cell ID 索引,客户端用 cell ID 查询
- **Cairn 也可以用 S2** 或自定义 grid 作为离散化基础

### 2.5 AllTrails / Komoot

[KNOWN]
- **不做累积探索**,只做单 trail 完成度
- 一条 trail 通常 <几千 GPS 点,polyline 直接画毫无压力
- 留存机制:trail 数据库 + 评论 + photo + recommendation
- **与 Cairn 弱相关**(Cairn 是个人累积探索,这俩是路书 app)

### 2.6 Google Maps Timeline

[KNOWN]
- 服务端聚合,客户端**只渲染当前选定日期/月份**
- 当你看"2024年6月"的 timeline,只画那个月的 polyline,几百点
- 累积视图(visited countries / cities)用国家/城市作为离散单元,**不是 GPS 点**

**启发** → Cairn:
- 如果累积视图卡,做 **时间切片显示**(只渲染本月 / 本年)
- 离散单元(城市、区域)永远比 GPS 点便宜

### 2.7 Pikmin Bloom

[KNOWN]
- Niantic 的"散步种花"产品
- 当日走过的路径自动种花,**只显当日**,历史折叠
- 用花朵贴图替代 polyline,**视觉化散步**
- 留存差(2024 全球月活下降明显)

**启发**:**用"种植"隐喻代替"揭开"** 也是一条路。Cairn v0.2.6 的"植物"系统正好契合。Pikmin Bloom 的失败提示:**散步本身不够,需要叠加社交 / 收集**。

### 2.8 微信运动地图

[KNOWN + HARD]
- 国内主流就是企业活动小程序("线上健步走"、"重走长征路")
- 视觉极简,polyline + 地标 pin
- 留存靠**单位组织**(强制)而非自驱动
- **不参考**:产品形态不同

### 2.9 OruxMaps / OpenAndroMaps

[WEAK]
- 户外硬核 app,户外离线地图 + GPX 轨迹播放
- 单 track 可载入数万点,**会卡**(老用户论坛反映)
- 解决方案:**用户手动按日期/区域筛选,不显示全部**
- 不是面向消费者的探索产品

### 2.10 Fog Explorer / Veil

[WEAK]
- Android 上 Fog of World 的开源/廉价替代品
- 视觉粗糙(直接画方格,无羽化)
- 用户量小、评价一般

---

## 3. 用户"产品感觉"模式 — 哪种最被喜欢?

[KNOWN 综合,无单一硬证据]

**用户最爱的探索 app 共性**:
1. **未知感**:看到大片未揭开的区域会有"还有这么多地方等我去"的驱动力 → Fog of World 强,Squadrats 中,Strava 弱
2. **沉浸感**:云雾质感 > 几何方格 > 单纯 polyline
3. **进度可见**:有"已揭开 X%"或"达成 N 城"的明确数字 → 留存关键
4. **可分享**:截图可发朋友圈 → Fog of World、Strava 都强

**用户最讨厌**:
- 卡顿(老用户的第一离开原因)
- 数据丢失 / 同步失败
- 隐私顾虑(走过的所有路 = 个人轨迹 = 敏感)
- 单调(只是看地图,无目标)

---

## 4. 关键 insight

### 4.1 "遮住未探索" vs "高亮走过"

[KNOWN + INFERRED]
- **遮住未探索**(Fog of World):**视觉冲击力强,有探索叙事**,适合"个人世界"产品
- **高亮走过**(Strava):**视觉热闹但平庸**,适合社区/数据产品
- **混合方案**:近距离看是"路径+种植"(Cairn 当前思路),远距离看是"fog"——可能是最好的

### 4.2 颗粒感 / 云雾感 / 几何感 — 哪种留存高?

[INFERRED]
- 留存最高:**云雾感(Fog of World 10 年活跃)**
- 留存中:**几何感(Squadrats 小而忠诚)**
- 留存最低:**纯 polyline(用户走完不回看)**

**原因猜测**:云雾营造"世界还有未知",几何营造"集齐成就",polyline 只是历史记录。

### 4.3 解锁动画对留存有多大影响?

[INFERRED,无硬数据]
- **巨大**——但要克制
- Fog of World 老版本无动画,新版本加了渐入,用户欢迎
- Pikmin Bloom 的种花动画过度,反而显得幼稚
- 建议:**揭开瞬间 200-400ms 柔和过渡 + 偶尔的"里程碑庆祝"**(每 100 tile 一次)而非每次都炸

### 4.4 大数据量(>10k 点)产品都怎么扛住的?

[INFERRED]
**业界没有 app 真的渲染 10000 GPS 点**。一律是:
1. **离散化**:GPS 点 → tile / grid / cell。10000 点 → 1000-3000 tile(根据移动密度)
2. **空间索引**:R-tree / Quadtree / S2 cell。视口内查询 O(log N)
3. **mask 渲染**:一张 texture 覆盖视口,不是 N 个几何对象
4. **服务端兜底**:超大量数据移到 server,客户端只拉 raster tile

**Cairn 当前如果在前端绘制 N 个圆 = N 个 draw call**,在 5000+ 时必卡。这是行业级共识。

---

## 5. 给 Cairn 的 5 个产品 / 视觉建议

### 建议 1:**离散化到 tile,不要逐点渲染** ⭐⭐⭐
- **用户感受**:不再卡顿,走 5 年还能流畅
- **做法**:每个 GPS 点四舍五入到 ~30-50m grid(0.0003-0.0005°),存为 tile bitset
- **参考**:Fog of World、Pokemon GO(S2 cell)

### 建议 2:**用 alpha mask texture 渲染,而不是 N 个 mesh** ⭐⭐⭐
- **用户感受**:数据量无限增长,渲染开销恒定
- **做法**:视口对应一张 alpha texture,explored tile 处 alpha=0,其余 alpha=遮罩浓度。一次合成,与 tile 数解耦
- **参考**:Fog of World

### 建议 3:**边缘羽化,营造云雾质感,不要硬边缘方块** ⭐⭐
- **用户感受**:精致感、诗意,而非游戏地图风
- **做法**:tile 边缘做 Gaussian blur 或 SDF 平滑过渡,半径 1-2 tile
- **参考**:Fog of World 视觉精致度的核心来自这里

### 建议 4:**叠加"成就 / 里程碑"机制,但克制庆祝动画** ⭐⭐
- **用户感受**:"我真的在进步",不是机械感
- **做法**:每 100 tile / 每个新城市第一次解锁 / 每 5×5 max square,给一次礼花式微动画(< 1 秒)。日常解锁仅柔和淡入
- **参考**:Squadrats 的 max square + Fog of World 的克制

### 建议 5:**远近不同视觉策略** ⭐⭐
- **用户感受**:zoom 远看世界全貌,zoom 近看自己脚下
- **做法**:
  - zoom < 12:显示 fog 遮罩,粗粒度 tile(0.005°)
  - zoom 12-16:fog + 局部"步行 polyline"叠加
  - zoom > 16:显示植物/具体路径,fog 淡出
- **参考**:Google Maps Timeline 的 LOD 思想

---

## 6. 调研局限性说明

1. **Fog of World 的核心证据未获**:GLM 搜索引擎对该 app 几乎无覆盖。本报告核心结论来自训练数据中的公开开发者博客 / Reddit 摘要 / App Store 描述,未有原始 Reddit thread 引文
2. **Reddit / App Store reviews 未直接抓取**:GLM web search 在该领域返回相关性极低
3. **用户应在执行任何 Fog of World-inspired 方案前,自行 Reddit /r/Fogofworld 验证**性能瓶颈与缓解方案
4. 国内"keep 跑步地图"是本次调研唯一一份原始一手分析,在 §2.3 已引用

## 7. 引文链接(仅 HARD 强度)

- Keep 跑步地图可视化陷阱(知乎相关): https://www.siliu.net/p/9854owjlxm.html
- Strava 官网产品定位: http://strava.com/
- AllTrails 产品定位: http://alltrails.com/
- 微信小程序健步走商业模式: https://zhuanlan.zhihu.com/p/680329387

其余产品(Fog of World、Squadrats、Pikmin Bloom、Pokemon GO 等)在本轮调研中**无原始硬证据**,结论基于训练数据 + 工程推理。

---

## 8. 一句话总结给 Cairn

**Fog of World 不卡的核心不是"它代码写得好",而是"它根本不渲染 GPS 点 — 它渲染 tile mask"。Cairn 想做累积探索 + 不卡 + 视觉精致 = 必须走 tile + mask + 边缘羽化这条路线,不能用"每个点画个圆 / 球"的思路。**
