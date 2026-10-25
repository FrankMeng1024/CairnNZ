# Evidence Map

Git 只保留可复现的文本 authority。生成的 PNG/JSON、测试 stdout、JS export receipt 与 patch 放在 #20 ZIP，避免把 QA captures 提交到 deploy-bearing `main`。

ZIP 证据目录：

- `EVIDENCE/visual/direct-control-initial-tool-fail/`：缺 token 导致 `_authenticate` 阻止 render 的工具失败。
- `EVIDENCE/visual/direct-control-pass/`：修正 harness 后 3/3 framebuffer/page 可见。
- `EVIDENCE/visual/app-preliminary-visible/`：A–D、五 zoom、Detail 可见的一次运行。
- `EVIDENCE/visual/app-intermittent-run1/`、`run2/`：controls 与 Editor/Detail 分离失败、全零失败。
- `EVIDENCE/visual/app-final-fail/`：最终 truth gate；verdict FAIL。
- `EVIDENCE/tests/`：focused、route、changed、full、TypeScript 与 JS export 原始收据。
- `SOURCE/`：本轮完整 changed source/tests/scripts。
- `PATCH/`：从 #20 起点到最终 commit 的 patch。

所有图像均为合成 QA Route/公开基准区域；无 token、账户资料、生产 friend data 或生产坐标 dump。
