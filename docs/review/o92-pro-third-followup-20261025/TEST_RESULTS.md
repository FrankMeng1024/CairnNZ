# Test Results

| Gate | 状态 | 最终结果 |
|---|---|---|
| `git diff --check` | PASS | whitespace errors 0 |
| Route/Fog + geometry/draft + Memory ACK + i18n focused | PASS | 8 suites / 153 tests |
| `npm run verify:route` | PASS | 98/98 |
| `npm run verify:changed` | PASS | 651/651 |
| `npm run check:text` | PASS | 2,539 entries；3,045 callsites；en-NZ complete；0 errors |
| `npm run verify:full` | FAIL | 2,662 PASS / 1 FAIL / 7 SKIP；SKIP 未计入 PASS |
| full 唯一 Jest FAIL | FAIL | `revision03RawGpsPipeline`: input-to-decision max 170.7549ms，预算 <120ms |
| 10k Memory in full | PASS | max `tile_geometry` 34ms；预算 <150ms；10k total 10,685.8ms |
| repo `tsc --noEmit` | FAIL（既有债务） | 54 errors；Playwright types、Activity test type、Turf declaration、Preview navigation、diagnostic test；本轮文件 0 个新增 error |
| direct Mapbox GL A | PASS | 3/3；framebuffer/page 各 1,535 route-like pixels |
| real app A–E Web pixels | FAIL/BLOCKED | final A/B/C/D、Editor 5 zoom、Detail 均 0；成功/失败运行都保留 |
| hosted Mapbox Standard | BLOCKED | 无可用授权 token |
| RNMapbox physical iPhone | PENDING | 未授权/未执行 native build/device test |
| production iOS JS export | PASS | 4,253 modules；HBC 13.7 MB；SHA-256 `29b021ba0f4f2a6e81060f5b28cfca8b39f277c031d7768022522a67f693d719` |
| Localization fixed en-NZ | PASS / PRESERVED | catalog 与 ja draft 保留，无本轮 locale runtime 修改 |
| PUSH / DEPLOY / native BUILD / OTA / TestFlight / prod DB write | NOT RUN | 未授权、未执行 |

`verify:full` 的 7 个 SKIP 未计入 PASS。iOS JS export 不是 native build，也不是 iPhone evidence。
