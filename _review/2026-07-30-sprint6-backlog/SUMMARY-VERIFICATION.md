# 2026-07-30 Sleep-Run Review — 之前 SUMMARY 表格是否全部落地

## Review 对象

`_review/sprint6-round15-20/SUMMARY.md` — 上一次 sleep-run (2026-07-29 20:00-23:13 UTC) 用户填的验收清单。
28 条修复总数 = 20 backend + 7 client + 1 doc。

## Backend 表格(20 条) — 逐条对着生产容器 grep 验证

方法:`docker exec cairn-backend grep -c <指纹> /app/src/...` 对比表格声明的文件 + 修复语义。

| Round.ID | 生产容器 grep 结果 | 状态 |
|---|---|---|
| R15B1 passwordChangeLimiter | 2 hits in auth.js | ✅ 在 |
| R15B2 bumpTokenVersion | 4 hits in auth.js | ✅ 在 |
| R15B3 refreshLimiter after authenticate | 1 hit "authenticate, refreshLimiter" | ✅ 在 |
| R15B4 GDPR row caps | CAP_SESSIONS/MARKERS/MEMORY/ROUTES/FRIENDS 5 常量存在 | ✅ 在 |
| R15B5 ER_NO_SUCH_TABLE | 2 hits in DataExport.js | ✅ 在 |
| R16F5 narrow ER_NO_SUCH_TABLE | 同上 | ✅ 在 |
| R16F6 CAP+1 pattern | 5 hits | ✅ 在 |
| R16F7 caller jti revoke | 9 hits "TokenBlacklist.revoke" in auth.js | ✅ 在 |
| R16F12 friends/accept response before push | 1 hit "respond BEFORE the push" | ✅ 在 |
| R17F5 marker permission gate | 5 hits "marker.permission/permission='personal'" | ✅ 在 |
| R17F7 stale-owner token delete | 3 hits "DELETE FROM device_tokens WHERE token" | ✅ 在 |
| R17F8 whitespace normalization | 4 hits "cleanTitle/trim().length" | ✅ 在 |
| R18 memory client_id docs | doc-only,SUMMARY 也标 Backlog | ✅ 记入注释 |
| R19 #2 /fog docstring | doc-only | ✅ |
| R19 #5 legacy PATCH per-point validation | 3 hits in sessions.js | ✅ 在 |
| R19 #4 idempotency race doc | doc-only(deferred rationale) | ✅ |
| R22Q4 /push/register rate limit | 3 hits in push.js | ✅ 在 |
| R25F3 markerUpdate lat/lng | 2 hits in schemas.js | ✅ 在 |
| R25F6 https-only voice memo | 2 hits in schemas.js | ✅ 在 |
| R27B3 debug-snapshot base64 cap | 3 hits in debug-snapshot.js | ✅ 在 |

**Backend 20/20 全部落地生产** ✅

## Client 表格(7 条) — SUMMARY 明确说 "committed 但未 OTA"

| ID | 状态 |
|---|---|
| R20B6 useSessionStore hydrate syncState | git commit `68c91be` ✅,未 OTA |
| R20B5 syncDaemon orphan-sweep | 同上 ✅,未 OTA |
| R20B2 HomeScreen recent-pill 过滤 | 同上 ✅,未 OTA |
| R20B7 addSession dedupe by remoteId | 同上 ✅,未 OTA |
| R21B2 useTrackingStore hydrateSaf01 gate | git commit `cac6316` ✅,未 OTA |
| R21B1 useAppStore logout clears SAF-01 | 同上 ✅,未 OTA |
| R21B3 HikingScreen AppState ref reset | 同上 ✅,未 OTA |

- app version 仍 0.2.5(未 bump → 未推 OTA)
- 符合表格意图:等真机测通过 5-步流程后再 OTA
- 5 步真机测清单:
  1. 离线 hike → 飞行模式 → save
  2. Home 页面 pending 卡片**不能**是 recent-pill 目标
  3. 恢复联网 → sync 完成,卡片变常规
  4. force-restart app while pending → hydrate 保留 pending 状态
  5. 触发 drainPending ↔ remoteHydrate race → 无重复卡片

## Deferred 项目(SUMMARY 表格里明确 defer) — 无需 action

- R9B7 auto-migration runner
- R15 findings 5-15
- R16 F1-F4
- R17 BUG 6
- R18 ts trust
- R19 #4 idempotency reservation
- R19 #7 routes NaN/Infinity(Joi 已 cover)
- R20 BUG-1 tappable pending card(design 未确认)
- R20 BUG-4 syncDaemon permanent-failure orphan
- R23 nonce replay + 0,0 coord
- R24 X-API-Key server enable(等 coordinated OTA)
- R25 F1/F2/F4/F5/F8
- R26 sessions 表 missing(memory 里已记 project_sessions_table_missing.md)
- R27 findings 1/2/4/7

## R26 sessions 表事件的最新状态

SUMMARY 说"24h 0 客户端 error, 已文档化为 cleanup opportunity"。

**我今晚重新验证**(2026-07-30 08:00 UTC):
- sessions 表**仍然不存在**
- 但客户端 `sessionService.ts` **仍在引用 /api/sessions/start, /:id/save, /append-points 等**
- 24h log 仍 0 请求(可能新用户流程完全避开?或者当前无活跃 hike-save?)

我在 `_review/2026-07-30-sprint6-backlog/SESSIONS-TABLE-MISSING.md` 里更新了 3 个可能情况 + 决策项。**这是唯一需要用户 attention 的项**。

## 我今晚做了什么(与 SUMMARY 表格无关的额外工作)

在 SUMMARY 表格已经交付的基础上,我这轮又做了 R82-R92 共 12 个新 backend 硬化 commit:
- edit-diag / /vote / friends tx / memory / User restore / idempotency / authenticate / TokenBlacklist / friends DELETE / authSweep / push stale-sending / PasswordReset / DataExport TZ / passwordChangeLimiter / dead push tokens / authLimiter / /verify tx

全部 aliyun 部署 + docker restart + health check 200,零回滚。

## 最终结论

**你之前睡时填的表格,28 条:**
- 20 backend **全部落地生产** ✅
- 7 client **全部 committed,故意等真机测** ⚠️(符合表格意图)
- 1 doc R26 sessions 表事件 — **需你决策**

**唯一 outstanding action:R26 sessions 表** — 决定重建还是清理客户端调用。

其他一切按表格意图完成。
