# 严重发现:sessions 表在 aliyun 不存在,但客户端仍有调用点

**日期**: 2026-07-30
**Severity**: HIGH(architectural)
**Status**: 需要用户决策

## 事实

1. aliyun MySQL `cairn.sessions` 表**不存在**(`ERROR 1146: Table 'cairn.sessions' doesn't exist`)
2. 有 `_sessions_backup_o1_20260726` backup 表和 `telemetry_sessions` 无关表
3. `backend/src/routes/sessions.js` 完整定义了 8 个路由:
   - GET /api/sessions/unfinished
   - POST /api/sessions/start
   - GET /api/sessions/:id
   - PATCH /api/sessions/:id/save
   - POST /api/sessions/:id/append-points
   - DELETE /api/sessions/:id
   - PATCH /api/sessions/:id
4. 客户端 `app/src/services/sessionService.ts` + `HikingScreen.tsx` **仍在调用**这些端点
5. **24 小时内 log 中 0 个 /api/sessions/* 请求** —— 表明当前无活跃用户走这条路径
6. Startup 时 migrations 报错但 backend 继续启动(schema check 只警告不 fatal)

## 三个可能情况

### (a) 客户端有代码但实际路径避开了这些端点
比如 saveHikeAtomic 走了别的路径,老 sessions API 只是 dead code 没清理
→ 只需清理 client + server 死码

### (b) 客户端当前用户走的路径不触发这些调用
比如新用户注册后没完成一次 hike-save,一旦老用户回来就会爆
→ 需紧急恢复 sessions 表

### (c) 有人手动 drop 了 sessions 表
备份表叫 `_sessions_backup_o1_20260726` 说明 2026-07-26 有过手工操作
→ 需回顾操作原因,决定是恢复还是清理

## 决策项(用户)

- **方案 A**: 从 `_sessions_backup_o1_20260726` 恢复 sessions 表 + 全套 migrations
- **方案 B**: 确认 sessions 端点已死,清理客户端 sessionService.ts + backend routes/sessions.js
- **方案 C**: 查 git log / 阿里云 SSH history / 007-26 那天做了什么,再决定

## 我为什么不夜跑修

这不是"bug 修个 line"级别 —— 涉及:
- schema migration(可能丢数据)
- 客户端行为决策(sessions 是否是产品核心功能)
- 用户回归路径判断

memory `feedback_sleep_run_2026_07_29.md` 铁律:架构决策必须用户决策,
不能睡前 loop 里改。

## 参考

- memory: `project_sessions_table_missing.md` (2026-07-29 R26 首次发现)
- memory: `project_routes_endpoint_dead.md` (类似问题:POST /api/routes 也死了)
- backend/src/routes/sessions.js
- app/src/services/sessionService.ts
