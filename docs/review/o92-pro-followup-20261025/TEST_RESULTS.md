# Test Results

| Gate | Result | Count / receipt |
|---|---|---|
| `git diff --check` | PASS | no whitespace errors |
| focused Route/Memory/i18n | PASS | 5 suites, 65 tests after final fixture additions |
| `npm run check:text` | PASS | 2,539 entries; 3,045 callsites; 0 errors |
| `npm run verify:changed` | PASS | Activity Core 659/659 |
| `npm run verify:full` | FAIL | 270 suites PASS, 1 FAIL, 2 suites SKIP; 2,651 tests PASS, 1 FAIL, 7 SKIP |
| full-gate failure | FAIL | `revision03MemoryScale`: 10k `tile_geometry` max 216ms, required <150ms |
| repo-wide `tsc --noEmit` | FAIL (known debt) | existing Playwright types, preview navigation types, Turf declaration and prior test types; no matching new error in changed files |
| Route production Editor/Detail source/layer gate | PASS structurally | canonical source present; 1 feature/5 coords; 7 queried rendered features; layers above Fog |
| Route actual Web pixel gate | FAIL/BLOCKED | one diagnostic PASS, repeated identical runs return transparent canvas; final verdict not promoted |
| real hosted Mapbox | BLOCKED | no valid public token in authorized environment |
| RNMapbox iPhone | NOT RUN | native pending; Web is not iPhone evidence |
| Found Detail stable capture | PASS | 2 screenshots, opacity 1, no runtime errors |
| production locale matrix | PASS | 4 device locales × 6 representative surfaces resolve en-NZ |
| Memory freshness | PASS | before test FAIL preserved; post-fix race/503/camera/account scenarios pass |
| iOS production JS export | PASS | 4,253 modules; Hermes bundle 13.7MB; SHA in EVIDENCE |
| native BUILD / TestFlight | NOT RUN | not authorized |
| backend/MySQL | NOT RUN | no backend change; #17 evidence preserved, no production writes |

SKIP 不计入 PASS。没有重跑 `revision03MemoryScale` 取绿，也没有改它的预算或 fixture。

