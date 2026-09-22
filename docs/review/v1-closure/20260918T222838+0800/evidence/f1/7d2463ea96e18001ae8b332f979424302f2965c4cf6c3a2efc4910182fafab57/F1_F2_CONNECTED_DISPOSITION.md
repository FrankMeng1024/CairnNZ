# F1/F2 connected normal-entry disposition

Updated: `2026-09-20T16:31:00+08:00`

## Verdict

**Focused product PASS / current changed-scope PERFORMANCE_DEFERRED_ENVIRONMENT
/ incomplete loaded-Web acceptance at current source fingerprint
`88c6640ed41e54d72eb47a2ee084b5233a10d7956710d38973d1e0967797ef74`
(644 files).** Full Plant and Run Quick Cairn now have a shared synchronous
single-flight boundary, exact initiating owner/Activity/generation capture,
owner-scoped durable-result semantics, generation-scoped late linking, and
stale feedback suppression. Fail-sensitive store, component, and adjacent
tests are GREEN, including the actual normal `RunningScreen` Cairn action.
The required current-fingerprint gate is honestly FAIL: all F2 suites passed,
but the unchanged 10,000-point Memory benchmark recorded one 162 ms
`tile_geometry` slice above the unchanged 150 ms limit. No unchanged retry or
threshold weakening occurred. The immediately preceding `d0a50a33...` broad
gate passed, but it predates the final stale-failure revalidation and is
source-stale for the current fingerprint.

The latest current-fingerprint loaded run is preserved as **FAIL**. It
completed all 16 stages through Route create/edit/save, cold reload, Trails
reopen, and Hike/Run pre-start without auto-start. It exposed that Use Route
does not create the requested `activityRouteReference` until explicit Start;
both pre-start snapshots therefore had a null reference. All other loaded
assertions passed. The current fingerprint and product code remain frozen
pending a contract decision; no rerun is authorized. The earlier
`ed2eeb90...` contended Memory gate remains a historical FAIL and is not
relabelled; the `7b495374...` 162 ms gate remains the controlling A4
FAIL/HOLD.

This is fixture-backed Expo Web evidence. It is not production API, MySQL,
real Mapbox service, native GPS, field, or physical-device evidence.

## Demonstrated product defect and smallest fix

The corrected `db64b441...` loaded attempt reached the ordinary live Hike
`Plant a Cairn` control, then Plant incorrectly opened its standalone GPS
step. The active simulator provider deliberately owns a bounded historical
clock, while `PlantScreen.resolveInitialPlantContext()` compared its accepted
coordinate against wall `Date.now()`. The coordinate was therefore treated
as about twelve hours stale even though it was fresh on the selected
provider's timeline.

Changed product file: `app/src/screens/PlantScreen.tsx`.

- Freshness now uses the existing
  `activityFreshnessNow(tracking.locationProviderSource)` authority.
- The active-state, location-available, coordinate-present, non-negative-age,
  and unchanged 30-second upper bound remain intact.
- Real provider behavior still resolves to wall-clock authority through the
  existing helper.
- Idle/standalone Plant still enters the bounded GPS flow.
- A narrow optional resolver-state seam makes these cases independently
  testable; the normal screen initializer still reads the live tracking
  store.

Changed test: `app/src/screens/__tests__/plantActivityContext.test.ts`.

Final file SHA-256 at this checkpoint:

- `PlantScreen.tsx`:
  `0122393275bd6607fa75be11ba72b9766c158070599b439de3176423d02ef1a2`.
- `plantActivityContext.test.ts`:
  `f8c01d150413b372ee43e81b964f03d2cb043248d8c282991539c295f14ff6b3`.

## Fail-sensitive RED and focused GREEN

RED command, before the provider-clock import/change:

`cd app && npx jest src/screens/__tests__/plantActivityContext.test.ts --runInBand --no-cache`

Result: exit 1, **1/3 passed and 2/3 failed**. The historical simulator case
returned `{ step: 'gps', fromActivity: false }` with null coordinates instead
of Activity content. The real-provider case retained content behavior but
proved the old implementation never called the selected-provider clock.
Standalone fallback passed.

Focused GREEN command after the fix:

`cd app && npx jest src/screens/__tests__/plantActivityContext.test.ts --runInBand --no-cache`

Result: exit 0, **3/3 passed**.

Adjacent command:

`cd app && npx jest src/screens/__tests__/plantActivityContext.test.ts src/features/activitySimulator/__tests__/simulatorTime.test.ts src/features/plant/services/__tests__/noteEncoding.test.ts --runInBand --no-cache`

Result: exit 0, **3/3 suites and 20/20 tests passed**. This covers the real
provider clock, historical simulator clock, standalone Plant fallback, and
Plant title/body encoding.

## Required Activity changed-scope gate

Exact command:

`cd app && npm run verify:changed`

Honest result: **FAIL**, exit 1. Jest reported **116 passed / 9 failed
suites**, **1,145 passed / 25 failed / 3 skipped tests** (1,173 total), in
175.515 seconds, followed by its delayed-exit warning. The new Plant suite,
`simulatorTime`, Activity integration/contracts, R-GPS, Memory presentation,
Memory continuity, and relevant route tests passed within that run.

The nine failing suites were unrelated preserved changed-tree problems:

- three Playwright specs collected by Jest without `@playwright/test`;
- three legacy geo suites importing exports absent from the current
  `src/utils/geo` surface;
- one corridor suite importing an absent `isPolylineInCorridor` export;
- one i18n suite importing an absent `src/config/i18n` module;
- one edit-diagnostic queue expectation receiving `0` where its imported
  maximum was `undefined`.

There is **no persisted runner log or JSON receipt**. The runner printed a
temporary path
`/var/folders/lq/z8p65nfs3c5bxyxyyp9784th0000gn/T/cairn-activity-verify-GQ5uCT/jest.json`,
but it was removed with the temporary directory. This disposition records
the terminal summary without implying a receipt or hash. The failing gate is
not relabelled GREEN and was not retried.

## Loaded attempts retained as FAIL

### Sequencing diagnostic — `c4cda566...`

Output:
`app/_review/f1-f2-connected-normal-entry/20260920T1234-c4cda566/`.

The harness applied R-GPS controls while the Hiking fresh-entry reset was
still in flight. Start configuration was reset before ordinary Start. This
diagnostic is retained unchanged; manifest SHA-256 `93d1eb1b...`, trace
`e9ee07c8...`, requests `20f8d778...`, and network diagnostics
`2beb2ec0...`.

### Product RED — `db64b441...`

Output:
`app/_review/f1-f2-connected-normal-entry/20260920T1238-db64b441-corrected/`.

The run reached ordinary Start, 74 raw / 37 accepted R-GPS samples,
Pause/Resume, and live Plant, then exposed the wall-clock defect above.
Manifest SHA-256 `847e4988...`, trace `d0c1fce1...`, requests `5a9d0807...`,
network diagnostics `9f525168...`, board `c7fe47f9...`.

### Operator-error boot diagnostic — `ad386835...`

An unsupported `--help` invocation executed the harness default URL instead
of printing usage. It terminated immediately at `127.0.0.1:8081` with
`ERR_CONNECTION_REFUSED`, zero captures, and no loaded app. Files are retained
at `app/_review/f1-f2-connected-normal-entry/`; this is not an acceptance
attempt or product signal.

### First post-product-fix run — `ad386835...`

Output:
`app/_review/f1-f2-connected-normal-entry/20260920T125821-ad386835-provider-clock/`.

The run proved the Plant fix through ordinary UI handlers: Home to Hike,
ordinary Start, realistic R-GPS, Pause/Resume, live Plant text/private,
commit, and return to the same recording. It then correctly rejected an
unallowlisted expected Memory background request and timed out with the Web
map unavailable because Expo had no Mapbox token configured.

- Activity client ID:
  `107528a1-d42d-420f-9b38-3daefc07ac76`.
- Cairn client ID:
  `30bcf264-51e6-4122-b6f0-15e9b5257a36`; origin Activity matched.
- 74 raw / 37 accepted; 219.911 m; horizontal accuracy 11.386–17.427 m.
- Unexpected exact request:
  `POST /api/friend-content/encounters/verify`, fixture fallback 501.
- Backend/source audit established the correct 200 body as
  `{ "encountered_marker_ids": [] }`; `loadCircleMarkers()` intentionally
  continues to `GET /api/circle/markers` after this best-effort POST.
- Trace DOM showed explicit `Map unavailable`. The Web adapter requires a
  pk-format token of at least 40 characters; no Mapbox style request occurred.
  This was independent of the API 501.

Artifact SHA-256:

- manifest `fb50e5f8c4ccb6da039b73c5dd5b6cc262a119b84f02445b1994d3360d7bd832`;
- trace `d4b622fe6fe90670fb2a1dc7dbcff981857ad54deb0c2af03a6174516a5e70be`;
- requests `e1c54cf7beb3ae7c6948b2d14cd2c825338be27dd11a849f0d7074cc2d7715b8`;
- network diagnostics `533fc7d518d5906e4c9d54aab7e117e14f269482464264cf97c414c6e123a426`;
- ordered board `282040a33e4430e8068c47206c7b089c80cb7a7b51a935837e520c02483980b7d`.

### Loaded pre-Finish Memory evidence — `6675b2b0...`

Output:
`app/_review/f1-f2-connected-normal-entry/20260920T130733-6675b2b0-isolated-map/`.

This run used fixture user `9922`, namespace
`f1f2-6675b2b0-20260920t130733`, a fresh persistent browser profile, mobile
390×844 viewport, `en-NZ`, and `Pacific/Auckland`. A synthetic pk-format
token enabled only the Web adapter; all Mapbox requests remained intercepted.

Observed through ordinary handlers before terminal failure:

- Home → Hike → ordinary Start;
- O55 R-GPS-02, seed 550202, NZ synthetic origin, bend/turn, eight-second
  physical pause, backtrack, and forward recovery;
- 74 raw / 37 accepted, 219.970 m, horizontal accuracy 11.394–17.427 m;
- Pause/Resume;
- live Hike Plant control → text/private Plant → commit → same recording;
- Activity client ID `8f371209-883a-44ab-813e-a0e6fe5b169b`;
- Cairn client ID `57aa6d23-ebe9-4c2a-a04b-1a6aea532503`, with matching
  origin Activity and personal/synced state;
- explicit live-before-Finish Memory visit while tracking remained active;
- actual `memory-fog-src` Polygon, five inner rings, ten evidence points,
  content signature containing `|qa-raw-gps-isolated|`, geometry SHA-256
  `833fda2168c0bdfb5bace6ec7c4f4107b8562912c7821d6dfbf5911eb4ffd9ed`.

The run then returned to the same Hike and failed before Finish because the
snapshot inspected an already unmounted/destroyed debug Mapbox object. The
strict Mapbox fallback also exposed expected SDK
`GET api.mapbox.com/map-sessions/v1` and returned 501. `runtimeClean` was
therefore false. No Finish, Activity Detail, Route creation/edit/reopen,
cold-reload, Use Route, or Hike/Run idle claim is made.

Artifact SHA-256:

- manifest `e8a574e7a37bec40721cbaa9bf09445a78165538875e8634a69b39b88ef67158`;
- trace `75db9d24229fbff183615a31e941dafeba6d2987948b2ba872bd887015450700`;
- requests `a5a662f0182a3bc5c061bd91a2fbecfc031fafc41a935837e520c02483980b7d`;
- network diagnostics `3229d0ad74513dd2b4b861b26108e5239662dfdc3068ac2659a4bdc1eba7e5f6`;
- runtime errors `91fcf9e062d904b3ace1bc3918e068c789edfba4c37c3cbea0aa1c232c967e52`;
- ordered board `03f2c3850bb46009e9fe7fe86dcdb16a65eadabf70848447a8bd98d5e0ad67ef`;
- live Memory screenshot `4d5b0584c5683faa13e907ff3c7f6ec98d399792933ccd05749fdcebbb4004aa`.

### Frozen-source connected run — `7d2463ea...`

Exact command environment and command:

`BROWSER=none CI=1 EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true EXPO_PUBLIC_MAPBOX_TOKEN=pk.cairn_f1f2_isolated_7d2463ea_00000000000000000000 npx expo start --web --port 8087`

`CAIRN_QA_URL=http://127.0.0.1:8087 CAIRN_F1_F2_QA_DIR=/Users/mzm/Desktop/cairn/CairnNZ/app/_review/f1-f2-connected-normal-entry/20260920T131907-7d2463ea-final CAIRN_F1_F2_QA_NAMESPACE=f1f2-7d2463ea-20260920t131907 CAIRN_F1_F2_QA_USER_ID=9923 CAIRN_F1_F2_QA_BROWSER_PROFILE=/tmp/cairn-f1f2-7d2463ea-20260920t131907-profile node scripts/f1-f2-connected-normal-entry-qa.mjs`

The heavy-exclusive token was held only for this attempt. The pre-run audit
found no closure Expo/Metro/Jest/QA process and port 8087 was free. Ambient
personal Chrome PID 571 and retained MySQL containers on ports 3310/3306 were
left untouched. The run used a fresh profile, output, fixture namespace, and
numeric fixture user. It was uncontended by another closure workload. Expo
was stopped afterward; the post-run audit found no owned process and port
8087 free.

Output:
`app/_review/f1-f2-connected-normal-entry/20260920T131907-7d2463ea-final/`.

Terminal result: **FAIL**, exit 1, seven captures. The run repeated the
ordinary connected path through live-before-Finish Memory, returned to the
same Hike, invoked the normal Finish confirmation and commit handlers, and
saved Activity client ID
`4d6660fd-e65e-4d15-9098-1d4c90e3dbc7` as remote session 9202. Cairn client
ID `67999571-3ec8-418e-8088-09dfc8c9641a` remained synced/personal with that
same `originActivityClientId`. The loaded post-Finish snapshot was on
`MapHistory`, with the Activity and Cairn both present in their stores, but
the UI timed out waiting for the matching linked-Cairn card.

Static diagnosis is exact: full `PlantScreen` constructed the marker with
`regionCode: ''`; `MapHistoryScreen` filtered markers to
`m.regionCode === getCurrentRegion().code` (`nz`) before calling
`linkedCairnsForActivity`. Explicit provenance was correct, but the blank
region removed the Cairn from Activity Detail presentation.

`runtimeClean` also failed honestly. Finish reconstruction made two expected
fixture-backed Mapbox Matching calls and then the existing
`walkingDirectionsCandidate` made an exact
`GET api.mapbox.com/directions/v5/mapbox/walking/{two coordinates}` request
with `alternatives=true`, `geometries=geojson`, `overview=full`, and
`steps=true`. The generic strict fallback returned 501 because this expected
Final-geometry request did not yet have an exact fixture. It was not hidden
or confused with Memory geometry.

Artifact SHA-256:

- manifest `9854136d6d1b3aa0371a48bccd6eda890e1666ebddef400d32fc29d7c819dbd3`;
- trace `918b78a456e3c52750aa22a53d108f2889994a448f0ea34ec0e40f0d93625014`;
- requests `aac38837bf95777935a3812970d08e132225912361005b55feef5ae7f01d4e53`;
- network diagnostics `485d55256355b7b7d1bc7d71a912389e7ecee7b166d6c07c637e3d4d4de85148`;
- runtime errors `986a6ad83efbb6fe45dd57f37df71a3c902734d8efa118bb7d6c83340a1ad350`;
- ordered board `4285a584515c55e8a31e403350f3464424deec329f51bedcc0aaf24729a500b9`;
- live Memory screenshot `7c811ada10ac54f5352a91f7fe7b13fa9a6bb39009a1b060bb9208d2af64a94e`.

No Route creation/edit/reopen, cold reload, Use Route, or Hike/Run idle claim
is made from this FAIL.

## Demonstrated 7d corrections — `e2a6eeba...`

Full Plant now uses the existing `getCurrentRegion().code` authority when
constructing its marker. The Activity-selected coordinate, timestamp/source
authority, type, note, and permission are unchanged. Running Quick Cairn
already used the same canonical region and retains `type: 'cairn'` plus
`permission: 'personal'`. Standalone Plant retains its bounded GPS entry.

Fail-sensitive product RED command:

`cd app && npx jest src/screens/__tests__/plantActivityLinkage.test.tsx --runInBand --no-cache`

Result before the fix: exit 1, **0/2 tests passed**. Both NZ and a mocked
future `test-south` canonical region received `regionCode: ''` despite an
exactly matching `originActivityClientId`, excluding the Cairn from the
Activity Detail input.

The same command after the fix: exit 0, **2/2 passed**. The test drives the
real full-Plant submit handler and then applies the current-region filter plus
explicit Activity linkage.

The harness now has a strict walking-Directions resolver. Its pre-fix static
self-test failed exactly with
`expected_mapbox_directions_fixture_missing_or_wrong`. After the fix, only
GET, `api.mapbox.com`, walking profile, two finite coordinates, and the exact
known query key/value shape resolve to a deterministic contract-correct
`{ code: 'Ok', routes: [...] }` body. Wrong method, profile, or incomplete
query and every generic unknown Mapbox request remain rejected. Directions
calls are counted and must occur only at `normal-finish-commit`; the
live-before-Finish Memory assertion still requires the R-GPS-specific content
signature and never consumes Final geometry.

Static GREEN command:

`cd app && node --check scripts/f1-f2-connected-normal-entry-qa.mjs && CAIRN_F1_F2_QA_SELF_TEST=1 node scripts/f1-f2-connected-normal-entry-qa.mjs`

Result: syntax PASS and self-test PASS.

Adjacent GREEN command:

`cd app && npx jest src/screens/__tests__/plantActivityLinkage.test.tsx src/screens/__tests__/plantActivityContext.test.ts src/features/activity/__tests__/activityDetailPresentation.test.ts src/features/cairns/__tests__/cairnPersonalContracts.test.ts src/store/__tests__/useMarkerStore.fastAck.test.ts src/features/plant/services/__tests__/noteEncoding.test.ts src/features/activitySimulator/__tests__/simulatorTime.test.ts --runInBand --no-cache`

Result: exit 0, **7/7 suites and 45/45 tests passed**.

Required changed-scope command:

`cd app && npm run verify:changed`

Honest result: **FAIL**, exit 1, **117 passed / 9 failed suites**, **1,147
passed / 25 failed / 3 skipped tests** (1,175 total), 229.516 seconds, plus
the delayed-exit warning. The new Plant linkage suite passed inside this run.
The nine failure categories were unchanged: three Playwright specs collected
without `@playwright/test`, three legacy geo suites importing absent exports,
one absent corridor export, one absent i18n module, and one edit-diagnostic
queue expectation whose imported maximum was undefined. Memory scale passed;
the 10,000-point maximum synchronous slice was 144 ms, below 150 ms. The
printed temporary JSON path
`/var/folders/lq/z8p65nfs3c5bxyxyyp9784th0000gn/T/cairn-activity-verify-IxnYNQ/jest.json`
was removed with the temporary directory and has no receipt/hash. The command
was not retried.

Checkpoint fingerprint:
`e2a6eeba0548fb37511f5727f91f3ea877a2c2e36ace14a71583ae8f01e5d169`
(640 files).

- `PlantScreen.tsx` SHA-256
  `6542f1cd149dd69929b19e398fd78fb7f50723f997a1008fa3a01a8977074776`;
- `plantActivityLinkage.test.tsx` SHA-256
  `f93c85b296128c9c6b0fc4cfedc156581469a5b24b17388be9a2385f4420466b`;
- harness SHA-256
  `51e79c238dfc2bb3c09c7792a77d500288a986747d30e6646b1b9af417d909c2`.

No post-correction loaded run is claimed.

## Changed-scope test-ownership integration — `ed2eeb90...`

Integrated package:
`/Users/mzm/Desktop/cairn_revision03_work/candidates/verify-changed-nine-audit-20260920T130639+0800/`.

- `PACKAGE.sha256` matched the authorized
  `c0da6b106bed4409eecf32b7a0d71336f0c03a72785a8bdb9565c723e1ca178f`.
- Patch SHA-256 matched
  `a96412d59dd33a013bf56b8834091f7fad85c1891857e567c0cb1571e8f9548a`.
- Every listed target preimage matched the current primary tree and
  `git apply --check` passed before integration.
- The integrated postimage hashes match the proposal manifest exactly.

The patch changes test ownership/stale contracts only. Jest excludes the
browser-owned `app/tests/` tree. Obsolete assertions for removed geo,
corridor, and i18n APIs were removed rather than reintroducing dead runtime
surfaces. The edit-diagnostic overflow test now enqueues 55 events and asserts
the existing 50-event production cap without importing a private constant.
No runtime source, dependency, lockfile, browser suite, or product contract
was changed by this package.

Changed/deleted files:

- `app/package.json`;
- `app/src/utils/__tests__/geo-kalman.test.ts`;
- `app/src/utils/__tests__/geo-dynamic-sampling.test.ts`;
- deleted `app/src/utils/__tests__/geo-route.test.ts`;
- `app/src/services/routing/corridor/__tests__/CorridorQuery.test.ts`;
- deleted `app/__tests__/i18n.test.ts`;
- `app/src/services/__tests__/editDiagSender.test.ts`.

The requested queue-only coordination change appended F8 as low-priority
Phase 1 external read-only inventory in progress, explicitly non-preempting
F0-F7 and permitting no delete, move, or DB mutation. No other queue item
state changed.

Focused command:

`cd app && npx jest src/utils/__tests__/geo-kalman.test.ts src/utils/__tests__/geo-dynamic-sampling.test.ts src/services/routing/corridor/__tests__/CorridorQuery.test.ts src/services/__tests__/editDiagSender.test.ts src/services/routeFollowing/__tests__/RouteFollower.test.ts --runInBand --no-cache`

Result: exit 0, **5/5 suites and 69/69 tests passed**.

Ownership check:

`cd app && test_list=$(npx jest --listTests); if printf '%s\n' "$test_list" | rg '/app/tests/' >/dev/null; then printf 'BROWSER_TESTS_STILL_COLLECTED\n'; exit 1; else printf 'JEST_BROWSER_OWNERSHIP_EXCLUDED\n'; fi; printf '%s\n' "$test_list" | wc -l`

Result: exit 0, `JEST_BROWSER_OWNERSHIP_EXCLUDED`, 121 Jest-owned files.

Required heavy-exclusive changed-scope command, with complete output
persisted:

`cd app && set -o pipefail; npm run verify:changed 2>&1 | tee /Users/mzm/Desktop/cairn_revision03_work/evidence/verify-changed-ed2eeb90-test-ownership-20260920T134232+0800.log`

Result: **FAIL**, exit 1; **120 passed / 1 failed suites**, **1,146 passed /
2 failed / 3 skipped tests** (1,151 total), 300.763 seconds plus the delayed-
exit warning. The prior nine failure categories are eliminated. The sole
failure is the unchanged `revision03MemoryScale.test.ts` budget:

- 2,001-point case: maximum synchronous slice 165 ms, above 150 ms;
- 10,000-point case: maximum synchronous slice 205 ms, above 150 ms;
- slowest recorded 10,000-point `tile_geometry` slices: 205, 181, 156, then
  138 ms;
- cold total 15,479.1 ms; 2,001 incremental geometry 270.9 ms; 10,000 total
  74,354.3 ms.

The pre-run audit found no competing closure verify/Jest/Expo/QA process and
port 8087 was free, but ambient personal Chrome renderer PID 17677 sampled at
32.6% CPU. It was retained and untouched. The result is therefore recorded
as contended **FAIL**, not excused, weakened, or retried. No truth-loss
assertion was reported as failing.

Persisted runner log SHA-256:
`455a4427363df2a2d91888a2d919593af0da36659f44422765a3f21209ea94d5`.
The runner's temporary JSON was removed and is not claimed as a receipt.

Current fingerprint:
`ed2eeb90c7c247fc2a1561ceaf7824bd047d1350a3e2a258d88742b3195f8e4b`
(639 files). No loaded run is authorized or claimed at this fingerprint.

## F2 single-flight and owner/Activity boundary — `7b495374...`

The prepared initial single-flight proposal at
`/Users/mzm/Desktop/cairn_revision03_work/candidates/f2-personal-cairn-audit-20260920T124615+0800/`
was audited against the already-corrected Plant provider-clock and canonical-
region code. Authorized patch SHA-256
`43a763c2acea980e62849be49d6c31ae99be000d090f3dc7b1cdee307cbbc516`
matched. Its synchronous ref locks were rebased without overwriting those
earlier corrections. The initial source-contract RED was 0/2, followed by
focused GREEN and an uncontended current-source Activity FULL PASS at
`ad68c2cc7db37e5b987b6ff2c4066c0261c274c6bce5057743324df521995836`
(640 files): client 1151/1154, server 65/65, static 86/86, total 1302/1305.
The persisted log was
`/Users/mzm/Desktop/cairn_revision03_work/evidence/verify-changed-ad68c2cc-f2-single-flight-20260920T135601+0800.log`,
SHA-256
`6071d5a0a80e09bed34c09e6440e6e62252157e4818dfa468a6e3579e32b6870`.

Independent static review then found that a button-only lock was insufficient:

- `useMarkerStore.addMarker()` threw `marker_owner_changed_after_commit`
  after the A-owned outbox write was already durable, causing full Plant to
  present a retryable failure and retain a duplicate-mint draft;
- `addMarker()` replaced explicit provenance with whichever Activity happened
  to be current before its await;
- full Plant retained only a boolean `fromActivity`, not the opening Activity
  owner/client ID/generation;
- Run's late `linkMarker(marker.id)` appended into the current tracking store
  without owner/session/generation scope;
- post-commit navigation/unmount/account changes could produce stale feedback
  or unlock a duplicate retry.

The loaded journey was held. Fail-sensitive RED command before the boundary
fix:

`cd app && npx jest src/features/cairns/__tests__/cairnCommitBoundary.test.ts src/store/__tests__/useMarkerStore.fastAck.test.ts src/screens/__tests__/plantActivityLinkage.test.tsx --runInBand --no-cache`

Result: exit 1, **3/3 suites failed, 13/20 tests passed and 7/20 failed**.
The failures showed the post-durable owner-change throw, S1 provenance being
replaced by S2, standalone creation inheriting an unrelated Activity, stale
Plant navigation/feedback, duplicate retry after navigation failure, and the
absent shared transaction boundary.

Smallest product correction:

- `MarkerCreateResult` is now a typed `durably-accepted` result. Once
  `offlineMarkers.saveLocal(payload, ownerId)` succeeds, `addMarker()` never
  converts later projection/account state into a pre-commit exception.
  `projection` truthfully reports `current`, `owner-changed`, or
  `projection-failed`; another account never receives the old owner's row.
- `CairnActivityContext` carries exact initiating `ownerUserId`, Activity
  client ID, and owner generation. The marker store validates that context
  before persistence, writes that exact Activity ID into the outbox, and does
  not infer provenance for standalone creates. S1 remains S1 if S2 starts
  while persistence awaits.
- `linkMarker(markerId, activityContext)` returns false unless the same live
  owner, Activity client ID, and generation are still current. It is also
  idempotent for an already-linked marker.
- `cairnCommitBoundary.ts` separates pre-commit rejection from durable
  acceptance and later UI/navigation effects. It synchronously coalesces
  same-tick actions. A true pre-commit failure releases the exact attempt for
  retry; stale durable completion cannot publish feedback or release an old
  lock into a new context.
- full Plant captures the opening Activity identity with the fresh accepted
  coordinate. It revalidates before commit, clears the initiating owner's
  retry draft after durable acceptance even if the visible owner changed,
  and permits navigation/alerts only while that exact context is current.
  Post-commit navigation failure is logged, never presented as a retryable
  Cairn failure, and the full-Plant lock remains terminal.
- Run captures owner/Activity/generation and the canonically accepted fix at
  the actual press. Quick Cairn remains `type: 'cairn'`, empty note,
  `permission: 'personal'`, and canonical current region. Context changes
  supersede only the old UI gate; its late completion cannot link, toast, or
  release a newer attempt.

The actual `RunningScreen` action is exercised, not merely source-scanned.
`runningQuickCairnHandler.test.tsx` invokes the `ActivityControlDock` Cairn
handler twice in one render turn, observes the real disabled/busy prop while
the local write is deferred, and proves one `addMarker` call. It also drives
S1→S2, A→B, true-failure retry, exact late link, stale-toast suppression, and
unmount-before-resolution. The separate store tests prove durable A
acceptance remains in A's outbox while B's projection is untouched and that
S1 provenance survives an awaited write.

Final focused/adjacent command:

`cd app && npx jest src/screens/__tests__/runningQuickCairnHandler.test.tsx src/features/activity/__tests__/freeActivityIntegrationContracts.test.ts src/features/cairns/__tests__/cairnCommitBoundary.test.ts src/store/__tests__/useMarkerStore.fastAck.test.ts ../app/__tests__/useTrackingStore.test.ts src/screens/__tests__/cairnCommitSingleFlight.test.ts src/screens/__tests__/plantActivityLinkage.test.tsx src/screens/__tests__/plantActivityContext.test.ts src/screens/__tests__/activityRecordingUiContracts.test.ts src/features/cairns/__tests__/cairnPersonalContracts.test.ts src/features/cairns/__tests__/cairnIdentity.test.ts src/features/activity/__tests__/activityDetailPresentation.test.ts src/features/plant/services/__tests__/noteEncoding.test.ts src/features/activitySimulator/__tests__/simulatorTime.test.ts src/features/activitySimulator/__tests__/simulatorContracts.test.ts --runInBand --no-cache`

Result: exit 0, **15/15 suites and 223/223 tests passed**. The adjacent
`freeActivityIntegrationContracts` source contract was also repaired to
require the current `saveLocal(payload, ownerId)` and
`storageKey(ownerId)` literals with explicit positive index and ordering
assertions. The Simulator contract now checks the captured
`trackingAtPress.locationProviderSource`, not a stale closure variable.

An exploratory `npx tsc --noEmit` remained a pre-existing broad FAIL across
missing Playwright types, generated preview icon keys, and old fixture types.
Filtering that output to the files changed here returned no diagnostics; it
is not claimed as a TypeScript PASS.

Changed-scope history is preserved honestly:

- fingerprint `47b6f2fe...`: **FAIL** only because the Simulator source-string
  contract still expected the old variable name. Log
  `/Users/mzm/Desktop/cairn_revision03_work/evidence/verify-changed-47b6f2fe-f2-owner-activity-boundary-20260920T143218+0800.log`,
  SHA-256
  `f3bdf258b6b48a7ca9342b48b3c1a3bedd7479489c4139f513c403b34ccafb18`;
- fingerprint `1d44624f...`: intermediate **PASS**, client 1164/1167,
  server 65/65, static 89/89, total 1318/1321. Log
  `/Users/mzm/Desktop/cairn_revision03_work/evidence/verify-changed-1d44624f-f2-owner-activity-boundary-20260920T143850+0800.log`,
  SHA-256
  `3d4aec736c195d102a145ee5faebfd46865da5bf23fdddb271268ef2f660689b`;
- current fingerprint
  `d0a50a337574f8046e04460083ff3a54b0e995fe2cc0eb18265e603109c7fc77`
  (643 files): Activity FULL **PASS**, client 1169/1172, server 65/65,
  static 90/90, total 1324/1327. Exact command:
  `cd app && set -o pipefail; npm run verify:changed 2>&1 | tee /Users/mzm/Desktop/cairn_revision03_work/evidence/verify-changed-d0a50a33-f2-owner-activity-boundary-20260920T144745+0800.log`.
  Log SHA-256
  `f388b35ce79b2852feaec3bd18c25da6c407b597156c166b5e845f9480282041`.

Current key SHA-256 identities:

- `PlantScreen.tsx` `645c93eb2cf1b888418041ffdaace0e0f3e8f4065f790d35da09c9daa6d34a53`;
- `RunningScreen.tsx` `f57dbdabc749b902edfad7431ea5d1f85bd67f0aa6110d0217192fc3505839c5`;
- `useMarkerStore.ts` `0f1844e03e3012ea73a980d7a82408c92efa8d8165cdc927b8be323175f9f30d`;
- `useTrackingStore.ts` `f4e3bbc4ac5b8c407fd183c8aaa67330ff7826ef31ae9e56223e90c490b88db7`;
- `cairnCommitBoundary.ts` `a6bed11e73744f4b608ea58c511fa4831b8a02b6adfde5bf07e2f190e8fb93c8`;
- real Run component test `5505161630825beb65a771c74a3b2e92b0efe424a445cd9bcbe0d97092da4e91`;
- marker-store boundary test `700164765b5a2b8581ae0c81f7a4a5f5aff65eabccfbbeef5182d52ac3f42307`;
- Plant linkage/ownership test `bfe7bfd4d828669d694d487cbaf820b1c82f31e038a56b177f6d4d381b135642`;
- loaded harness remains
  `51e79c238dfc2bb3c09c7792a77d500288a986747d30e6646b1b9af417d909c2`.

The current broad gate was HEAVY_EXCLUSIVE. Pre-run audits found no closure
Jest/verify/Expo/Playwright/DB workload and port 8087 free. No browser, API,
MySQL, performance run, deploy, OTA, marker/version, or supervision hook was
used. Post-run audits found no owned process and port 8087 free; the token was
released at `2026-09-20T14:52:09+08:00`. Current source is frozen pending
independent exact-hash review before any loaded run.

## Independent exact-hash review

Read-only review returned **NO_NEW_BLOCKER / static only / NOT_RUN** for
`PlantScreen.tsx` SHA `6542f1cd...`, linkage test SHA `f93c85b2...`, and
harness SHA `51e79c23...`. It confirmed canonical-region/future-region
sensitivity, strict Directions method/host/profile/two-coordinate/query
checks, the generic 501 fallback, and separation between Final geometry and
the explicit pre-Finish R-GPS Memory signature. A nonblocking limitation is
that any valid two-coordinate pair is accepted rather than asserting the
exact observed anchor pair; no exact-anchor provenance acceptance claim is
made.

## Pre-correction frozen harness checkpoint

Changed harness:
`app/scripts/f1-f2-connected-normal-entry-qa.mjs`, SHA-256
`79fd1aa761a773f5ae623c56012c49edd46cf084a091c81933fe3f07a6defbdf`.

Exact static command:

`cd app && node --check scripts/f1-f2-connected-normal-entry-qa.mjs && CAIRN_F1_F2_QA_SELF_TEST=1 node scripts/f1-f2-connected-normal-entry-qa.mjs`

Result: syntax PASS and self-test PASS at `7d2463ea...`. Sensitivity proves:

- a straight-line substitute is rejected;
- perturbed geometry changes the hash;
- exact encounter POST resolves to `{ encountered_marker_ids: [] }`;
- wrong encounter method and unknown API endpoint are rejected;
- exact `GET api.mapbox.com/map-sessions/v1` resolves only to 204;
- wrong Mapbox method and unknown telemetry path are rejected;
- a destroyed debug map is classified unavailable without throwing;
- a non-Memory snapshot does not touch or claim the debug map.

The preceding loaded network capture contained only weather, reverse
geocoding, Mapbox style, Mapbox events, and Mapbox session endpoint classes.
No other deterministic SDK endpoint was observed. Generic API and Mapbox
fallbacks remain failing.

## Current-fingerprint connected loaded run — terminal FAIL

Frozen product fingerprint:
`7b495374e3b2362444aaf9e6f082c10376c4101310317277b71923856822a823`
(643 files). Harness SHA-256:
`51e79c238dfc2bb3c09c7792a77d500288a986747d30e6646b1b9af417d909c2`.
No product or harness source changed during this run.

Static preflight:

`cd app && node --check scripts/f1-f2-connected-normal-entry-qa.mjs`

Result: exit 0.

`cd app && CAIRN_F1_F2_QA_SELF_TEST=1 node scripts/f1-f2-connected-normal-entry-qa.mjs`

Result: exit 0, syntax/self-test PASS at the exact 7b fingerprint. Persisted
log:
`/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-self-test-7b495374-20260920T1600+0800.log`,
SHA-256
`82a6ceca2a004b7f279abd7258d5e27e574792e85b8b140e2f65045e1473e7f1`.
The self-test rejected straight-line and perturbed R-GPS substitutions,
proved strict known/unknown API and Mapbox endpoint handling, the exact
walking Directions contract, and safe destroyed/non-Memory map lifecycle
handling.

The pre-run audit at `2026-09-20T16:01:11+08:00` found no Jest, Expo,
Playwright, closure API, or database workload; ports 8087, 8108, and 8109
were free and 87.4 GiB disk was available. Residual Chrome GPU/renderer
samples were low (about 2.2% and 4.3% CPU). The run exclusively held the
HEAVY_EXCLUSIVE token. Namespace:
`f1f2-7b495374-20260920t160111`; fixture user `9924`; fresh profile:
`/tmp/cairn-f1f2-7b495374-20260920t160111-profile`; output:
`app/_review/f1-f2-connected-normal-entry/20260920T160111-7b495374-final/`.

Expo command:

`BROWSER=none CI=1 EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true EXPO_PUBLIC_MAPBOX_TOKEN=pk.cairn_f1f2_isolated_7b495374_00000000000000000000 npx expo start --web --port 8087`

Harness command:

`CAIRN_QA_URL=http://127.0.0.1:8087 CAIRN_F1_F2_QA_DIR=/Users/mzm/Desktop/cairn/CairnNZ/app/_review/f1-f2-connected-normal-entry/20260920T160111-7b495374-final CAIRN_F1_F2_QA_NAMESPACE=f1f2-7b495374-20260920t160111 CAIRN_F1_F2_QA_USER_ID=9924 CAIRN_F1_F2_QA_BROWSER_PROFILE=/tmp/cairn-f1f2-7b495374-20260920t160111-profile node scripts/f1-f2-connected-normal-entry-qa.mjs`

Result: exit 1, terminal **FAIL** at `save-as-route` with only
`loadedJourneyCompleted=false`. `runtimeClean=true` and
`noUnexpectedApiRequests=true`; runtime errors, unexpected external/API
requests, failed requests, and HTTP errors were all empty. The owned Expo
process was stopped after the terminal result. The `16:05:12+08:00`
post-run audit found no namespace/profile/Expo/harness process and port 8087
free; HEAVY_EXCLUSIVE was released.

Strong partial loaded evidence, through actual UI handlers and navigation:

- Home -> Hike pre-start -> normal Start -> O55 R-GPS-02 bend/turn/pause/
  backtrack/forward -> Pause/Resume -> live Hike Plant -> text/private commit
  -> same recording -> live Memory before Finish -> Finish confirmation ->
  same Activity Detail and linked Cairn.
- R-GPS authority seed 550202 at `-41.2865,174.7762`, 4.68 km/h, eight
  physical-pause seconds, 75 raw and 38 accepted observations immediately
  before Finish, 219.97301977933753 m, variable horizontal accuracy
  11.394596618137193–17.42693723795842 m.
- Activity client ID
  `230925bf-742c-4e4c-9be4-73f203094e27` remained exact from normal Start
  through server save and Activity Detail; remote ID 9202 and 25 final track
  points.
- Cairn client ID `665103e9-eb56-485e-975f-699830777e88`, server ID 7301,
  personal/private permission, synced, with origin Activity client ID exactly
  matching the Activity above.
- The mounted pre-Finish Memory source contained 10 R-GPS evidence points,
  a Polygon with five inner rings, content signature
  `9924|qa-raw-gps-isolated|memory-fog-geodesic-v2|10|0|dff717c5`, and
  geometry SHA-256
  `c35caf9be8c62df9950544377957c727b5ab80200889f15c9e80194cef144a38`.
  This observation occurred while the same Activity remained `tracking`.
- API identity also matched the Activity and Cairn client IDs. Three exact
  fixture Matching calls occurred; one exact walking Directions call occurred
  only at `normal-finish-commit`, after the pre-Finish Memory capture.

The single failure is diagnosed as a harness DOM-readiness false-negative,
not a demonstrated product defect. Trace sequence:

1. `Beautify` was visible, enabled, and clicked.
2. The exact Mapbox Matching fixture returned HTTP 200 with 25 input and 25
   output points; edit telemetry then emitted `brush_preview_completed` with
   `anyMatched:true`.
3. `Apply to draft` was visible. Its actionable React Native Web ancestor was
   a `DIV` with `tabindex="0"`, no `role`, no `button` tag, and no
   `aria-disabled` attribute.
4. Harness line 940 nevertheless required the ancestor to match
   `[role="button"],button,[aria-disabled]`, so its predicate remained false
   until the unchanged 30-second timeout. The trace shows the control styled
   as the enabled primary CTA, while product state had already completed the
   beautification.

No correction or rerun was made. A future run requires an authorized,
fail-sensitive harness-only readiness fix that uses the actual Playwright
actionability/control shape (and continues to reject a truly disabled
control). It must retain the strict generic API/Mapbox failures and all
identity/Memory checks.

Core artifact SHA-256:

- manifest `aa270dd80193dd8081951d238609595d5792da9725c7735b941b98b3aef76b1d`;
- runner log `9f67c1afd95edf987f807ff916b68b2b82674826e80dae55783955166e1b7032`;
- trace `d71c94bad9d30310192afb167a819968003d20a4b891100f673c9604b1827a19`;
- requests `47df23a1a6fc69e2ae0692b42395d838d2955d1b94d188cf09d67389964810a9`;
- network diagnostics `78fe13b460f89db9be4cb96686641e10f65ef7cfc99806386790fcddf8e57522`;
- runtime errors `fcf33dfbe13c2354bf0e1b063f9fb422747a46cee00b7420bceff2b81457b345`;
- ordered board `b0e48885ac388a209e9079d99b0196688d151fdeb2c4f4299d4fc2192cfcdec4`;
- live-Memory capture `46a60dd84e9aa1ca22c2078619f9f039844b8f9daeafa1fa3734aa8046e101e3`;
- Activity Detail/linked-Cairn capture
  `97f3b0d8d7046640f5399a5c3c0a82a1ff929d253247c556370f1ce79b614325`.

Evidence boundary: loaded Expo Web at 390x844, `en-NZ`,
`Pacific/Auckland`, with fixture APIs and fully intercepted synthetic Mapbox
responses. It is geometry/loaded-Web evidence, not real API/MySQL, real
Mapbox, native GPS, field, or physical-device evidence. Route client/remote
IDs, edited geometry, reload stability, `activityRouteReference`, and Hike/
Run Use-Route idle behavior remain unobserved and are not claimed.

## RouteEditor Apply accessibility correction — `88c6640e...`

The preserved 7b trace proved a product-owner accessibility defect rather
than a safe harness selector correction. `EditOverlayV274` rendered its
primary Apply CTA as a raw React Native Web `DIV tabindex="0"` with no
button role, accessible name, stable test ID, or explicit busy state. The
harness was correct not to accept arbitrary tabindex as proof of a button.
`RouteEditorScreen` is the only product caller.

Fail-sensitive RED command:

`cd app && npx jest src/components/map/__tests__/EditOverlayV274.accessibility.test.tsx --runInBand --no-cache`

Result: exit 1, **0/2 tests passed**. Neither enabled nor computing state
could be found as a named button. Log:
`/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-route-editor-apply-a11y-red-7b495374-20260920T1620+0800.log`,
SHA-256
`544a6766f9adaca1031e3f67341cc4ec2f3507b3c9aba189f9818639e78ce03c`.

Smallest correction in `app/src/components/map/EditOverlayV274.tsx`: the
existing CTA now has `accessibilityRole="button"`,
`accessibilityLabel={saveLabel}`, test ID `route-editor-apply-draft`, and
truthful `{ disabled, busy }` accessibility state. Its visual geometry and
callback are unchanged.

Focused GREEN: exit 0, 2/2 tests. Log:
`/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-route-editor-apply-a11y-green-final-20260920T1624+0800.log`,
SHA-256
`cd25d6a2c9edd0df0d0ae098866aee1fbfe65bf9f736ef33b5872d7b2c0c2351`.
Adjacent Route/editor command passed 5/5 suites and 31/31 tests; log
`/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-route-editor-apply-a11y-adjacent-20260920T1625+0800.log`,
SHA-256
`f6531d0c7dc72c2d7719b079d67bdecd6278900dd2a3780026167ae64e4bd8fd`.

The required `npm run verify:changed` was not run. A fresh post-F5 audit at
`2026-09-20T16:20:02+08:00` found unrelated personal Chrome renderer PID
36318 at 27.8% CPU, Chrome GPU PID 581 at 17.8%, WindowServer at 27.2%, and
Docker hyperkit at 14.1%. Per resource policy the changed-scope result is
**PERFORMANCE_DEFERRED_ENVIRONMENT**, not PASS. Those processes were not
signalled or polled. The controlling A4 162 ms FAIL/HOLD remains unchanged.

Current SHA-256 identities:

- `EditOverlayV274.tsx`
  `e8e83e54cea31b6caac901998705da89477c899a58f93d7bb75bc498b11f0f9b`;
- accessibility test
  `627d621cfcc1ff9d5ae54346224cf8f3346a3f875472950762c497262cc30441`;
- unchanged connected harness
  `51e79c238dfc2bb3c09c7792a77d500288a986747d30e6646b1b9af417d909c2`.

## `88c6640e...` connected loaded journey — terminal FAIL

Frozen fingerprint:
`88c6640ed41e54d72eb47a2ee084b5233a10d7956710d38973d1e0967797ef74`
(644 files). Syntax and self-test passed at this exact source; persisted log
`/Users/mzm/Desktop/cairn_revision03_work/evidence/f1-f2-self-test-88c6640e-20260920T1625+0800.log`.

The pre-run audit at `2026-09-20T16:22:07+08:00` found no competing Cairn
Jest, Expo, Metro, Playwright, API, or database workload and ports 8087,
8108, 8109, 8110, and 8111 free. Ambient personal/system contention was
explicitly retained: Chrome renderer 21.2%, Chrome GPU 15.4%, WindowServer
24.7%, Docker hyperkit 13.0%, and active Spotlight indexing. The run held
HEAVY_EXCLUSIVE only for functional state/identity evidence; **no latency or
responsiveness claim** is made.

Namespace `f1f2-88c6640e-20260920t162207`; fixture user `9925`; fresh
profile `/tmp/cairn-f1f2-88c6640e-20260920t162207-profile`; output
`app/_review/f1-f2-connected-normal-entry/20260920T162207-88c6640e-route-a11y/`.
The Expo and harness commands retained the same strict fixtures and synthetic
pk-format adapter token as the 7b run, with port 8087 and the new identities
above.

Result: exit 1, terminal **FAIL**, no terminal exception, 16 captures. The
only failed assertions were `activityRouteReferenceOnHike` and
`activityRouteReferenceOnRun`; `loadedJourneyCompleted`, `runtimeClean`,
`noUnexpectedApiRequests`, and every other assertion passed. There were no
runtime errors, unexpected external/API requests, failed requests, or HTTP
errors. No `runner.log` was persisted; this document and the manifest record
the terminal stdout without implying a runner receipt. The owned Expo
process was stopped after terminal outcome; at `16:26:11+08:00` no owned
namespace/profile/harness/Expo process or port-8087 listener remained and
HEAVY_EXCLUSIVE was released.

Demonstrated connected evidence:

- normal Home -> Hike -> Start -> realistic R-GPS -> Pause/Resume -> full
  Plant private Cairn -> same recording -> live pre-Finish Memory -> Finish
  -> same Activity Detail/linked Cairn;
- Route create with real Beautify/Apply/Save, canonical Route Detail, cold
  reload/new JS realm, Home/Trails reopen of the same Route, second real
  Beautify/Apply/Save edit, and Hike plus Run pre-start with no auto-start;
- Activity client ID `8fe7b0c6-82f6-4a58-8adc-e22aa9484beb`, remote 9202;
  Cairn client ID `1909c335-d0e2-47f5-9271-7c8fc463d7f1`, server 7301,
  exact Activity origin; Route client ID
  `50e2028e-9d10-411f-ace7-c80726b0c21d`, remote 6201, exact Activity
  origin;
- Route snapshot hash was identical across cold reload
  (`d20de23cb7bd82889ada98f6a3477f526b10afd40392a0da489cf11bc61b9b99`);
  created geometry hash `f167c7dc4967bb7f3ed44ff01e8d9e6e5ffcf946ba9bd8b22ab902f89ec687f2`
  and later edited geometry hash
  `b60cc80ef220781e7d25ccd80bb5ef9df5c1b55495bc85a001e486579c43a43b`
  were distinct; route update count was one;
- strict fixtures recorded four Matching calls and one walking Directions
  call only at Final; no planned or Final geometry was accepted as Memory.

The exact failure is current product behavior, not a timing outcome. Both
pre-start surfaces visibly showed the selected reference and remained idle,
but both snapshots had `activityRouteReference:null`. `MapHistoryScreen`
validates the ready Route and navigates with `{ routeId: ready.id }` only.
Hiking and Running render pre-start geometry from that selected Route, then
call `captureActivityRouteReference(selectedRoute)` only inside explicit
Start. This matches the older Route convergence document's “At Start”
contract, but not this closure run's stronger assigned identity assertion
“activityRouteReference on Use”. Existing source tests conflate receipt of a
selected pre-start route with creation of the Activity-scoped snapshot.

No product or harness correction and no rerun occurred. Capturing the global
Activity reference at Use without an explicit abandonment/back cleanup
contract could leave stale session-scoped state, so this requires a product
contract decision and fail-sensitive normal-handler test before any change.

Core artifact SHA-256:

- manifest `328372dfd773da942c7a4b8e2f6964771c6bcca4cb1c925ac43ca91c880636f9`;
- trace `aad6bf26ced907fc1cbb97f247dd9c5ccbad9eadc0b6751adcbd42e2c0143ca5`;
- requests `b2e8a1e6e22c8be70d77db05d9be9a58218ec300fcb1afd17b72763703a75dc8`;
- network diagnostics `51359093e74a29d3973235289c52599d07f8ed78e156ad6aa7cb83aec4541252`;
- runtime errors `fcf33dfbe13c2354bf0e1b063f9fb422747a46cee00b7420bceff2b81457b345`;
- ordered board `0edc856e1d8552da7eb43fa6287d837c4aab5939b71d9c51ff39759ca15d81e6`;
- Hike pre-start `4f68a76de2a4183c711a68d75a2f3b9696c46018fea9eb1ee9e0f9c90e45554b`;
- Run pre-start `fda7438f8574b3806b50b47f750b523636d441ad01a029a7c43aa53fa4a246fa`.

Evidence boundary remains fixture-backed loaded Expo Web at mobile viewport,
not real API/MySQL, real Mapbox, native GPS, field, or physical-device proof.

## Stale evidence and limits

- `docs/review/plant/current/` screenshots and `results.json` predate the
  provider-clock correction and are source-stale for live simulator-selected
  Activity Plant entry. They remain historical visual evidence only.
- The `c4cda566...`, `db64b441...`, `ad386835...`, `6675b2b0...`, and
  `7d2463ea...` loaded artifacts are retained FAIL evidence; none is promoted
  to full F1/F2 PASS. All predate the owner/Activity durable-result boundary
  at `d0a50a33...` and are source-stale for current Cairn single-flight,
  owner switching, generation-scoped linking, and feedback behavior.
- Existing O55 simulator/raw-GPS documents remain authority for their
  original Activity scopes, but they did not prove the corrected connected
  Plant path and do not substitute for this held journey.
- The loaded pre-Finish geometry is valid only for fixture-backed Expo Web
  and an isolated synthetic token. It is not real Mapbox/native proof.
- The current checkpoint additionally changes the demonstrated F2 Cairn
  commit boundary and its focused tests. It does not change Memory radius,
  geometry, 30-minute truth, R-GPS authority, backend, database, deployment,
  OTA, version marker, or supervision hooks. No owned process or heavy token
  remained at this checkpoint.

## Successor `fa986cc8...` loaded disposition

The independently reviewed successor harness corrected the acceptance
contract and Expo Web capability boundary without changing product Route
reference timing. At fingerprint
`fa986cc808e067b98563d9cf72fa6cd885d038d414fafe342d98a9f701b1bff5`,
one fresh-namespace fixture-backed loaded Expo Web journey exited 0 with
**PASS**, `failed:[]`, `terminalError:null`, all 33 manifest assertions true,
clean strict runtime/network evidence, and 16 captures.

The durable full receipt is
`docs/review/v1-closure/20260918T222838+0800/evidence/f1/fa986cc808e067b98563d9cf72fa6cd885d038d414fafe342d98a9f701b1bff5/F1_F2_CONNECTED_PASS.md`.
The result proves the connected normal-entry Activity/Cairn/live-before-Finish
Memory/Finish/Route/cold-reload/Use identities inside its stated Web fixture
boundary. On Hike and Run pre-start, Use Route selected the exact edited Route
and remained idle with a null Activity Route reference; separate actual-handler
tests prove explicit Start captures the immutable exact reference and Back
clears it. Expo Web showed the exact `Map unavailable` fallback, so native
mounted Mapbox source is explicitly `NOT_RUN`.

Earlier attempts in this document remain terminal FAIL evidence. The run was
made with `machineUncontendedForTiming=false`, makes no performance claim, and
does not alter the controlling A4 162 ms **FAIL/HOLD**.
