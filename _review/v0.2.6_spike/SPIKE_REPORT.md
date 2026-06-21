# Spike 报告 — Playwright web 自动化测试 Cairn

**日期**: 2026-06-21
**状态**: ✅ PASS

## 验证结论

| 验证项 | 结果 |
|---|---|
| `expo start --web --port 8081` build | ✅ 63s 出 bundle, 3015 modules, 0 errors |
| `mapbox-gl@2.15.0` web bundle | ✅ 1 module 已进 bundle |
| `@azesmway/react-native-unity` (native-only) | ✅ metro dead-code strip,web build 不挂 |
| `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` 自动登录 | ✅ Home 页直接 "Good afternoon, Explorer" |
| MCP Playwright `browser_navigate` 进 home | ✅ 0 console errors (只有 deprecation warning) |
| MCP `browser_click` 切到 Memory tab | ✅ navigation 正常 |
| `navigator.geolocation` monkey-patch | ✅ `browser_evaluate` 注入 fake fix 可行 |
| MCP `browser_take_screenshot` 保存 | ✅ `_review/v0.2.6_spike/01-home.png`, `02-memory-no-gps.png` |

## 关键发现

1. **web build 比想的顺**: Expo SDK 54 + Metro web + react 19.1 + mapbox-gl 2.15 兼容,unity-native-module 不阻塞
2. **MCP Playwright 直接驱动 dev server**: 不需要装 `@playwright/test`、不需要 `playwright.config.ts`,主 agent 直接调 MCP
3. **Memory 在 web 上完全没地图**: `mapboxAdapter.ts:27` web 分支返回 `makeUnavailable()` → MemoryMap fallback 是空白 → 视觉测试需要先接 react-map-gl
4. **GPS mock 可行**: monkey-patch `navigator.geolocation.getCurrentPosition` 在 `browser_evaluate` 里直接干,GpsLockStep 应该会被骗到

## 下一步 plan

### Phase 1: 不接地图也能跑的 flow 自动化(0.5 天)

不动 production code,先做能跑的:
1. 写一个 helper script (`scripts/web-test-helpers.md` 形式的文档)记下 expo web 启动 + MCP geo mock 的标准做法
2. Plant flow non-map 步骤: GpsLockStep → (跳过 PinAdjustStep 因为地图缺) → ContentStep → submit
3. Memory tab + 用 `window.__memoryStore` 注入 visited points → 看 Summary card 数字

### Phase 2: 接 react-map-gl 让地图可见(1-2 天)

只动 `mapboxAdapter.ts` 的 web 分支,native 一行不动:
1. `mapboxAdapter.ts` web 分支引入 `react-map-gl/mapbox` (需要 `npm install react-map-gl`)
2. 把 MapView / Camera / ShapeSource / FillLayer / LineLayer / UserLocation 映射到 react-map-gl 的 `<Map>`/`<Source>`/`<Layer>`/`<Marker>`
3. onMapIdle → `onIdle` prop
4. 跑现有 jest 套件确认 native 零回归

### Phase 3: 4 个 v291 bug 的回归 spec(0.5 天)

每个 bug 主 agent 用 MCP Playwright 重现,我直接读截图:
- **N1 donut**: inject 5 个 visited points → screenshot → 我看是否 donut
- **N2 GPS 15s**: setGeolocation → 计时进 PinAdjustStep ≤ 5s
- **N3 圈出屏**: PinAdjustStep screenshot → 我看 max-nudge ring 是否完整在屏幕里
- **N4 pinch 漂**: `page.mouse.wheel` zoom → 读 pinLat/pinLng state → 应不变

### 作为 OTA gate

每个 sprint 推 OTA 前主 agent 自动跑这 4 条 spec → 失败不推

## 风险

- react-map-gl 在 web 上的视觉**不会**和 native @rnmapbox/maps 像素级一致 — 接受,我们关心的是"fog donut 还是 connected"这种结构性差异,不是色相
- 不接 react-map-gl,Phase 1 也能 cover 60% 的 plant 逻辑 bug,但 N1/N3/N4 是地图相关 bug,**不接地图测不到**
- dev server `expo start --web` 启动慢(60s),最好后台常驻而不是每跑一次都启动
