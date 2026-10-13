# Final candidate test results

Final source identity for tests: `d8a715b` with behavior at `aa9b109`.

| Scope | Command / environment | Result |
|---|---|---|
| Route client | targeted Jest: Route feature, store/service, Hike/Run reference, follower and walking adapters | 15 suites, 195/195 PASS |
| Memory/Cairn broad | targeted Jest across Memory/Cairn/Friends/Public and touched screens | initial 311 pass / 7 fail; failures were stale mocks/contracts, not production behavior |
| Failure closure | the two failed suites after fixture correction | 18/18 PASS; combined broad envelope 318/318 |
| Activity | `npm run verify:activity:core` | 625/625 PASS |
| Backend target | Node tests for cadence, Friend projection, moderation, discovery, Route authority/delivery/origin/settings | 75/75 PASS |
| Real local API/MySQL Public | disposable MySQL 8.0.36 + real local API | 21/21 PASS |
| Real local API/MySQL Memory/Cairn | same disposable realm | 24/24 PASS; includes 200 dense candidates and 20/100 Friend overflow |
| Migration 046 | populated legacy Route fixture, delivery persistence/source deletion, rollback | PASS |
| Web runtime B4 | Expo Web 390×844, production screens, simulated public location | 9 screenshots; runtime-errors `none` |
| Web runtime Routes | Expo Web 390×844, production screens | 7 screenshots; first owned/shared hydration and source isolation pass |
| Full app TypeScript | `npx tsc --noEmit --pretty false` | NONZERO: 159 known repository-wide errors; none in overnight Routes/B4 changed files |
| Independent review | focused read-only review after two fix rounds | final ACCEPT; 109 reviewer tests |

## Diagnosed initial failures retained

The Memory/Cairn broad run failed seven assertions in two suites. Six failures
were the legacy Running test store mock omitting the now-existing
`sharedRoutes` array. One expected the old `AllCairns: undefined` navigation
type after the screen gained an optional section/marker filter. The fixtures
were corrected; no production behavior was weakened or retried as a flake.

Earlier Route Web capture attempts also exposed two real integration issues:
first editor hydration could stall, and Plan could recover an Activity-source
draft. Both were fixed before the clean-server final captures. A separate clip
attempt was blocked because Playwright video/ffmpeg tooling is unavailable; no
dependency was installed solely to manufacture a clip.

## Verification limits

No native build, simulator, physical device, live provider request, background
field walk, battery test, deployment or production migration was performed.
The selected results are not a claim that the entire repository suite or every
real-world route is green.

