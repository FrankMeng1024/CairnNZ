/**
 * v428-playwright-checks.md — v428 Playwright QA 测试脚本
 *
 * 用途: 主 agent 手动跑 Playwright 时的 checklist + 断言语句
 *
 * 前置:
 *   - regions-v428.sql 已入 aliyun MySQL
 *   - backend docker restart 已生效
 *   - web dev server 起来: EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true npx expo start --web
 *
 * 覆盖 v428 4 大改动:
 *   1. 全球城市高亮 (5 城市)
 *   2. Hierarchy 4 bug (三态 / 点绿钻入 / 闪烁 / legend)
 *   3. Sim-walker gate 3 组合
 *   4. Empty state banner
 */

# v428 Playwright QA 测试清单

## 测试用例 A: 全球城市高亮 (5 城市)

每个城市:
1. 用 Playwright 打开 web app
2. 通过 `window.__cairnStores.useMemoryStore.getState().setLastWatcherFix(lat, lng, Date.now())` 注入位置
3. 打开 Memory tab
4. 点 Layers icon (左下)
5. 面板显示后, 截图
6. 断言:
   - 面板 title = 期望名字
   - Mapbox source `hl-region` 有 1 个 feature (`map.getSource('hl-region')._data.features.length === 1`)
   - Fill layer 存在 (`map.getLayer('hl-region-fill')` !== undefined)
   - 截图: `docs/qa/v428-evidence/highlight-<city>.png`

### 测试点:
| 城市 | Lat | Lng | 期望 title | 期望高亮 |
|---|---|---|---|---|
| Shanghai | 31.2304 | 121.4737 | Shanghai | 上海市轮廓 |
| Auckland | -36.8485 | 174.7633 | Auckland | Auckland Region 轮廓 |
| Tokyo | 35.6595 | 139.7005 | Tokyo | Tokyo 都 (含多摩) |
| New York (NYC) | 40.7580 | -73.9855 | New York | NY State 轮廓 |
| London | 51.5081 | -0.1281 | England | England 轮廓 |

## 测试用例 B: Hierarchy 4 bug

### Bug 1 修复: 三态色显示
1. 用户位置注入到 Shanghai
2. 数据库要有:
   - Shanghai (marked - 有 marker)
   - Beijing (walked - 有 memory_points)
   - Tokyo (locked)
3. ↑ 到 Asia,面板显示 sibling countries
4. 断言: dot 颜色分别是 sepia 实心 / sepia 空心 / grey
5. 截图 `hierarchy-3-states.png`

### Bug 2 修复: 点绿色钻入
1. 面板显示 Shanghai (绿色 = 当前)
2. 点 Shanghai 那一行
3. 断言 (通过 accessibilityState 或 testID):
   - 新面板 title 还是 Shanghai (drill mode)
   - 但 siblings 变成 Shanghai's children (i.e. no siblings for CN L3, panel might be empty or show districts if L4 added later — for v428, L3 是最深)
4. 截图 `drill-into-shanghai.png`

### Bug 3 修复: ↑ 按钮闪烁
1. 快速切换 3 次不同 regionId (Shanghai → Beijing → Tokyo)
2. 使用 Playwright screencast 或 `browser_take_screenshot` 连拍
3. 断言: 每次切换过程中,`hierarchy-title` DOM 永远存在,不出现白屏
4. 截图对比 `flicker-1.png` `flicker-2.png` `flicker-3.png`

### Bug 4 修复: Legend 显示
1. 打开面板
2. 断言 DOM:
   - `hierarchy-legend` testID 存在
   - 3 个 legendItem 显示 "Marked" / "Walked" / "Never"
3. 截图 `legend.png`

## 测试用例 C: Sim-walker gate 3 组合

### C1: debugMode=false → 摇杆不显示
1. 打开 Hiking tab
2. 断言: sim-walker overlay 不存在
3. 截图 `sim-walker-off-debug-off.png`

### C2: debugMode=true, simWalkerActive=false → 摇杆不显示
1. `window.__cairnStores.settings.setState({ debugMode: true })`
2. 打开 Hiking tab
3. 断言: overlay 仍不存在
4. 截图 `sim-walker-debug-on-sim-off.png`

### C3: 两者都 true → 摇杆显示
1. `window.__cairnStores.settings.setState({ debugMode: true })`
2. `window.__simWalkerStore.getState().toggle()` (或直接 setActive(true))
3. 打开 Hiking tab
4. 断言: joystick 圆盘可见,通过 CSS class 或 testID
5. 截图 `sim-walker-active.png`

### C4: Cold restart 后 simWalkerActive 归零
1. C3 状态下 sim walker 显示
2. `location.reload()` 重启页面
3. 打开 Hiking tab
4. 断言: overlay 不显示 (simWalkerActive 已归零, 因为 useSimWalkerStore 无 persist)
5. 但 Settings > Debug 页 debugMode 还是 true (持久)
6. 截图 `sim-walker-cold-restart.png`

## 测试用例 D: Empty state banner

1. 新用户 (清空 AsyncStorage panel cache)
2. 位置到无 marker/memory_point 的地方
3. 断言: `hierarchy-empty-banner` testID 存在,文本 "Head out and start walking to unlock places."
4. 截图 `empty-state.png`

## 测试用例 E: 长名字不截断

1. 位置到 Bosnia and Herzegovina (44.5, 18.3)
2. 打开面板
3. 断言: title 显示完整 "Bosnia and Herzegovina" (22 chars)
4. 位置到 Congo (0, 20)
5. 期望 title = "DR Congo" (mapping override)
6. 截图 `long-names.png`

## 后端 API 直测 (curl)

前置: SSH 到阿里云 or 本地跑 backend

```bash
# 5 城市 /deepest 抽查
for city in "31.2304 121.4737 Shanghai" \
            "-36.8485 174.7633 Auckland" \
            "35.6595 139.7005 Tokyo" \
            "40.7580 -73.9855 NewYork" \
            "51.5081 -0.1281 London"; do
  set -- $city
  lat=$1; lng=$2; name=$3
  echo "=== $name ($lat, $lng) ==="
  curl -s "http://localhost:3001/api/hierarchy/deepest?lat=$lat&lng=$lng" \
       -H "Authorization: Bearer <token>" | jq .
done

# 5 城市 polygon 拉取 (gzip check)
for id in CHN-shanghai NZL-auckland JPN-tokyo USA-new-york GBR-england; do
  echo "=== /polygon/$id ==="
  curl -s -H "Accept-Encoding: gzip" -I \
       "http://localhost:3001/api/hierarchy/polygon/$id" \
       -H "Authorization: Bearer <token>" | grep -iE 'content-(encoding|length)'
done
```

## 通过标准

- 5 城市高亮全部截图有 fill layer 可见 ✅
- Bug 1-4 各自截图 + DOM 断言通过 ✅
- Sim-walker 4 状态截图正确 ✅
- Empty state / 长名字截图正确 ✅
- Backend API 5 城市点位命中 correct region ✅
- Backend polygon gzip 生效 ✅

**任一失败** → 记 blocker 到 v428 progress log,回到 development,不推 OTA。
