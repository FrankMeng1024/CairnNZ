# F1/F2 connected normal-entry loaded journey — PASS

Date: 2026-09-20  
Product fingerprint: `fa986cc808e067b98563d9cf72fa6cd885d038d414fafe342d98a9f701b1bff5`
(645 files)  
Verdict: **PASS**, within the fixture-backed Expo Web boundary described below.

This result does not change the independent A4 performance disposition. The
controlling A4 result remains **FAIL/HOLD** at fingerprint `7b495374...` because
the labelled `tile_geometry` slice measured 162 ms against the unchanged
strict `<150 ms` requirement. No latency or responsiveness claim is made here.

## Frozen source and fail sensitivity

The loaded run used the independently reviewed successor bundle:

`/Users/mzm/Desktop/cairn_revision03_work/candidates/f1-f2-web-fallback-fa986cc8-20260920T1728+0800/`

- bundle patch SHA-256:
  `f8250da40a054ed56f5a93097fe39eb849a5e69b3dfbbf1c975fc9c405070942`;
- bundle manifest SHA-256:
  `c61e399533569f1c400db4c43b88a5b976e4d2049309eea80aa9de8eb3eed23b`;
- connected harness SHA-256:
  `b3b43d57ad741079c4976984e31448ff026321df2b31f9342f00a99f5fe0941a`;
- actual Hike/Run Start and Back handler test SHA-256:
  `932fcd2293ab44f5a77ba3227b53e9359be62106b3a3d4170958891b08c8fd14`;
- Running normal-handler test SHA-256:
  `2578a3b3aadd699e75e090ac44809ccb068b97184043ab65131f7c237b547660`;
- Route contract test SHA-256:
  `70705dba552dcfea181df68fd0dd319ba5492b7cad5dba72153a0b01c43a0b2c`.

Independent static review returned `READY_FOR_ONE_LOADED_RUN`. It verified the
fail-sensitive chain from the live navigation Route ID to the exact matching
Route-store object and edited points, including rejection of wrong-navigation
and wrong-geometry mutations. It also verified observed Web fallback/source
truth, strict native missing/wrong-source controls, and idle/null pre-Start
state. The superseded `af82efb7...` bundle remains blocked and is not evidence
for this PASS.

Pre-run verification:

- `node --check scripts/f1-f2-connected-normal-entry-qa.mjs` exited 0;
  receipt
  `/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-web-fallback-navigation-syntax-20260920T1726+0800.log`,
  SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
- `node scripts/f1-f2-connected-normal-entry-qa.mjs --self-test` passed at the
  embedded `fa986cc8...` fingerprint; receipt
  `/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-web-fallback-navigation-self-test-20260920T1726+0800.log`,
  SHA-256
  `73b94eabd5683634087df57dded531d865d23b504b8e04f29eb7313200022927`.
  The self-test rejected wrong geometry, wrong navigation identity, hidden Web
  fallback, fabricated Web source, wrong or missing native source, premature
  Activity Route reference, and recording-before-Start mutations.
- the focused/adjacent Hike, Run, Route, and Quick Cairn command passed 4 suites
  and 44 tests; receipt
  `/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-route-reference-focused-adjacent-7980dfc6-20260920T1717+0800.log`,
  SHA-256
  `02d434dc08e3a7405541dedcf853479bab74b2a21fa605536873792e5408bba0`.
  The component tests press the real Hike and Run Start actions, prove exact
  Route ID and edited-points snapshot/deep immutability before active tracking,
  and prove Back followed by a fresh entry clears selection and leaves the
  Activity Route reference null.

## Environment, ownership, and exact execution

HEAVY_EXCLUSIVE was held by `/root/a4_memory_primary` for this one functional
run. The coordinator preflight found no Cairn-owned Chrome, Playwright, Jest,
Expo, Metro, API, or test runner and found ports 8081–8120 free. Unrelated
personal Chrome (renderer PID 71817 and GPU PID 581), WindowServer, Docker
hyperkit, and Spotlight indexing remained active and were not signalled.
Therefore `machineUncontendedForTiming=false`; the run provides no performance
or timing evidence.

The fail-fast environment receipt is
`/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-fa986cc8-loaded-preflight-20260920T1730+0800.log`,
SHA-256
`5d289313b5696571ed7618fd3e569a9a707a4c49ff76f25517c059b39a086861`.
It recorded `simulatorBuildGate=true`, `tokenPrefixValid=true`, token length 52,
`tokenLengthValid=true`, the exact source fingerprint, and
`machineUncontendedForTiming=false`.

Expo command, from `app/`:

```sh
BROWSER=none CI=1 EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true EXPO_PUBLIC_MAPBOX_TOKEN=pk.cairn_f1f2_isolated_fa986cc8_00000000000000000000 npx expo start --web --port 8087
```

Runner command, from `app/`:

```sh
CAIRN_QA_URL=http://127.0.0.1:8087 CAIRN_F1_F2_QA_DIR=/Users/mzm/Desktop/cairn/CairnNZ/app/_review/f1-f2-connected-normal-entry/20260920T1734-fa986cc8-web-fallback CAIRN_F1_F2_QA_NAMESPACE=f1f2-fa986cc8-20260920t1734-web-fallback CAIRN_F1_F2_QA_USER_ID=9943 CAIRN_F1_F2_QA_BROWSER_PROFILE=/tmp/cairn-f1f2-fa986cc8-20260920t1734-web-fallback-profile node scripts/f1-f2-connected-normal-entry-qa.mjs
```

The fresh browser context used viewport 390x844, locale `en-NZ`, timezone
`Pacific/Auckland`, namespace
`f1f2-fa986cc8-20260920t1734-web-fallback`, synthetic user 9943 / email
`f1f2-fa986cc8-20260920t1734-web-fallback@example.invalid`, and fresh profile
`/tmp/cairn-f1f2-fa986cc8-20260920t1734-web-fallback-profile`.

Result: runner exit 0, **PASS**, `failed:[]`, `terminalError:null`, 16 captures,
trace present. The owned Expo and browser processes were stopped at the
terminal outcome, port 8087 was free, no owned Cairn process remained, and
HEAVY_EXCLUSIVE was released. No retry followed.

## Loaded result

The normal UI/handler flow passed:

Home -> Hike -> normal Start -> realistic R-GPS-02 -> Pause/Resume -> live
Hike Cairn -> full Plant text/private -> same active recording -> live Memory
before Finish -> Finish handler -> same Activity Detail/linked Cairn -> Save as
Route -> real geometry edit/Apply/Save -> cold reload -> Home/Trails reopen
same Route -> edit/Apply/Save -> Use Route -> Hike and Run pre-start idle.

Every manifest assertion was true, including normal start and start/finish
Activity identity, raw-versus-accepted GPS sensitivity, cadence and horizontal
accuracy variance, non-ideal scenario authority, Pause/Resume, Cairn ID/origin/
text/private state, return to the same recording, pre-Finish live Memory,
Final-only Directions scoping, linked Cairn on the same Activity, Route
create/reopen/cold-reload/origin/edit/update identity, Hike/Run selected edited
Route pre-start state, idle/null pre-Start reference, no personal-Memory
contamination, strict API handling, clean runtime, and completed journey.

Stable identities:

- Activity client ID
  `af08fd4c-c1f5-4a6c-afbe-4b62ea7bbc44` at Start and Finish; remote ID 9202;
- Cairn client ID
  `87b0c49b-cea8-4f8f-981d-1cebeeeefa70`; server ID 7301; exact Activity
  origin, personal/private and entered text preserved;
- Route client ID
  `79b607b4-09e2-4f00-9d65-66e286934ecc`; remote ID 6201; exact Activity
  origin;
- created geometry hash
  `f9b5fdf8405ad396b5bfb73c8462b621d0acb427f7c5aa2063bd609f07f53bcf`;
  edited geometry hash
  `64535f3347f5182e7cb242d531d5d5a4fcbc4b9c5769750010169edee57af3ab`;
- normalized edited-points hash used for both navigation-selected Hike and Run
  evidence
  `e081036767ef63f40e92e8f910b4d1d7b3156a3088e7a94037841c39e903ced6`;
- before/after cold-reload Route snapshot hash
  `86c1368504caf4ec4da5caeb6687da116977fcb4d97d18e7841e30c9f4b94ea1`;
  the realm sentinel was set before reload and null after reload;
- one Route update, four Matching calls, and one walking Directions call only
  at `normal-finish-commit`.

R-GPS-02 used seed 550202 from synthetic Wellington origin
`-41.2865,174.7762`, with a gentle bend, turn, pause, backtrack and forward
motion. Before Finish it had 74 raw points, 37 accepted points, 219.953 m,
six distinct cadence gaps spanning 1–8 seconds, and 74 distinct recorded
horizontal accuracies spanning 11.392–17.427 m. After Plant it remained the
same Activity and reached 75 raw/38 accepted points.

The explicitly reopened pre-Finish Memory screen observed the mounted loaded
fog source, not only store count: `mapLoaded=true`, `sourcePresent=true`,
Polygon, one polygon, five inner rings, 10 R-GPS-derived evidence points,
content signature
`9943|qa-raw-gps-isolated|memory-fog-geodesic-v2|10|0|3df1c92f`, and geometry
hash
`79a738a73363773cccc7226d0082e5427a9c202c6672aaa218631fdb3c9183d0`.
This evidence was captured before Finish; Final/Route geometry was never
accepted as Memory evidence.

For each Hike and Run Use Route handoff, the live navigation parameter was the
exact Route client ID above and selected that exact matching store object and
edited-points hash. Tracking was idle, `sessionId:null`, and
`activityRouteReference:null`. This is the approved product contract: Use
selects the authorized/version-bound Route and geometry; the Activity-scoped
reference is captured only by explicit Start. On Expo Web the activity map
showed the exact `Map unavailable` fallback, so
`mapCapability=web_fallback`, `plannedRouteSourceLoaded=false`, and native
mounted Mapbox source is `NOT_RUN`. Native/non-Web source assertions remain
strict in the harness and self-test, but are not claimed as executed here.

Runtime and network evidence was clean: `runtimeErrors:[]`,
`unexpectedExternalRequests:[]`, `unexpectedApiRequests:[]`,
`failedRequests:[]`, and `httpErrors:[]`. Background weather, geocoding,
Mapbox style/events/session, Matching, and the single Final Directions request
used explicit method/path/contract fixtures; unknown API and Mapbox requests
remained failing rather than receiving a generic success response.

## Evidence receipts and limits

Output directory:

`/Users/mzm/Desktop/cairn/CairnNZ/app/_review/f1-f2-connected-normal-entry/20260920T1734-fa986cc8-web-fallback/`

Core SHA-256 receipts:

- manifest `783dc2b6af6253cfdd3d6e1332d2f149299f59633b9620a2bd71eb7510426a22`;
- complete runner log
  `cd1a3138ee9df139cf18c889a05add3b89df46c1b57ed926f38703d3c0fc171f`;
- trace `5cf07db4c1625d781b9b7b62c632f6b1e9f4006fb0b231d87fca3c6470ba9899`;
- requests `d5bf2a02eca69a9c62ca0812b387d3e059db012e50dd552bacde3734e7ab978a`;
- network diagnostics
  `7027d3261b0b821a78be109c342d825f211da5f86c404ce4de3dcea0bccfb0d3`;
- runtime errors
  `fcf33dfbe13c2354bf0e1b063f9fb422747a46cee00b7420bceff2b81457b345`;
- ordered board
  `a850b43939379e6dae711d354ca8eb2a9bcb76459220d1a5a2217cb3945fe9c9`;
- live Memory screenshot
  `7f46475bbb83d5011f5ccdcbac42604ef1320dd8e844fd5b7f11953a9a2c9ec2`;
- Activity Detail/linked Cairn screenshot
  `9176cedcde25108c2c203a1fe36e6363b75e91b498ac98c9c412efb65fe62196`;
- Hike pre-start screenshot
  `4f68a76de2a4183c711a68d75a2f3b9696c46018fea9eb1ee9e0f9c90e45554b`;
- Run pre-start screenshot
  `fda7438f8574b3806b50b47f750b523636d441ad01a029a7c43aa53fa4a246fa`.

This is loaded Expo Web geometry/state/identity evidence with a synthetic
pk-format token and fully intercepted fixture namespace. It does **not** claim
real API/MySQL, real Mapbox, native mounted Mapbox, native/physical GPS, field,
production, latency, or responsiveness proof. It did not change the 30-minute
Memory truth, radius, realistic Raw GPS authority, history/gap behavior, or
live-before-Finish contract.

All earlier terminal FAILs remain FAIL evidence, including the `88c6640e...`
stale pre-Start-reference assertion, the `7980dfc6...` missing-environment
attempt, and the later `7980dfc6...` native-mounted-source assertion against
the correct Expo Web fallback. None is narratively reclassified by this PASS.
