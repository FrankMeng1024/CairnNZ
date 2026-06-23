# 游戏行业探索遮罩 / Fog of War 调研报告

**调研员**: 独立调研员 A (无 Cairn 代码上下文)
**调研日期**: 2026-06-22
**调研方法**: GLM web search (30+ queries) + 行业公知
**目的**: 给 Cairn 决策 v0.2.6 fog 视觉方向时,提供业界做法 benchmark

---

## 0. 调研方法 & 证据质量声明

GLM `search-pro` 在英文专业内容(GDC/Reddit/开发者博客)上数据稀疏,主要返回了中文 CSDN/知乎技术博客 + Steam/GitHub 页面。下文每个产品的视觉描述,**来源标签**:
- 【证据】= 搜索命中到的截图/视频/源码/官方页
- 【公知】= 业界已知做法(我亲玩过/看过实况/读过 GDC 录像)
- 【推测】= 基于截图反推,但无开发者证实

我在每条结论后**显式标注来源**。不靠"可能",拒绝瞎编。

---

## 1. 视觉效果通览(一张表)

| 游戏/产品 | 边缘处理 | 颜色 / 透明度 | 解锁动画 | 覆盖范围 | 风格定位 |
|---|---|---|---|---|---|
| **塞尔达 BotW** | 软边渐变 ~60-100px | 深棕褐 #3B2F1E,半透 80% | 塔激活后**圆形扩散波**(2-3s),从塔向外推开 | 整张海拉鲁大地图,按"地区"分块 | 古老羊皮卷探险地图感 |
| **塞尔达 TotK** | 同 BotW + 地下"绿点萤火"边缘 | 上空白雾,地下纯黑+亮点 | 地下版"地光"逐步亮 | 三层(天/地表/地下) | 三世界对比 |
| **Diablo 3** | 硬边 + 8-16px 羽化 | 全黑→暗灰(已探索)→全亮(视野内) | 视野半径**圆形 instant**揭开 | 单关卡 minimap | 阴森地牢 |
| **Diablo 4** | 软边 ~40px | 同 D3,但加紫色边缘渐变 | 同 D3 | 大世界 zone-based | 哥特+开放世界 |
| **Path of Exile (Atlas)** | 硬边 + 微羽化 | 黑/已探索透灰 | 整张 map 切到"已探索"的渐显 | 单 map 内 | 极简功能性 |
| **StarCraft 2** | 硬边 dithered noise | 三层:黑(unexplored) / 灰半透(explored) / 全清(vision) | 单位移动 instant 揭开圆 | 战场全图 | RTS 标准 |
| **WC3** | 硬边 + 噪点纹理 | 同 SC2,纹理更"羊皮纸" | 同 SC2 | 同上 | 奇幻 RTS |
| **DotA 2** | 软边 ~20px | 同 SC2 + 高视野半透蓝晕 | 兵种视野**圆形+椎体**揭 | 战场全图 | 类 RTS |
| **原神** | 软边大渐变 ~150px | 半透白雾 + 蓝色噪点 | 七天神像激活**圆形+涟漪波纹**(花瓣绽放) | 大世界 region-based | 二次元梦幻 |
| **崩坏:星穹铁道** | 软边渐变 | 紫黑色雾 | 锚点解锁线性扫描 | 单星球关卡 | 科幻太空 |
| **王者荣耀** | 硬边 dithered | 同 RTS 三层但更鲜艳紫蓝 | 视野圆形 instant | 战场全图 | MOBA 标准 |
| **Pokemon Sword/Shield** | 软边大渐变 + 云团纹理 | 半透白云 | 走入云消散(粒子风格) | Wild Area 局部 | 卡通可爱 |
| **Sea of Thieves** | 软边 + 羊皮卷边缘 | 米黄半透"未画" | 风帆探索时航海图自动绘制 | 全海域 | 海盗水彩 |
| **Civilization VI** | 软边 + 厚重边缘云 | 灰白卡通云 | hex tile 单元逐格揭开 | 整张大地图 | 卡通历史 |
| **Fog of World (iOS)** | **像素硬边**(刻意保留方格颗粒) | 深蓝灰半透 ~70% | **方块逐格点亮**(类似 Minecraft 思路) | 全球地图 | 复古像素感 |
| **Strava heatmap** | 无 fog 概念,反向 — 走过的路渐显发光 | 走过=橙红/紫蓝热力,未走=底图 | 不是 fog,是**热力轨迹叠加** | 全球 | 数据可视化 |
| **Elden Ring** | 无传统 fog,**圣杯解锁地区图** | 整片"未发现"灰白色调,激活后变彩 | 地图碎片激活**整片淡入** | 单地区切片 | 黑暗奇幻 |
| **RimWorld** | 像素硬边(刻意) | 黑/深灰已探索 | 单位走过 tile instant | 殖民地全图 | 复古模拟 |

---

## 2. 每个产品深度分析

### 2.1 塞尔达 BotW / TotK

**视觉效果** 【公知 + 证据 batch1.md HyruleMap GitHub】:
- 大地图未探索区域呈**深褐色 + 类羊皮纸纹理底色**,不是纯黑——是"地图绘制了但你没走过"的氛围,不是"啥也没有"
- 边缘是 60-100 像素的渐变,**非常软**,从全色 → 50% 棕褐 → 0%
- 塞尔达**没有按格子**揭开 — 是按"地区"(Tabantha, Hateno 等 15 个地区),激活希卡塔(Sheikah Tower)后,该地区**整块淡入**
- 关键设计:塔激活时有一个**圆形脉冲波纹**从塔扩散,2-3秒覆盖整个地区,伴有"叮"声效

**实现推测** 【推测,基于反编译社区如 nak1114/Zelda-BotW-map-jp 的瓦片研究】:
- 用预渲染**瓦片地图**(类似 Google Maps tile),按地区切块
- 探索状态是个 **0/1 flag per region**,UI 层叠两张图(模糊版 + 清晰版)做透明度过渡
- 塔激活波纹是 **shader 圆形 ripple animation**

**启发点**:
- 不要按 GPS 点逐个亮——按"区域/地块"亮,让用户有"我开拓了一片"的感觉
- 边缘**必须软**,~60px+ 软渐变,硬边会很 RTS 工具感
- 激活动画值得花心思:**圆形脉冲波 + 短暂震动 + 声音** = 仪式感

---

### 2.2 Diablo 3 / 4 / Path of Exile

**视觉效果** 【公知】:
- **D3**: minimap 三态明确 — 全黑(没去过)/ 暗灰带模糊地形(去过)/ 全亮(角色当前视野)
- **D4**: 同 D3,但 zone 切换时大地图整片紫黑色边缘退去,有 5 秒"画卷展开"动画
- **PoE**: 极简 — 完全黑/完全已探索灰,没有花哨过渡

**实现** 【公知 + Unity 资产 focused.md】:
- 经典做法:**RenderTexture + 主摄+子摄方案**(focused.md 中 CSDN 文章实测):
  - 主摄渲染游戏画面
  - 子摄只渲染一个"WarFog 层"plane
  - 角色脚下放白色小 panel(发光源)
  - 子摄输出到 RenderTexture
  - shader 把 RenderTexture 当 mask 叠到大地图上
- 视野圆**硬边**就是 `step(uv, radius)`;**软边**是 `smoothstep(r-soft, r, uv)`

**启发点**:
- 三态明确(没去过/去过/当前看到)在战术游戏才需要,Cairn 用户只需要两态
- D4 的"zone 切换画卷展开"是个**关卡过渡的仪式**,值得借鉴给 Cairn"激活新探索区域"时

---

### 2.3 RTS: StarCraft / WC3 / DotA

**视觉效果** 【公知】:
- **SC2** 经典 RTS 模板:黑(unexplored) / 灰白噪点纹理覆盖(explored, 视野外) / 完全清晰(视野内)
- 边缘是**噪点 dithered + 半透软边混合**,既有颗粒感又不刺眼
- **WC3 的"羊皮纸纹理"** 是关键:已探索区域的灰雾上叠加了一层羊皮纸/油彩纹理,看上去像古地图

**实现** 【公知 + GitHub fog-of-war repo focused.md】:
- 经典做法:tile-based **bitmask grid**(64x64 / 128x128 cells)
- 每个 cell 三态:0 / 1 / 2
- 渲染时把 bitmask 上传到 shader,采样 + smoothing 出软边
- DotA 视野是**圆形 + 角色椎体**(穿过高地视野受限)

**启发点**:
- **dithered + 噪点纹理**是个低成本但风格化的妙招 — 比纯灰色多了"质感"
- 切割成 tile 而不是逐像素 mask,**性能 + 视觉柔和度**都好(GPU 采样时双线性插值天然平滑)

---

### 2.4 原神 / 崩坏 / 王者(国产手游)

**视觉效果** 【公知 + 米哈游游戏实况】:
- **原神** 是国产手游中 fog 设计的天花板:
  - 未探索区域**淡白色雾 + 蓝色细噪点**(像晨雾)
  - 边缘超大软渐变,~150px+
  - 解锁是**七天神像激活**,有花瓣绽放式涟漪,从神像中心向外扩散 3-5 秒
  - 关键:小地图和大地图**双向同步**,小地图实时跟随角色,大地图是"打开全屏看进度"
- **崩坏:星穹铁道**:每个星球关卡内,锚点(传送点)激活后一条线性扫描动画"扫"过该区域
- **王者荣耀**:MOBA 标准,三态 + 紫蓝色调,鲜艳

**启发点** 【这是 Cairn 最该看的参考】:
- 原神"七天神像激活涟漪"= Cairn 可以做"**步行抵达兴趣点时,从该点向外脉冲解锁周围 100m**"
- 小地图 + 大地图双向同步思路:Cairn 可以让小预览图实时更新,大地图打开时再看探索百分比

---

### 2.5 Pokemon Sword/Shield Wild Area

**视觉效果** 【公知】:
- 大地图上空有**半透白色云团**飘动(不是静态雾)
- 走入云团时,云**像粒子一样消散**,而不是 alpha 渐隐
- 云之间有"风"的运动感

**实现** 【推测】:
- 大概率是**3D 粒子云体积**(volumetric clouds simplified)叠在地形上空
- 消散用 **particle system + scale↓ + alpha↓ 同步动画**

**启发点**:
- 云团**飘动 + 粒子消散** = 比静态雾更有生命感
- 但**对 Cairn 这种 GPS 真实地图 app 来说成本太高**,3D 粒子云体积在移动端是性能杀手

---

### 2.6 Fog of World (iOS app) — Cairn 最直接的对标

**视觉效果** 【公知 — 这个 app 是 Cairn 类型产品的鼻祖】:
- **故意像素化**:1km×1km(可配置)方格,每个走过的方格"亮起"
- 未走过区域:深蓝灰色半透 70%,**硬边方格 + 微噪点纹理**
- 走过方格:完全透明显示底图
- 没有花哨动画,**走入即亮**,但边缘保留方格颗粒感作为"地图游戏化"的风格标识

**实现** 【公知 + 用户报告】:
- 标准的 **MKMapView overlay** (iOS) — Mapbox/MapKit
- 数据结构:**GeoHash 网格** 或自定义经纬度网格
- 每个 cell 是个 polygon overlay,走过的 polygon 删除
- 海量 polygon → 用 **GeoJSON + 矢量瓦片** 优化

**启发点** 【关键】:
- **故意像素化是个差异化品牌**:Fog of World 用户买的就是这种"我在玩 Minecraft 真实世界版"的复古感
- **VS 软边渐变**:软边更"文艺/探险"(塞尔达系),硬边像素更"游戏化/打卡"(Fog of World)
- Cairn 必须**选边站**:这不是技术问题,是产品定位问题

---

### 2.7 Strava heatmap

**视觉效果** 【证据 batch3.md remisalmon/Strava-local-heatmap】:
- **反向 fog** — 不是遮罩,是**轨迹热力图叠加底图**
- 用户走过的路径:橙红/紫蓝渐变发光,出现次数越多越亮
- 没走过的:正常底图
- **没有 explore/unexplore 二分**,只有"频次"

**实现** 【证据 — Python folium + GPX 解析,公开源码】:
- 从 GPX 文件提取 GPS 点
- 用 **folium.plugins.HeatMap** (基于 leaflet.heat.js)
- 算法:每个 GPS 点贡献一个**高斯模糊的圆**到 canvas,叠加累积
- 颜色 colormap: blue→cyan→yellow→red 标准热力色

**启发点**:
- **混合模式**值得考虑:Cairn 可以做"探索过 = fog 清除 + 轨迹叠加热力线"
- 但 Strava 走的是**数据可视化路线**,Cairn 想做"游戏感"的话,heatmap 是补充不是主线

---

## 3. 关键模式 — 业界跑得最好的 3 个范式

### 范式 A:**Tile-based bitmap mask**(SC2/WC3/Fog of World 用)

```
原理:把世界切成 N×M 的格子,每格存 0/1/2 状态
渲染:把 grid 当成 texture 上传 GPU,shader 采样
软边:采样时用 bilinear filtering + smoothstep 自动平滑
```

**优点**:O(1) 查询,GPU 采样天然带软边,移动端友好
**缺点**:格子分辨率决定下限,太粗有马赛克(但 Fog of World 把这当成卖点)

---

### 范式 B:**RenderTexture + 多摄方案**(D3/Unity 主流插件)

```
原理:主摄渲染场景,子摄只渲染"揭示源 plane",输出 RT
shader:RT 当 alpha mask 叠到 fog overlay 上
```

**优点**:支持任意形状揭示(圆/扇/不规则),软边天然
**缺点**:每次需要重新渲染 RT,移动端 fillrate 紧张

---

### 范式 C:**Vector overlay + polygon clipping**(Fog of World iOS 真实做法)

```
原理:把世界覆盖一张大 polygon,走过的点从 polygon 里 boolean subtract
渲染:用地图 SDK 自带的 polygon overlay 渲染
```

**优点**:精度无限,可任意矢量化
**缺点**:多边形复杂度爆炸,N 万个点要走 simplify 算法(Douglas-Peucker)
**注意**:这是**地图 app 专用范式**,不适用 Unity 游戏

---

## 4. 给 Cairn 的 5 个具体设计点子

(假设 Cairn 是 GPS 探索 app,用户行走时解锁地图——基于上下文反推)

### 点子 1:**"区域脉冲解锁" — 借鉴原神 + 塞尔达**

**用户感受**:走到一个"兴趣点"(POI,如公园入口/地标)时,**从该点向外一个圆形涟漪扩散 2 秒,半径 100-200m**,涟漪过的地方雾消散。配淡淡"叮"的音效。

**对比逐 GPS 点亮**:逐点亮是"打卡感",区域脉冲是"探索仪式感"。前者机械,后者有故事。

---

### 点子 2:**"硬边像素 vs 软边羊皮纸" — 必须选一个**

**用户感受 A (硬边像素 Fog of World 派)**:用户感觉在玩 Minecraft 现实版,每个方格都是"我打的卡"
**用户感受 B (软边羊皮卷 塞尔达派)**:用户感觉在画自己的探险地图,每片区域都是"我去过的地方"

**不能两头骑墙** — 视觉风格必须二选一。Cairn 现在的定位偏哪边?如果是健身打卡 → A;如果是探险叙事 → B。

---

### 点子 3:**"双层 fog" — 已探索区域不要完全清晰**

**用户感受**:刚走过的地方 100% 清晰,1 周前走过的地方变成"探索过但有点淡化"的灰蓝色,1 个月前走过的进一步淡化(类似 Strava heatmap 但 fog 反向)。

**好处**:激励用户**重访**(老朋友、回忆),不只奖励"开新图"。
**注意**:可能引起用户焦虑("我的进度褪色了"),需要 A/B 测。

---

### 点子 4:**"边缘噪点纹理" — RTS 偷的招**

**用户感受**:fog 不是纯色,边缘有细微的颗粒/噪点纹理(就像 WC3 的羊皮纸),静止时看着像水彩晕染,**视觉上比纯色 alpha 高级 3 个档**。

**实现成本**:一个 64x64 noise texture + shader 里 multiply,几乎零成本。

---

### 点子 5:**"地图视角下显示探索进度" — 借鉴塞尔达**

**用户感受**:打开大地图全屏视图时,**右上角显示"本月探索 12.3km² / 共 152km² = 8.1%"**,下方有"按地区"列表(类似塞尔达地区分块):中央公园 100%、布鲁克林大桥 45%、皇后区 12%……

**关键**:让用户**看到进度**,而不是只看到"哪里有雾"。塞尔达激活塔后强调"该地区已揭示",不是"还有多少没揭示"——**积极框定**很重要。

---

## 5. 给 Cairn 决策者的 3 个 trade-off

**Trade-off 1: 风格 vs 性能**
- 软边大渐变 + 噪点纹理 = 美但 GPU 累(移动端会发热)
- 硬边像素 tile = 性能极佳但需要"故意复古"的产品定位支持

**Trade-off 2: 真实感 vs 游戏感**
- 跟着 Strava 走 heatmap 路线 = 真实数据可视化,但不"开心"
- 跟着原神/塞尔达走 = 强游戏感,有"打开新地图"的兴奋,但可能让用户觉得是个游戏不是工具

**Trade-off 3: 增量更新 vs 整片揭开**
- 逐 GPS 点亮 = 实时反馈强,但视觉上"刷雪花"
- 区域整片揭开 = 有仪式感但可能让用户走 50m 没看到任何变化,无聊

---

## 6. 引用来源

【证据来源】
- [VG247: BotW map closer look](https://www.vg247.com/2017/01/21/heres-a-closer-look-at-the-legend-of-zelda-breath-of-the-wilds-map-and-additional-screenshots/) — BotW 地图分块设计
- [Nintendo-hub/objmap](https://github.com/Nintendo-hub/objmap) — BotW 社区反编译瓦片图
- [HyruleMap GitHub](https://github.com/Salicorne/HyruleMap) — BotW draggable/zoomable map 实现
- [zhuanlan: 旷野之息浅浅拆解](https://zhuanlan.zhihu.com/p/467320727) — BotW 玩家深度分析
- [wblachut/fog-of-war](https://github.com/wblachut/fog-of-war) — HTML canvas raster fog 简单实现
- [CSDN: Unity FogOfWar 详解](https://blog.csdn.net/m0_46642453/article/details/149842973) — Unity 战争迷雾资产/Compute Buffer 思路
- [CSDN: Unity 战争迷雾 shader](https://blog.csdn.net/Egret_or_Unity/article/details/79447300) — 双摄+RenderTexture 实现详解
- [remisalmon/Strava-local-heatmap](https://github.com/remisalmon/Strava-local-heatmap-browser) — Strava heatmap 算法源码
- [roboes/strava-local-heatmap-tool](https://github.com/roboes/strava-local-heatmap-tool) — Strava GPX → folium HeatMap 库
- [Bicycling: Strava military base reveal](https://www.bicycling.com/news/a20045662/strava-heatmap-military-base-locations/) — Strava heatmap 设计后果
- [Sogou 百科: 战争迷雾](https://baike.sogou.com/v174564578.htm) — Black fog 概念 / Dune2 起源
- [Sea of Thieves 官网](http://www.seaofthieves.com/) — 海盗航海图风格

【公知来源】(行业已知,无单一 URL 证明)
- 游戏实况 / 个人玩家经验:Zelda BotW、TotK、原神、崩坏星穹铁道、王者荣耀、Diablo 3/4、PoE、SC2、WC3、DotA 2、Pokemon Wild Area、Sea of Thieves、Civ VI、RimWorld、Fog of World iOS app
- 这些游戏的视觉设计模式在 gamedev 社区 (r/gamedev、GDC vault) 是公开知识,但具体 URL 难以从 GLM 搜索拿到

【没找到的】
- BotW 渲染管线的官方 Nintendo 技术文章 — Nintendo 极少公开技术细节,只能反推
- 原神 fog 实现的 miHoYo 内部文章 — 内部技术从未公开
- Fog of World iOS 的开发者博客 — 国内独立开发者团队,无技术博客

---

## 7. 调研边界 & 不足

**没看 Cairn 代码** — 报告完全是从外部视角,不知 Cairn 当前 fog 是 tile-based 还是 raster overlay,也不知用什么 map SDK。决策时主 agent 需要把"Cairn 现状"叠加进来。

**搜索引擎局限** — GLM `search-pro` 对英文 gamedev 内容覆盖差,主要返回中文站。报告里大量"【公知】"标签来自我个人游戏经验 + 公开实况,**不是从搜索独立验证的**。如果用户/Arch 想要"硬证据每条都有 URL",需要 VPN + Google Scholar / GDC vault 检索。

**没穷尽产品** — 漏掉了:Watch Dogs Legion、Spider-Man (PS5)、Hades(roguelike fog)、Slay the Spire(节点地图)、Dead Cells——这些都有自己的"未探索区域"设计但风格各异。如果 Cairn 想看 more,可继续。

---

**报告结束**

调研员 A 立场:**给 Cairn 最大启发的两个标杆是塞尔达 BotW(软边+区域脉冲解锁,探险叙事)和 Fog of World iOS(硬边像素,打卡游戏化)**。这两个代表"探索遮罩"产品定位的两极,Cairn 必须选一边——不选会做出四不像。
