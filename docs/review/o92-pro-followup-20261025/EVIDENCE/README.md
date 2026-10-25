# Evidence map

Git 仅保留可复审的文本 authority 与 runner；按 `AGENTS.md`，生成截图/视频/raw logs 不提交 deploy-bearing main。编号 ZIP 的 `EVIDENCE/` 包含：

- `route/BEFORE/`：本轮修改前零像素 FAIL 与截图。
- `route/DIAGNOSTIC_PASS_NOT_FINAL_ACCEPTANCE/`：一次真实 installed Mapbox GL 像素 PASS（五 zoom + Detail），明确仅作诊断。
- `route/REPEATED_FAILURE/`：相同旅程的透明 canvas FAIL、非空 source/layer report 与 Chrome stderr。
- `found-detail/`：两张 390×844 稳定态截图及 computed styles JSON。
- `memory/`：修复前确定性 FAIL、修复后 focused PASS。
- `localization/`：catalog check、设备 locale matrix tests、production export 摘要。
- `tests/`：focused、verify:changed、verify:full、tsc、iOS export raw receipts。
- `source/`：commit diff、changed-file list 与实际 relevant changed source/tests。

所有坐标来自 synthetic public-place fixture；没有 token、生产 dump 或 private friend raw data。

