# Evidence Map

依照 `AGENTS.md`，生成截图/视频/原始 JSON 不提交到 deploy-bearing `main`。Git 内保留文本判定、测试和可重复 runner；外部 #19 ZIP 包含：

- `performance/run-1.json` … `run-5.json`：10k 原始收据。
- `route-visual/headless/report.json`、`headed/report.json`：未篡改 verdict。
- z18 page/canvas/framebuffer 截图与 headless Detail 截图。
- `ios-export/SHA256.txt`：JS/Hermes bundle 与 metadata 哈希，不含 13.7MB bundle。
- `source/changed.patch` 与相关完整 changed source/tests。
- `FINAL_STATUS.txt`、`SHA256SUMS.txt`。

原始 visual report 不含 token、私有坐标或生产数据；fixture 是 Wellington 公共位置附近的合成 display geometry，报告不保存完整 coordinate arrays。
