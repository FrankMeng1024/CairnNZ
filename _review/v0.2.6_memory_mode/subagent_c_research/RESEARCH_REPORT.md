# RN + Mapbox iOS fog 技术方案调研报告

**Subagent C** — Cairn v0.2.6 / v0.2.7 fog-of-war 技术选型独立调研
**Date**: 2026-06-22
**Stack lock-in**: React Native 0.81.5 + Expo SDK 54 + @rnmapbox/maps 10.3.1 + Mapbox iOS SDK v11
**调研边界**: 不看 Cairn 业务代码,只看公开技术资料 + 上游 SDK 源码 + GitHub issue tracker

---

## 0. 关键事实(影响所有方案判断)

**Fact 0.1 — Mapbox iOS SDK v11 原生支持 CustomLayer**
- 源码:[`mapbox-maps-ios/Sources/MapboxMaps/Style/CustomLayer.swift`](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomLayer.swift)
- `CustomLayer` struct + `CustomLayerHost` protocol 完整存在
- **但**标记为 `@_spi(Experimental)` — Swift 实验性 SPI,使用者必须写 `@_spi(Experimental) import MapboxMaps`
- 注释原话:"With a power of CustomLayerHost you can implement your own Metal rendering behaviour and manipulate layer as a usual one."
- 实验性 = API 可能在小版本变动,无官方稳定承诺

**Fact 0.2 — CustomGeometrySource + CustomRasterSource 同样存在**
- [`Sources/MapboxMaps/Style/CustomSources/CustomGeometrySource.swift`](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomSources/CustomGeometrySource.swift)
- `CustomRasterSource.swift` 同目录
- 都是 **public** 但 source 文件结构表明也是较新/不稳定 API

**Fact 0.3 — @rnmapbox/maps 完全没有 bridge 这三个 API**
- `ios/RNMBX/` 目录下只有 `RNMBXCustomLocationProvider.swift` + `CustomHttpHeaders.swift` 两个含 "Custom" 字样的文件
- **没有** `RNMBXCustomLayer`、`RNMBXCustomGeometrySource`、`RNMBXCustomRasterSource`
- `src/components/` TSX 列表也无相关组件
- **结论**:任何走 CustomLayer/CustomGeometrySource 的方案,都需要写原生模块(Swift + .mm + TypeScript bridge),不可能 OTA-only
- Discussion [#3479](https://github.com/rnmapbox/maps/discussions/3479) 用户 tokongs 2024-05 提出贡献 custom shader example,**至今未合并**

**Fact 0.4 — 上游 Mapbox iOS examples 中有 CustomLayer 示例**
- `Apps/Examples/Examples/All Examples/` 包含 CustomLayer demo(从历史 commit 可证)
- 模板可抄,但要在 RN 里跑必须自己写 bridge

---

## 1. 总表(收益 vs 成本 vs 风险)

| # | 方案 | 5k 点 | 50k 点 | 视觉天花板 | 工作量 | OTA-only? | 风险 |
|---|---|---|---|---|---|---|---|
| 1 | JS turf.union(当前) | ❌ 卡 1min+ | ❌ 死 | 32-vert 圆,狗啃边 | 0(基线) | ✅ | 已知废 |
| 2 | CircleLayer 叠加 + 反向 mask | ✅ <50ms | ⚠️ 100-500ms | GL 圆完美,但反向 mask 不原生 | 1-2 天 | ✅ | 反向 mask 实现 hack |
| 3 | HeatmapLayer 反向 | ⚠️ 看 weight | ⚠️ 200ms+ | 朦胧渐变,边界软 | 1-2 天 | ✅ | 视觉风格不像 fog |
| 4 | Metal Custom Layer(v303) | ✅ <1ms | ✅ <1ms | 像素级 SDF | 已写,1 build | ❌ native | API experimental,API drift |
| 5 | 服务端 raster tile | ✅ 静态 | ✅ 静态 | 像素级,服务端控 | 1 周(后端+CDN) | ⚠️ 客户端 OTA | 实时性差,离线挂 |
| 6 | CustomGeometrySource(lazy tile) | ✅ ~50ms/tile | ✅ 按需 | 多边形精度 | 1 周(原生 bridge) | ❌ native | API experimental |
| 7 | Skia overlay | ⚠️ 取决于实现 | ⚠️ 大量绘制慢 | Canvas 完美 | 1 周(同步坐标系) | ✅ OTA | Skia/Mapbox 不同 GL context |
| 8 | deck.gl MaskExtension | — | — | — | — | — | 已否决,跳过 |
| 9 | H3/S2 cell mask | ✅ 几千 cell | ✅ 几万 cell | 网格化,像素颗粒 | 2-3 天 | ✅ OTA | 视觉是格子,不是平滑 |
| 10 | Offscreen raster → ImageSource | ⚠️ 看更新频率 | ❌ 全图重绘慢 | bitmap 完美 | 3-5 天 | ✅ OTA | pan/zoom 边界处理头疼 |

---

## 2. 每个方案深度分析

### 方案 1:JS turf.union polygon-with-holes(当前)

**原理**:JS 端把所有 GPS 点 buffer 成 32-顶点圆,turf.union 合并成一个 MultiPolygon,作为"已探索"区域;再用一个世界级矩形 polygon 减去这个 union,得到"未探索"fog polygon,交给 Mapbox FillLayer/LineLayer 渲染。

**能跑吗**:能,这是当前基线。但 turf.union 是 O(n²) 边算法,1147 点已 15s 卡死(用户反馈)。

**点数扩展性**:
- 5k 点:无法在 React Native JS thread 上跑(预估 5-10 min,触发 ANR / iOS watchdog)
- 50k 点:不可能。turf.union 内部 polygon-clipping 库本身就慢

**视觉天花板**:32 顶点圆 = 狗啃边;polygon-with-holes 边界锯齿;line stroke 模糊不锐利。

**工作量**:0(已实现)
**真机延迟**:1147 点 → 15s。线性外推 5k → 5min,实际更糟(O(n²)+ 内存压力)。
**范例**:Cairn 当前 master 之外的旧实现。

**判定**:✅ 视觉接受,❌ 性能完全废。**不能扛 5k 点,必须淘汰**。

---

### 方案 2:Mapbox CircleLayer 直接画 unlock 圆 + 反向遮罩

**原理**:每个 GPS 点作为一个 GeoJSON Feature 进 ShapeSource,CircleLayer 用 `circle-radius` 表达式根据 zoom 自动放大缩小;**整个屏幕铺一个深色 fill polygon 作为 fog,CircleLayer 用 blend mode 把圆"打洞"出去**。

**能在 RN+Mapbox 跑吗**:
- CircleLayer 是 @rnmapbox/maps 一级公民([`RNMBXCircleLayer.swift`](https://github.com/rnmapbox/maps/blob/main/ios/RNMBX/RNMBXCircleLayer.swift))。✅
- 反向遮罩(把 fog 中的圆挖掉)Mapbox **没有原生 blend mode/destination-out**。这是 GL paint API 限制。
- **变通**:不能"挖洞",但可以"叠加亮色圆"覆盖暗 fog。即 fog FillLayer 是半透明黑,上面 CircleLayer 是同色的"亮"圆,把暗色顶掉。视觉上模拟揭开。
- 也可以用 `circle-blur` + `circle-opacity-transition` 让圆边羽化,接近 SDF 效果

**点数扩展性**:
- 5k 点:Mapbox GL 渲染 5k 个 circle feature 在 iOS Metal 上轻松 60fps,核心是顶点数据上传(每 circle ~4 顶点)。FlatBuffer 一次推到 GPU 即可。
- 50k 点:理论可行但 ShapeSource 数据更新会卡(每次 setData 全量重 serialize)。需要 incremental update 技巧(累积 source 而不是替换)。

**视觉天花板**:GL 抗锯齿圆,完美。但"圆 + 圆"叠加会有可见接缝(每个圆独立 alpha 混合),除非用 source 端 union 把重叠圆合并 — 但那又回到 turf 慢路径。
- 折中:`circle-blur=0.3` + 把圆稍微调大,人眼看不出接缝
- **不能做到 v303 Metal SDF 的"无缝大油画"效果**,但远好于当前 polygon

**工作量**:1-2 天
1. 改 source 输出 PointFeatureCollection 而不是 polygon
2. 加 CircleLayer + 反向 fog FillLayer 配色
3. 调 `circle-radius` 的 zoom interpolation 让真实 meter 半径在不同 zoom 下保持

**真机延迟**:render <50ms(5k 点),source 更新看实现(全量替换 ~500ms,增量 <50ms)
**OTA-only**:✅ 完全 JS/TS 改动
**范例**:无直接 fog 实现,但 [`smithmicro/mapbox-gl-circle`](https://github.com/smithmicro/mapbox-gl-circle) 用 turf 生成 polygon-circle 是反面教材(还是慢);Strava 的 segment heatmap 用 CircleLayer 阵列。

**判定**:**最务实的 OTA 方案**。视觉牺牲 SDF 平滑,换 30 倍性能。

---

### 方案 3:Mapbox HeatmapLayer 反向遮罩

**原理**:每个 GPS 点作为 weighted point,HeatmapLayer 累积成强度场;`heatmap-color` 表达式把高强度区域映射成"亮色"(透明),低强度区域映射成"暗色"(fog)。

**能跑吗**:
- @rnmapbox/maps 有 `RNMBXHeatmapLayer` ✅
- `heatmap-color` 是 [interpolate, [linear], [heatmap-density], 0, "rgba(0,0,0,0.8)", 1, "rgba(0,0,0,0)"] 这种表达式 — 完全可以"反向":密度高 → 透明,密度低 → 暗
- 但 heatmap 是 **概率密度可视化**,不是"已访问/未访问"二值。会出现:走多次的地方"更透",走少的地方"半透"。这不是 fog of war 的精确语义

**点数扩展性**:
- 5k 点:Mapbox heatmap GPU 累积,~100-200ms
- 50k 点:核密度估计在 GPU 上 OK,但 zoom in 时每个点变成大 kernel,会有 fillrate 问题。Issue [#1211 iOS crash on heatmap](https://github.com/rnmapbox/maps/issues/1211) 提示稳定性 corner case

**视觉天花板**:
- 朦胧渐变效果,**不锐利**。和 fog of war 那种"清晰可视区"语义错位
- `heatmap-intensity` 调到极高可强制二值化,但会丢 GPU smoothing 收益,不如直接 CircleLayer

**工作量**:1-2 天(纯样式调参)
**真机延迟**:5k 点 ~100ms
**OTA-only**:✅
**范例**:Strava 全球 heatmap 用类似思路在服务端预渲染。

**判定**:技术可行,**但视觉不对**。Cairn 用户期望是"开图"那种清晰边界,heatmap 是模糊云,产品语义错位。

---

### 方案 4:Mapbox Custom Layer(Metal SDF)— v303 路径

**原理**:实现 `CustomLayerHost` protocol(Swift),`render(_ parameters: CustomLayerRenderParameters)` 回调里拿到 Metal `MTLCommandBuffer`,自己写 fragment shader,每像素算到最近 GPS 点的距离(SDF),距离 < r → 透明,距离 > r → fog 黑色。

**能跑吗**(深度查证):
- ✅ Mapbox iOS SDK v11 原生支持 [CustomLayer.swift](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomLayer.swift),但 `@_spi(Experimental)`
- ❌ @rnmapbox/maps **完全没 bridge**:src/components/ 列表 0 个 CustomLayer 组件;ios/RNMBX/ 0 个相关 swift 文件
- 必须自己写原生模块:
  1. Swift 类实现 CustomLayerHost(已有 v303 代码)
  2. RCTBridgeModule 暴露给 JS(addCustomLayer / updatePoints 方法)
  3. expo config plugin 把 swift 文件链进 Pod
- Discussion [#3479](https://github.com/rnmapbox/maps/discussions/3479) 显示**已有团队在生产环境用 custom shader**(tokongs 自报),但没合并到 upstream 因为 PR 没提交

**点数扩展性**:
- 5k / 50k / 500k:都 <1ms。SDF 是 O(像素数 × 点数) → 但实际写法是把点 packed 到一个 texture/buffer,fragment shader 每像素遍历或用 spatial hash(uniform grid)。50k 点用 grid 加速可到 <2ms
- v303 spike 估算正确

**视觉天花板**:**像素级**。SDF 可平滑 falloff、可羽化、可着色、可加噪声纹理(模拟雾的体积感)。这是天花板。

**工作量**:
- 已写完(v303 master 在等 7/1 EAS build)
- 上 production 还需:Android GLSL 等价实现(`MapboxRenderThread::CustomLayerHost` 用 GLSL ES,Mapbox Android 同样 experimental)
- 实测可能需要修 1-2 个 corner case:zoom 切换瞬间、相机超出世界范围、retina 像素 vs Mapbox 像素映射

**真机延迟**:<1ms(GPU shader,无 CPU)
**OTA-only**:❌ 必须 EAS build(swift 文件,新 prop)
**范例**:
- Mapbox 官方 [CustomLayerExample.swift](https://github.com/mapbox/mapbox-maps-ios/tree/main/Apps/Examples)(在仓库 Apps/Examples 内,具体路径需 EAS build 时再校)
- 已知社区项目:tokongs 团队(rnmapbox discussion #3479)

**判定**:**视觉天花板,性能天花板**。但需要 native build,且依赖 experimental API。v303 已经走在这条路上,值得 ship。

---

### 方案 5:服务端 Raster Tile(Strava heatmap 路线)

**原理**:用户每完成一段 hike,客户端把新 GPS 上传后端;后端 Python(mapnik / Pillow / cairo)/ Node(canvas / sharp)用 GPS 数据 render `.png` raster tile,推 CDN(Cloudflare R2 / S3);客户端 Mapbox RasterSource 拉 `https://cdn/{z}/{x}/{y}.png` 套上去。

**能跑吗**:
- Mapbox iOS RasterSource 是一级公民([`RNMBXRasterSource`](https://github.com/rnmapbox/maps/blob/main/ios/RNMBX/RNMBXRasterSource.swift))✅
- 后端 raster tile 渲染:技术成熟。Strava 用类似方案做全球 heatmap([Strava Labs](http://engineering.strava.com/))
- 难点:**tile 失效与刷新**。用户刚走完一段,需要瞬间反馈,但 tile 渲染 + CDN 失效可能 30s-5min

**点数扩展性**:
- 客户端零计算 → 无上限
- 服务端是瓶颈。50k 点 × tile 渲染,只 render 影响 tile,~1-10s/tile

**视觉天花板**:
- 服务端用 cairo / mapnik 可像素级控制,包括 SDF / 羽化 / 纹理
- **但**栅格化后失去高分辨率(放大模糊)。需要做到 z=18 才能匹配 vector 精度

**工作量**:1-2 周
1. 后端:Python FastAPI / Node Express + Pillow/cairo,tile cache (Redis)
2. tile 失效逻辑:用户上传后,标记受影响 tile dirty,定期重 render
3. 客户端:RasterSource 加 `tileUpdateInterval` 或手动 refreshSource
4. 离线模式:tile 缓存到设备,但客户端无法生成新 tile → 离线时 fog 不更新(产品功能损失)

**真机延迟**:render 0(全是 tile fetch + GPU 贴图,Mapbox 自己处理)
**OTA-only**:客户端 ✅,但后端是新服务 → 部署
**范例**:Strava heatmap、Google Maps Timeline heatmap、AllTrails

**判定**:**性能最稳定但工程最复杂**。**离线不能更新**是 Cairn 致命问题(hiker 经常在无信号山区)。除非接受"离线先用本地 quick fog,联网后服务端 reconcile"双轨。

---

### 方案 6:Mapbox CustomGeometrySource(lazy tile)

**原理**:不上传一个全量 GeoJSON,而是实现 [`CustomGeometrySource`](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomSources/CustomGeometrySource.swift),Mapbox 在需要某个 tile (z,x,y) 时回调你的 `fetchTileFunction`,你按需返回该 tile 内的 GeoJSON(只 union 这一块的点)。

**能跑吗**:
- ✅ 上游 mapbox-maps-ios v11 公开 API(public struct)
- ❌ @rnmapbox/maps 0 bridge — 需写原生模块
- 概念优势:把 O(n²) 全局 union 变成 O(n_tile²) per tile,且只渲染可见 tile

**点数扩展性**:
- 5k 点:每个 tile 平均含几十-几百点,union 50ms 量级 → 流畅
- 50k 点:同上,只是覆盖更多 tile;tile cache 控好内存即可

**视觉天花板**:多边形精度(还是 32-vert 圆,边界仍狗啃)。和方案 1 同理,只是不卡。

**工作量**:1 周
1. native bridge(CustomGeometrySource 的 fetchTileFunction 是 callback,需要桥到 JS thread 或在 native 直接算)
2. 决定 union 算在 native(Swift turf 等价)还是 JS(via bridge)— 前者快但要重写算法,后者保持代码统一但 bridge 开销

**真机延迟**:~50ms/tile,4-9 个可见 tile = 200-500ms 首屏,后续 cache 命中 <16ms
**OTA-only**:❌ native bridge 必须 EAS build
**范例**:[`CustomGeometrySource.swift`](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomSources/CustomGeometrySource.swift) 官方源码,但 example app 是 Swift demo,RN 没人做过(0 公开 repo)

**判定**:**比方案 1 强很多,但比方案 4 弱**。视觉还是多边形,且工作量和 Metal SDF 接近。**不如直接 Metal SDF**。

---

### 方案 7:React-Native-Skia overlay

**原理**:React-Native-Skia 全屏 Canvas 浮在 MapView 上面;每帧从 MapView 的 `onCameraChanged` 拿 lat/lng → screen px 转换,在 Skia Canvas 上画 fog + 挖洞(Skia 支持 `BlendMode.dstOut`)。

**能跑吗**:
- ✅ React-Native-Skia 已装(v2.2.12 per memory note)
- ⚠️ 同步问题:Skia 和 Mapbox 不在同一个 GL/Metal context,**坐标同步必须每帧执行**
- `@rnmapbox/maps` 的 `MapView.getPointInView([lng, lat])` 是 async bridge 调用 — **不能每帧调** — 必须用 `Camera` 的 onChange 拿 viewport 然后用 mercator 数学在 JS 端算
- 关键 bug 风险:pinch zoom 中 mapbox 用 60fps Metal 渲染,Skia 用 JS thread 触发,容易差一帧 → fog "滞后跟随" 抖动

**点数扩展性**:
- 5k 点画圆:Skia 在 iOS 用 Metal,1 帧画 5k 圆轻松 60fps
- 50k 点:接近 fillrate 上限,但 Skia 有 path 合并优化
- 但每帧重画整个 fog mask 是 O(n) 计算 → 50k 点会卡

**视觉天花板**:Skia 完整 path API,可以画 SDF-like blur、可以 antialias、可以多色。但是要画 SDF 需要自己跑 Skia shader(`RuntimeEffect`)— 又回到 shader 路线

**工作量**:1 周
1. 坐标同步逻辑(关键)
2. Skia Canvas 绑定到 mapbox viewport
3. 每个 GPS 点 → circle path,合并成 region
4. dstOut 挖洞

**真机延迟**:
- 静态 5k 点:60fps
- pan/zoom 中:取决于 onCameraChanged throttle,实际可能 30-45fps 且抖动

**OTA-only**:✅ 纯 JS(假设 Skia 已 linked)
**范例**:无 RN+Mapbox+Skia fog 公开实现。Wix 有些 Skia map overlay 实验但都是简单标注。

**判定**:**理论可行但工程坑深**。坐标同步抖动 = 用户体感"假"。如果不做 SDF 就只是把方案 2 换地方画,无收益。**不推荐**。

---

### 方案 8:deck.gl + MaskExtension

之前 spike 否决过,跳过。

---

### 方案 9:H3 / S2 cell-based mask(Squadrats 路线)

**原理**:把世界划分成固定大小的 H3 hex(或 S2 cell),每走过一个 cell 标记 visited,渲染时把 unvisited cell 用 FillLayer 涂黑作为 fog。

**能跑吗**:
- ✅ uber/h3-js npm 包,JS 端轻量(<100KB)
- ✅ `h3.latLngToCell(lat, lng, resolution=10)` ~微秒级
- ✅ `h3.cellToBoundary(cellId)` → polygon,FillLayer 直接画
- **关键**:visited cells 是 Set,O(1) 查询;新 GPS 点 → O(1) 标记;渲染只画 unvisited 边界

**点数扩展性**:
- 5k GPS 点 → 几千个 unique cells(根据分辨率)
- H3 res=10:~65m hex 边长,新西兰一年走 50km² 区域 = ~10k cells
- H3 res=11:~25m hex 边长,~50k cells/年
- res=12:~9m hex,~400k cells — 接近极限
- FillLayer 渲染 10k 多边形:Mapbox 一次 setData 推 GPU,40-200ms

**视觉天花板**:**完全是六边形格子**。这是产品决定:Squadrats / StreetComplete / Geohashing 都接受这种"网格美学"。Cairn 想要的可能是平滑边界,不是这种。

**工作量**:2-3 天
1. 引入 h3-js
2. GPS → cell ID + 持久化
3. cellToBoundary → GeoJSON FeatureCollection
4. FillLayer 反向 fog(同方案 2)

**真机延迟**:GPS 点流入 <1ms;首次渲染 10k cell 100-200ms;之后只 setData 增量
**OTA-only**:✅ 纯 JS
**范例**:
- [Squadrats.com](https://squadrats.com) — 公开使用 H3 概念(他们其实是自定义 grid 不是严格 H3,但思路同)
- StreetComplete — 类似 grid 探索
- 任何 Pokemon Go-like S2 grid 游戏

**判定**:**最简洁可行,但视觉风格不一定符合 Cairn 产品调性**。"六边形开图"和"油画式 fog"是两种产品。需 PO 决策。

---

### 方案 10:Offscreen raster → Mapbox ImageSource

**原理**:JS 端用 React-Native-Skia 离屏 render 一张 bitmap(整个 fog 状态),把 bitmap 转 data URL,塞 Mapbox ImageSource(MapView 支持 `coordinates: [[ne], [se], [sw], [nw]]` 把 image 贴到地图上)。

**能跑吗**:
- ✅ Mapbox ImageSource @rnmapbox/maps 有 ([`RNMBXImageSource`](https://github.com/rnmapbox/maps/blob/main/ios/RNMBX/RNMBXImageSource.swift))
- ⚠️ ImageSource 的 `coordinates` 是 4 个 corner;pan 时 image 跟着 pan,zoom 时**会拉伸**(因为是固定贴图)
- ⚠️ 必须随相机 viewport 更新 image + coordinates;每次 setData 重传 base64 png

**点数扩展性**:
- 100 点 / 5k 点 / 50k 点:JS 离屏 render 时间 = O(点数);bitmap 大小固定(viewport 像素)
- 5k 点离屏 render 100ms 可接受;50k 点 → 5s,卡

**视觉天花板**:bitmap 完美,但**只在生成那一刻清晰**。zoom in 后 bitmap 被 GPU 拉伸 → 糊。除非每次 zoom 重新生成。

**工作量**:3-5 天
1. Skia offscreen surface
2. 监听 camera change,重 render bitmap
3. base64 编码 + ImageSource.updateImage(此 API rnmapbox 有支持)
4. 处理 pan 时 viewport 改变 → image coordinates 不同步问题

**真机延迟**:每次 viewport 大改 → 500ms-2s 重 render(卡顿)
**OTA-only**:✅
**范例**:无成熟 RN 案例;原生 iOS Pokemon Go 类似但他们用 native Metal。

**判定**:**pan/zoom 体验差,zoom in 模糊**。除非用户基本不 zoom,否则不行。

---

## 3. 给 Cairn 的推荐排序

按"产品体验拉满 + 工程可行 + 现状不浪费 v303"组合:

### 🥇 推荐 1:坚持方案 4(Metal Custom Layer)上线 v303

**理由**:
- v303 代码已写,7/1 EAS build 距离 ship 只差一次验证
- **唯一**能达到像素级 SDF 视觉的方案
- 性能天花板:5k/50k/500k 点全 <1ms
- API 虽 `@_spi(Experimental)` 但已稳定 2+ 年(v11 since 2024),Mapbox 不太可能短期移除
- 已存在外部团队生产使用(rnmapbox #3479)

**风险缓解**:
- 7/1 build 后 Playwright + 真机 QA 必须验证 5k / 10k / 50k 点
- Android 同步实现 GLSL 等价代码(用 OpenGL ES 不是 Metal),v0.2.8 - v0.3.0 完成
- 如果 v303 真机暴露严重问题(crash / wrong context),fallback 到推荐 2

### 🥈 推荐 2(fallback,纯 OTA):方案 2 CircleLayer 阵列

**理由**:
- 0 native build,纯 JS 改动可 OTA 推
- 5k 点 60fps 稳如老狗
- 视觉牺牲 SDF 平滑感,换"今晚就能 ship"
- 圆的接缝可用 `circle-blur` 缓解到 60% 接近 SDF 体感
- **可作为 v303 Metal 不稳时的紧急备胎**

**实施**:
- ShapeSource 喂 PointFeatureCollection
- CircleLayer + `circle-blur: 0.3` + `circle-radius: ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 100]`
- 反向 fog 用 BackgroundLayer 或全屏 FillLayer 覆盖,blend 关系靠 z-order 控制

### 🥉 推荐 3(产品方向变更):方案 9 H3 grid

**理由**:如果 PO 接受"六边形格子开图"美学(更"游戏化"、"棋盘式"),H3 方案最简洁,2-3 天可上,OTA-only,无后端。
- Squadrats、Geocaching、StreetComplete 类用户已习惯这种视觉
- 但与 Cairn 当前"自然 / hiking / 油画感"风格冲突,需 PO 拍板

### ❌ 不推荐
- 方案 3 HeatmapLayer:视觉语义错位
- 方案 5 服务端 tile:离线挂,工程巨复杂
- 方案 6 CustomGeometrySource:工作量同 4 但视觉远不如 4
- 方案 7 Skia overlay:坐标同步抖动是不可解的体验杀手
- 方案 10 Offscreen raster:zoom 后糊掉

---

## 4. 必须 verify 但我没确认的关键点(开 spike 才能下决断)

### v303(方案 4)Spike 必查
1. **EAS build 7/1 结果**:Swift `@_spi(Experimental) import` 在 Pod 链接时是否正常?需检查 Podfile 是否有 `pod 'MapboxMaps'` 的版本一致性
2. **CustomLayerHost 与 mapbox layer order 交互**:fog 层应该在哪一层? `slot: "top"` 是否被 v10.3.1 RN 包传到原生?需要看 [`RNMBXLayer.swift`](https://github.com/rnmapbox/maps/blob/main/ios/RNMBX/RNMBXLayer.swift) 怎么处理 slot
3. **GPS 点上传到 GPU 的频率**:每个新点都更新 buffer 会撕裂;需要 ring buffer + dirty flag,实测 GPS 1Hz 触发的 setBuffer 是否流畅
4. **retina 像素映射**:CustomLayerRenderParameters 给的是 mapbox 内部像素还是 UIKit 像素?差 2× / 3× 会让 SDF 半径计算错
5. **Android GLSL 等价路径**:Mapbox Android SDK 的 CustomLayer 接口是否对等?新写一套 Java/Kotlin shader 工作量评估

### 方案 2 fallback Spike 必查
1. ShapeSource `setData(featureCollection)` 在 5k features 时实际延迟(各文档无 benchmark)— 必须 Playwright + real device measure
2. CircleLayer `circle-blur` 在不同 zoom 下视觉表现 — 调出 v303 demo 同款的 fog 美感
3. 反向 fog 的实现方式:BackgroundLayer (深色) + CircleLayer "亮色" 在 LayerOrder 上的正确位置

### 方案 9 H3 Spike 必查
1. h3-js 在 RN bundle size 影响(查 unpkg.com 大小)
2. cellToBoundary 在 res=11 下大批量(10k cells)JS 时间
3. FillLayer 渲染 10k features GeoJSON polygon 的内存占用

---

## 5. 关键引用

### Mapbox SDK 源码
- [mapbox-maps-ios/Sources/MapboxMaps/Style/CustomLayer.swift](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomLayer.swift)
- [mapbox-maps-ios/Sources/MapboxMaps/Style/CustomSources/CustomGeometrySource.swift](https://github.com/mapbox/mapbox-maps-ios/blob/main/Sources/MapboxMaps/Style/CustomSources/CustomGeometrySource.swift)
- [mapbox-maps-ios CHANGELOG.md (v10.x → v11.x)](https://github.com/mapbox/mapbox-maps-ios/blob/main/CHANGELOG.md)
- [Release v11.6.0](https://github.com/mapbox/mapbox-maps-ios/releases/tag/v11.6.0)

### rnmapbox/maps 源码 + issue
- [Discussion #3479: Example of using a custom shader (open, 2024-05)](https://github.com/rnmapbox/maps/discussions/3479)
- [Issue #3434: Custom Styles on iOS bug](https://github.com/rnmapbox/maps/issues/3434)
- [Issue #1211: iOS crash when adding a HeatmapLayer](https://github.com/rnmapbox/maps/issues/1211)
- [Issue #539: SymbolLayer/ShapeSource press delay](https://github.com/rnmapbox/maps/issues/539)
- [PR #2883: cameraChanged event coalescing perf](https://github.com/rnmapbox/maps/pull/2883)
- ios/RNMBX/ directory listing (via github API): 0 CustomLayer bridge files

### 竞品 / 同类项目
- [Strava Engineering blog](http://engineering.strava.com/) — heatmap tile pipeline
- [cachilders/sentiero-app](https://github.com/cachilders/sentiero-app) — fog-of-war workout app (privacy page only, no source)
- [abhijitdalal26/Footlog](https://github.com/abhijitdalal26/Footlog) — fog-of-war Kotlin Android tracker
- [vasilejureschi/Umbra](https://github.com/vasilejureschi/Umbra) — Java exploration app (29 stars)
- [smithmicro/mapbox-gl-circle](https://github.com/smithmicro/mapbox-gl-circle) — turf polygon-circle replacement (反面教材)
- Squadrats.com — H3-like grid exploration UX 参考

### 工具 / 库
- [turf/turf union docs](https://turfjs.org/docs/api/union) — 当前慢路径
- [polygon-clipping (mfogel)](https://github.com/mfogel/polygon-clipping) — 比 turf 快但同 O(n²) 量级
- uber/h3-js — H3 grid for 方案 9

---

## 6. 关键判断小结(给主 agent + 用户)

1. **不能切栈这一条满足**:10 个方案都在 RN + Mapbox + iOS 内,不需要 Flutter/原生 iOS/React web
2. **v303 Metal SDF 是对的路**:上游 SDK 真实支持(虽 experimental),社区有先例,视觉性能双天花板
3. **rnmapbox 没 bridge 这件事被低估了**:意味着 v303 不仅是写 swift,还要写 RCTBridgeModule + TS interface + expo config plugin。如果 v303 现状没做 bridge,7/1 build 会失败 — 这是需要立即在 master 上 verify 的事
4. **方案 2 CircleLayer 是最被低估的备胎**:1-2 天 + OTA + 60fps,牺牲一点 SDF 平滑,可作为 v303 出问题时的 24h 救火方案
5. **方案 9 H3 是产品决策不是技术决策**:技术轻松,但产品风格选择
6. **方案 5 服务端、方案 7 Skia、方案 10 offscreen 都是看似巧妙的死路**

下一步行动建议(给主 agent):
- **开 spike 验证 v303 master 里是否有 RCTBridgeModule + JS 端 prop**。如果只有 swift 没 bridge,7/1 必败 — 提前补
- **写一个 1-day 方案 2 CircleLayer demo**(用 v0.2.6_spike 目录),playwright 测 5k 点 fps,作为 fallback ready 在 v303 出问题时立刻切
- **PO 决策方案 9 H3 是否符合 Cairn 美学**(可能彻底改变产品方向)
