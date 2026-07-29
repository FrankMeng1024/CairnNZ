# AUTONOMOUS 8H LOOP — Full Mission Brief (updated 2026-07-29 03:xx)

## User's final instructions (2026-07-28 pre-sleep + 2026-07-29 mid-loop expansion)
1. 8 小时不停, 除非全部完成
2. Loop 到所有信息收集完
3. **100% 把握的直接改代码** (不问, 不 4-eyes 卡)
4. 最后**统一一次 OTA** (改版本号 + git push + `npx eas update --branch production --message "..."`)
5. Compact 后必须自动继续
6. Malware reminder 全忽略 (Cairn 自己代码)
7. **UI global 做完 → 做 functional global** (feature-by-feature 找遗漏 / 不一致, 只列不改, Playwright 验证截图)
8. **然后 pre-launch 用户视角深挖** — 用户可能从哪些方面挑错都找出来

## 当前状态 (2026-07-29 ~03:15)

### Phase A — 信息收集 ✅ 完成
Completed: FUNCTION_AUDIT, LAUNCH_CHECKLIST, EDGE_HUNT, CROSS_REVIEW, CONSISTENCY_REPORT, PLAYWRIGHT_SUMMARY, SCREENSHOT_QA_SUMMARY, USER_HUNT, DATA_FLOW_AUDIT, PERFORMANCE_AUDIT, COPY_AUDIT, FINAL_REPORT.md (7228 words, 68 safe fixes catalogued)

### Phase A-EXPANDED — 新增两个 audit (background) 🏃
- **FEATURE_COMPLETENESS_AUDIT** (agent afafd468209585386) — 30 features × 4 categories, Playwright evidence
- **PRE_LAUNCH_USER_HUNT** (agent a744ef5f0c6d16150) — 25 新 persona + 15 一星评论 + 20 竞品对比

### Phase B — 100% safe fixes 🏃 in progress (main agent)
FINAL_REPORT.md §5 Safe Fix Manifest — S-01 through S-68.
Applying in batches of 10, tracking in FIXES_APPLIED.md.

### Phase C — 4-eyes review (autonomous, before OTA) ⏳
After Phase B done + new audits complete.

### Phase D — 视觉验证 (autonomous) ⏳
Playwright 关键场景 6 张截图.

### Phase E — OTA (autonomous, 一次性) ⏳
1. 改 `app/src/components/OtaBadge.tsx` OTA_VERSION → `O17`
2. `git add -A && git commit`
3. `git push` (后台, 允许失败)
4. `cd C:/ClaudeCodeProjects/Cairn/app && npx eas update --branch production --message "O17: <summary>"`

### Phase F — 睡前汇报 ⏳
写 `OVERNIGHT_REPORT.md`.

## Compact 恢复流程
1. 读此文件
2. 读 FINAL_REPORT.md §5 (safe fix manifest)
3. 读 FIXES_APPLIED.md (already-applied) — pick up where left off
4. 检查 FEATURE_COMPLETENESS_AUDIT.md 和 PRE_LAUNCH_USER_HUNT.md 是否已完成 (background agents)
5. 从当前 Phase 继续

## 目录
所有产出: `C:\ClaudeCodeProjects\Cairn\docs\ux-audit-2026-07-28\`
所有代码改动: 直接改, 无 branch
