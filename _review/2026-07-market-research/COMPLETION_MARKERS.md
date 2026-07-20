# 完成标记规范

**用途**: Phase 1 抓取 subagent 输出的每个 raw 文件末尾必须有此标记,主 agent 用于判断是否完成 vs 半成品。

## 标准格式

每个 `raw/*.md` 文件**最后一行**:

```
[COMPLETE T+2026-07-18T15:32:00Z, 87 records, tool_call_used 42/50]
```

**字段说明**:
- `T+ISO_TIMESTAMP` — 完成时间(UTC)
- `N records` — 实际抓到的数据条数(不是目标数)
- `tool_call_used A/B` — 用了 A 个 tool call,预算 B

## 半成品判断规则

主 agent 中断续跑时读每个 raw 文件末尾:

| 末尾状态 | 判断 | 动作 |
|---|---|---|
| 有 `[COMPLETE ...]` 完整标记 | ✅ 完成 | 跳过 |
| 有 `[COMPLETE ...]` 但 records < 50% 目标 | 🟡 完成但少 | 决定要不要补跑(看重要性) |
| 有 `[TIMEOUT ...]` 标记 | 🔴 timeout 半成品 | **续跑**从最后一条 URL 后 |
| 无标记但文件非空 | 🔴 半成品(crash 中断) | **续跑或重跑**看 records 数 |
| 无标记且文件空 | ⬜ 未启动 | **从 0 启动** |

## 续跑 vs 重跑阈值

**不是单一 records 数** —— 综合 3 条件:
1. **records 数**: > 50% 目标 → 倾向续跑; < 50% → 倾向重跑
2. **最后一条抓取时间**: < 30 分钟前 → 续跑; > 30 分钟或不确定 → 重跑
3. **剩余目标 URL 清单是否完整**: 完整 → 续跑; 不完整 → 重跑

**冲突时**: 保守选**重跑**(重跑成本 = subagent 时间,不重跑成本 = 数据不完整污染 Phase 2)

## Session 收尾强制

每 session 结束前主 agent 必须:
1. **Edit CHECKLIST** 移 `▶ CURRENT` 到下一未完成任务
2. **Write `session_log/S{N}_summary.md`** 含:
   - 本 session 完成了什么(勾了哪些 [x])
   - 本 session 遇到的坑
   - 下 session 要注意什么(半成品清单 / 待验证问题)
3. **Git commit**(如果 git 允许) `raw/` + CHECKLIST + session_log

## Subagent Prompt 强制包含

所有 Phase 1 subagent 的 prompt 最后必须写:

```
## 完成标记

任务完成时,在输出文件末尾 append:
[COMPLETE T+<ISO_TIMESTAMP>, <N> records, tool_call_used <A>/<B>]

Timeout 时,在末尾 append:
[TIMEOUT T+<ISO_TIMESTAMP>, <N> records, tool_call_used <A>/<B>, last_url: <URL>]

crash 时,主 agent 会自动识别无标记 = 半成品。
```
