# 清理孤儿 · 遗漏代码盘点 (2026-07-20)

## Part 1 · Playwright 测试文件总结（14 个 .spec.ts + 1 helpers + 3 config）

### 未来可以复用的（保留）

| 文件 | 用途 | 未来价值 |
|---|---|---|
| `tests/sprint72/helpers.ts` | JWT localStorage seeding · fetch mock · breadcrumb read · goHome + viewport | ⭐⭐⭐⭐⭐ 通用 Playwright 工具库，任何 auth flow 测试都能复用 |
| `tests/sprint72/story-549-auto-login.spec.ts` | Cold-start auto-login 5 场景（valid token/no token/network err/logout marker/logout→relogin） | ⭐⭐⭐⭐ auth 冷启动回归模板 |
| `tests/sprint72/story-550-refresh.spec.ts` | 401 iron rule + apiService refresh 流程 | ⭐⭐⭐⭐ token refresh 回归模板 |
| `tests/sprint72/story-551-unfinished-session.spec.ts` | 未完成 session 检测 + banner | ⭐⭐⭐ crash recovery 场景，v409/v412 delta 回归都能用 |
| `tests/sprint72/story-555-hiking-refresh.spec.ts` | Hiking-time token refresh 30 分钟 interval | ⭐⭐⭐ 长会话 token 保活回归 |
| `tests/sprint72/story-557-breadcrumb-hook.spec.ts` | `window.__cairnBreadcrumbs` dev hook + ring buffer | ⭐⭐⭐⭐⭐ Playwright 通用 debug 工具的验证，所有 crashLogger 测试都靠它 |
| `tests/sprint73/v404-cold-boot.spec.ts` | v404 cold-boot policy（kill app → login page） | ⭐⭐⭐ 政策回归（用户 2026-07-06 明确规则） |
| `tests/sprint74/v409-offline-reliability.spec.ts` | v409 offline queue + hike survival（**754 行，最大**） | ⭐⭐⭐⭐⭐ 生产 offline 场景全套测试，删掉太可惜 |
| `playwright.config.ts` | Playwright 主配置（默认 web 端口） | ⭐⭐⭐⭐⭐ 基建 |

**方法论价值**：Sprint 72-74 建立的 **fetch 拦截 + AsyncStorage seed + breadcrumb 读取** 模式是我们未来所有 Playwright 测试的标准套路。

### 可以删除的（历史 story，已过时）

| 文件 | 原因 |
|---|---|
| `tests/sprint71/friend-system-v4-scenarios.spec.ts` | Sprint 71 v4 friend 系统场景。核心已进 useFriendStore + 生产运行 30+ 天，story-specific 测试已无价值 |
| `tests/sprint72/story-552-auto-pause.spec.ts` | auto-pause 已进生产 |
| `tests/sprint72/story-553-sampling-downgrade.spec.ts` | sampling downgrade 已进生产 |
| `tests/sprint72/story-554-flush-interval.spec.ts` | 常量常量,回归价值低 |
| `tests/sprint72/story-556-hint.spec.ts` | 静态 UI hint 文案，已生产 |
| `tests/cleanup-baseline/all-screens.spec.ts` | 本次清理专用基线,清理完就没用 |
| `playwright.cleanup-baseline.config.ts` | 同上 |
| `playwright.sprint72.config.ts` | Sprint 72 专用，可归到 sprint72/ 目录 config 或直接删（helpers 保留） |

**建议**：551/555/557 保留但归到 `tests/regression/` 目录（改名去除 sprint72 story 编号）。sprint71/73/74 保留但移到 `tests/regression/`。

## Part 2 · 上次清理遗漏的孤儿 (7 处)

### 🔴 应该删但漏了 · 前端源代码孤儿

| # | 位置 | 问题 |
|---|---|---|
| 1 | `src/services/__tests__/unityCairnSpawn.crossSession.spike.test.ts` | **AR spike test**，代码路径已删（UnityARLib 全砍） |
| 2 | `src/store/useMarkerStore.ts:54-62,91-96,170-203,440` | Marker 上 `arOriginLat/Lng` + `AR_ORIGIN_KEY_PREFIX` + `arOriginKey()` + `arOrigin` state + `setArOrigin/clearArOrigin` actions —— **AR 残余** |
| 3 | `src/components/OtaBadge.tsx:269,1830` | 注释里提 arOrigin dev tool（"persisted arOrigin NEVER used"），残留 fix 注释 |
| 4 | `src/components/flame_3d_mock.html` | 5KB html mock，从 2026-05-29 起就是孤儿 |
| 5 | `src/components/icon_picker_3d.html` | 22KB html mock,孤儿 |
| 6 | `src/components/icon_picker_demo.html` | 22KB html mock,孤儿 |
| 7 | `src/services/routing/editAnalytics.ts` | 需 grep 验证（可能未接） |

### 🟡 静态图报的 dead 实际是"测试引用"（保留，不能删）

| P2 建议删的 | 实际引用 |
|---|---|
| `services/routing/mapmatch/coordSampling.ts` | `mapmatch/__tests__/coordSampling.test.ts` 引用 |
| `services/contentFilter.ts` | `utils/__tests__/geo-spacing-filter.test.ts` 引用 |
| `hooks/useLikeReport.ts` | 生产代码 `hooks/useLikeReport.ts` 是 marker like/report backend 调用（前端有 fetch），不是死代码 |

**但 `hooks/useLikeReport.ts` 静态图说没被 import**——需要看它是不是仅在 dead component 里被引用。

### 🟢 arOrigin 需要用户决定

`useMarkerStore` 里的 arOrigin 相关代码是 **AR 时代产物**，AR 已全删。这些字段在 backend Marker table 里应该也存在（ar_origin_lat/lng 列）。清理要：

1. 前端 `arOriginLat/Lng`、`arOrigin` state、setter/getter 全删
2. Backend marker.js 里 ar_origin_lat/lng insert/select 列删除（如有）
3. DB schema `markers` 表列删除（DBA 操作）

**这需要你决定**：是否一并砍掉 arOrigin 全链路？

## Part 3 · 建议行动方案

**收到你的 JSON 决策后我会**：

1. **执行 Part 2 你勾"删"的**（一功能一 commit）
2. **删测试孤儿**（unityCairnSpawn spike test + 3 个 .html mock + 老 sprint story test）
3. **清 arOrigin 残余**（等你决定是否砍全链）
4. **归档保留测试** → `tests/regression/`
5. **git tag v416-cleanup-complete**
6. **最后一次 grep 扫描**：对每个已删文件，全项目搜索是否还有 import/reference（真正的 "no orphan" 验证）
7. **推 OTA**（唯一一次）
