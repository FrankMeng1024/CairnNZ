# OTA-only Memo 优化方案(v303 native 暂停期间,2026-06-22 → 07-01)

## 约束
- **不能 build** — 所有改动必须纯 JS,Metro/Hermes 能跑
- 当前生产 = v302 legacy fog (polygon-union),已知痛点
- v303 native code 已在 master,**fogMode='legacy' 时不激活**,等 7/1 build

## 用户痛点回顾(v302 用户报、v303 想解决但暂停)
1. **N3** 打开慢(union 600 个点 ~300ms)
2. **N4** 边缘狗啃(circleVertices=32,union 后线段感)
3. **N5** zoom-out 只有部分有 fog,亮屏(outerRingPadFactor=0.5 限制)
4. **N6** 弹回当前位置(v302 已修)
5. **N7** 视觉糟糕(0.62 alpha 还是太"塑料")
6. **N8** 走动解锁不丝滑(每次 union 全量重算)

## OTA 能动的杠杆(逐条评估)

### A. circle 多采样 + outer 大幅扩 — N4 + N5(✅ 可行,中等改动)
- v302 验证过 padFactor 5x 在 zoom 14 silent skip → 不能盲改
- **新方案**:**zoom-aware padFactor**。从 MapView onCameraChange 拿到 zoom,
  - zoom ≥ 15:pad = 2(细节区,小范围)
  - zoom 13–15:pad = 1(过渡)
  - zoom ≤ 13:pad = 0.3(对应像素边缘 ~600px 内,避免 silent skip)
- circleVertices 32 → 24(降 union 成本,加 turf.simplify 后端补回平滑)

### B. **不要 turf.union,改"先 rasterize 再 vectorize"思路** — N3 + N6(❌ 不可行,JS 太慢)
- WebWorker 不行,RN 没有
- Skia Canvas (已装 @shopify/react-native-skia) **可以在 GPU 上画然后导出** — 但导出回 GeoJSON 给 Mapbox FillLayer 没有便宜路径
- 复杂度高 → 推后

### C. **改 Mapbox 自己的 GeoJSON 多 source 渲染** — N4(✅ 可行,直接出效果)
- 当前:1 个 Polygon with N holes → mapbox-gl 把 holes 当 hard edge 画
- 新:**2 个 source**
  - source A:fog full viewport polygon (无 hole)
  - source B:每个 unlock 圆作为单独 CircleLayer (不是 polygon!)
- CircleLayer 用 `circle-blur` style prop → **GPU smoothstep 软边**!没 native build,纯 Mapbox style
- ⚠️ 问题:Mapbox CircleLayer **画的是带颜色的圆**,不是"擦除"。要擦得用 **fillLayer + mapbox-gl mask blend mode**,RN @rnmapbox 不支持 blend mode override
- **实际可行方式**:把 fog 改成"画 unlock 圆 的反向" — 用 SymbolLayer + 透明图标?太 hack
- **真正能动的**:`fill-antialias: true`(默认 false)+ holes 加 turf.simplify 平滑顶点。**小改动,N4 大幅改善**

### D. **预计算 + 渐进式更新** — N6(✅ 可行,中等改动)
- 当前:每次 geometryVersion bump → 全量 union
- 新:
  - 把 union 拆成 **chunk + memoize**。已合并的 holes cache 起来,新 unlock 只 union 新加的 ~5 个 circle 跟 cache 的"邻居"chunk
  - 用 H3 / geohash 把点分桶,每桶独立 union,只 invalidate 新点落入的桶
  - **改动较大** — 适合 7/1 前认真写

### E. **走路解锁动画** — N6 + N7 + N8(✅ 可行,Skia)
- 已装 @shopify/react-native-skia
- fog 主体仍 Mapbox FillLayer,**新加一层 Skia Overlay** 在 fog 之上
- 用户最新解锁的 5 个点 → Skia 画扩散动画(圆从中心放大 → 透明),0.8s 后融入 fog
- **完全可 OTA**,产品感最强:用户走一步看到 fog "被擦开"的动画
- ⚠️ Skia 跟 Mapbox 不在同一 GL context,只能盖在 上面 → 用 absoluteFill 透明 Skia view 跟 MapView 同坐标系
- 实现:订阅 useMemoryStore 新 unlock 事件 → push 到 Skia 动画队列 → 用 useFrameCallback 跑 1s 动画 → 自然消失

### F. **fog 视觉调** — N5 + N7(✅ 5 分钟可改)
- 当前 `rgba(50, 35, 20, 0.62)` 用户说"塑料"
- 改:用 noise texture 叠层(纸质感)。Mapbox FillLayer 支持 `fill-pattern` — **预生成一张 sepia noise PNG 打进 JS bundle**(< 50KB),fillPattern 替代 fillColor → 自然纸质质感
- 或:**两层 fog**
  - 底层:`rgba(74, 55, 30, 0.55)` 实色
  - 上层:fillPattern 噪点 PNG `fill-opacity: 0.15`
- 出效果立竿见影,且 hole 边缘也跟着带噪点感(融合更好)

### G. **加快打开** — N3(✅ 可行)
- 用 `react-native-mmkv` 替代 AsyncStorage 读 points(已装?check)
- 首屏不等 hydrate 完才显示,先用最近 cached holes render → bg 异步 union refresh

## 推荐改动包(按 ROI 排)

| 优先级 | 改动 | 改哪 | 用户感知 |
|---|---|---|---|
| **P0** | fillPattern noise + 两层 fog | FogLayer.tsx + 加资源 | 立刻 "塑料感" 解决 |
| **P0** | zoom-aware padFactor | fogBuilder + FogLayer | N5 zoom out 不再有亮屏 |
| **P0** | turf.simplify holes | fogBuilder | N4 边缘平滑 |
| **P1** | Skia 解锁扩散动画 | 新 MemoryFogOverlay 组件 | N8 走动丝滑感拉满 |
| **P1** | H3 桶 + 增量 union | fogBuilder 重构 | N3 打开快 + N6 走动不卡 |
| **P2** | fill-antialias=true | FogLayer style | N4 微调 |

## 实施顺序(我建议)

**今天:P0 三件套**(改动小、风险低、立刻见效)
1. fillPattern noise(查 Mapbox 是否支持远程 PNG 或必须 embedded)
2. zoom-aware padFactor(MapView onCameraChange 拿 zoom)
3. turf.simplify holes(0.0001 deg tolerance)

**明天 + 后天:P1 Skia 动画**
- 这是产品差异化最大的一招,跟"2D 游戏丝滑解锁"目标对得上
- 不依赖 native build,Skia 已经在生产 build 里

**P1 H3 桶 union**:重构 fogBuilder,工程量大,可放到 v303 native 重新启动时一起做

## 7/1 之后的合并策略
- OTA-only 这套改动(P0 + P1 Skia)**跟 v303 native fog 不冲突**
- 用户 fogMode = 'legacy' 时享受 OTA 改进
- fogMode = 'sdf-soft' / 'sdf-sharp' 时走 native(更快、更平滑)
- pill 4-mode 切换让用户选

## 不做的事
- **不动 native code**(7/1 build 时一致性)
- **不切栈**(deck.gl 早 spike 否决了,不重提)
- **不删 v303 native module 文件**
