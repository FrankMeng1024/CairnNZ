# J1–J9 集成旅程与证据边界

| 旅程 | 本地执行结果 | 证据 | 未取得 / 不得推断 |
|---|---|---|---|
| J1 Memory | 逻辑/组件路径通过：cold Mine、camera/recenter/city 不 invalid dataset、Cairn preview map variant、Library A→B→A/search/pagination/detail/re-entry | `memoryFogContinuity`, `preparedMemoryCoverageStore`, `allCairnsJourney`, Web UI captures | 物理 iPhone Mapbox/recenter/keyboard帧 |
| J2 Friends | 两友选择、最后取消 delayed/503→Mine、快速 reselect、stale ACK、restart/account switch 通过 | `memorySelectionIntent`, `friendMemoryAuthorizationOrdering`, `memoryFriendPickModal`, `friendMemoryFailure` | Owner 当时真实 endpoint trace 不存在 |
| J3 full regions | real disposable MySQL/Express：12k、2 个非重叠 region、Mine/Friend 9 pages complete、revision 409、revoke 0、empty terminal、旧 API 200 | `slice-b/mysql/result.json`, backend snapshot suites | 未部署到 production；无私有原始数据 |
| J4 Route | new/import/saved/repeat entry、最低 loading-map sequence、optional Fog failures、核心 Draw/Point/Trim/Undo/Save contract 均在真实 production screen/store modules 测试 | `orderedRouteEditorScreen` 及 route suites；`bad` fixture 2 项因本地 secret 条件 skip | 未编辑 Activity 2139/Route 99；无 fresh physical process/server iPhone reopen |
| J5 Gap | Gap topology、P/Q solid anchor、dashed invalid、bridge/Undo/保存结构由现有真实 modules 的 bounded tests 保留 | `activityGapBridge` 与 final full gate | Activity 2142 受保护，未在 production 写 clone；physical interaction pending |
| J6 failure isolation | missing full callback、Fog delayed/missing、zero Friends、503/auth/schema/stale callbacks 都不挡 Route core；genuine initial style failure仍 actionable | Route/Memory negative tests | transient tile vs new style 的 iPhone provider日志 pending |
| J7 U/O | canonical 1/2/3/5、parallel/true gap/disconnected/connected-Ω negative、overview与多 zoom Web/local visual | `slice-d/visual-final`, route display 80 pass/2 conditional skip | Web/Chromium pixels不是 native；没有修改 canonical/save data |
| J8 localization | en-NZ、ja QA sample、pseudo、0/1/2/many、catalog-only edit、shared key、error classification independence；core suites在 extraction 后重跑 | runtime 11/11；6 Web visual cases；text gate；final full gate | ja fallback 不等于翻译完成；large text仅 browser zoom stress |
| J9 neighbouring | bounded Start/Pause/Finish/offline/diagnostics/auth/account transition/background ownership suites通过 | final `verify:changed` 2983/2990 | 无新 outdoor walk、无 consent/admin 修改、无 native GPS telemetry声称 |

## 性能拆分

- Library 本地 React intent receipt：25 ms 与 53 ms 两次受影响总套件运行，均低于 100 ms；它不是 native tap-to-paint p95。
- Complete Memory 12k synthetic real DB：materialize 16.784 s；Mine transfer/pages 6.158 s / 122,284 B；Friend 8.114 s / 123,697 B；empty 24.83 ms / 666 B。
- U/O visual gate 使用 local style/Chromium，记录 zoom/camera screenshots；不报告 native FPS、电池或下载 Mapbox worldwide tiles。
- 自动诊断为 bounded event records（request/stage/revision/pages/timing/failure/callback），没有 per-frame upload、新 GPS owner 或 verbose battery monitor。

## 原始验证摘要

- `npm run verify:changed`: PASS，client 2637/2644、server 201/201、static 145/145，总 2983/2990。
- 聚焦 suites：23 suites / 242 tests PASS；OTP 3/3 PASS；`cairn10PrivateBadActivity.integration` 2 项按既有本地 secret gate SKIP。
- Backend Memory：9/9 PASS；真实 MySQL harness PASS。
- 文案：2,539 entries、3,045 callsites、0 orphan/errors；native permission mappings 8 MATCH。
- 视觉：U/O Web/local final、localization 6/6 Web cases；没有 iPhone acceptance。

