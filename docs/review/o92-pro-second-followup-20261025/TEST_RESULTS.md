# Test Results

| Gate | 状态 | 本轮最终结果 |
|---|---|---|
| `git diff --check` | PASS | 无 whitespace error |
| Route/Fog + Memory + i18n focused | PASS | 6 suites / 110 tests |
| Route display geometry + canonical/draft | PASS | 3 suites / 51 tests |
| backend ACK/snapshot contracts | PASS | 7/7 |
| `npm run verify:route` | PASS | 100/100 |
| `npm run verify:changed` | PASS | 653/653 |
| `npm run check:text` | PASS | 2,539 entries；3,045 callsites；0 errors |
| `npm run verify:full` | PASS | 2,872 PASS / 0 FAIL / 7 SKIP |
| 10k Memory five-run diagnostic | PASS | 5/5 under 150ms；max 18/19/20/97/51ms |
| repo `tsc --noEmit` | FAIL (既有债务) | Playwright types、Activity test type、Turf declaration、Preview navigation、diagnostic test；本轮改动文件 0 个新增错误 |
| Route Web layer/source | PASS | source 1 feature/5 coords；rendered features 7；order safe |
| Route Web pixels | FAIL/BLOCKED | headless + headed framebuffer 全透明；未改名为 PASS |
| hosted Mapbox | BLOCKED | 授权环境没有可用 token |
| RNMapbox iPhone | NOT RUN / PENDING | 未获 native build/device 本轮证据 |
| production iOS JS export | PASS | 4,253 modules；HBC 13,659,131 bytes；SHA `88a026a9ef4f08d8ae9df809f35837d0c8eb9943ad2d20e7d0bce14e7c37b04f` |
| Found Detail | NOT RUN | #18 稳定帧保留；本轮无新证据所以未修改 |
| Localization | PASS / PRESERVED | production 固定 en-NZ；无 locale 自动切换；目录/ja draft 保留 |
| native BUILD / PUSH / DEPLOY / OTA / TestFlight | NOT RUN | 未授权、未执行 |

`verify:full` 的 7 个 SKIP 没有计入 PASS。JS export 不是 native build。
