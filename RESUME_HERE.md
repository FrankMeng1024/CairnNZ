# O88 quality-closure recovery checkpoint

Updated: 2026-10-21 (Asia/Shanghai), after Q01-Q20 engineering closure and
final real-Mapbox review. This checkpoint is intended to make the exact work
safe to resume after a crash.

## Safe workspace and provenance

- Worktree: `/Users/mzm/Desktop/cairn/CairnNZ-o88-cairn-experience`
- Branch: `codex/cairn-encounter-experience-20261020`
- Recovered O88 HEAD: `66a1cb1faf6a827b9a23f8c693edd543745515c8`
- Fork/base: `79b99a2b4b48f99658d4dc7cc564579d50603486`
- The recovered candidate was clean: no staged, unstaged, untracked, merge,
  rebase, cherry-pick or linked-worktree lock state. All changes after that
  point are the recovered quality-closure work represented by this checkpoint.
- Resolve the final local checkpoint with `git rev-parse HEAD`; it is the
  commit containing this file. Nothing has been pushed, merged or published.

## Concurrent Hike/Run work preserved

- Primary worktree: `/Users/mzm/Desktop/cairn/CairnNZ`
- Branch observed read-only: `codex/hike-run-quality-upgrade-20261020`
- Latest observed HEAD: `231de7f59571d813c7f23e68ad4db0c3a3c310cb`
- Latest observed local edits were its own closure reports and packaging
  script. This O88 task did not edit, stash, clean, checkout, merge, rebase,
  stop its Expo process, or otherwise mutate that worktree.
- Known collision files are Plant, Running, the Plant linkage test and the web
  Mapbox adapter. Integration remains Owner-authorized future work only.

## Q01-Q20 closure state

- Q01-Q05: fixed and regression-covered. Plant now has one account/activity/
  origin-scoped durable draft; publication states are truthful; placement
  provenance is preserved; incompatible management actions serialize; delete
  navigation waits for a durable accepted snapshot.
- Q06: web phone-size layout review passed at 360/390/430 with short/long and
  Day/Sunset/Night representative states. Native keyboard and Dynamic Type are
  still device-dependent acceptance items.
- Q07-Q12: fixed and regression-covered. Presentation groups have stable
  principal identity and acknowledgement watermarks; exact navigation survives
  restart; same-place and distributed map clusters diverge correctly; found/
  owner lists use complete keyset pagination; push opt-in is latest-intent and
  account fenced; push targets use pending/processing/completed lifecycle.
- Q13: fixed with transactional, idempotent notification-delivery outbox,
  bounded retry/backoff, opt-out-at-dispatch and provider receipt state in
  migration 055 and backend model/drain paths.
- Q14: production headless-delivery orchestration is regression-covered from
  accepted background evidence through sync/discovery/commit/pending target.
  Actual locked iPhone delivery and force-quit limits remain native evidence,
  not an engineering PASS claim.
- Q15-Q17: real isolated authenticated MySQL/API matrices passed legacy and
  unified authorization/cohort negatives and the exact Shanghai plan/apply/
  two-revision/cleanup rehearsal. No shared or production database was used.
- Q18: backend cold/warm stages and client Memory geometry are measured. The
  final Memory geometry uses truth-safe nearest-point partitions clipped to
  exclusive tiles; full-app evidence recorded a 73 ms worst cooperative slice
  at 10,000 points, with no eligibility hiding or fabricated visits.
- Q19: read-only cross-branch comparison completed; integration is pending.
- Q20: finite/cancellable state-linked web behavior, Reduced Motion branches,
  touch semantics and actual phone-size visuals are covered. VoiceOver,
  Dynamic Type, native haptics and native transition feel remain Owner-native
  acceptance.

The two policy questions were not changed: Run quick empty Only-Me behavior
and a reader-side restore flow remain Owner decisions.

## Final verified authorities

- Full app Jest: **243/243 suites passed**, **2,377 passed / 4 skipped / 0
  failed** tests, 2/2 snapshots. Evidence:
  `/tmp/cairn-o88-final/app-jest-authority.json`.
- Activity change-aware gate after the shared projection edit: **680/680
  passed**.
- Backend Node tests: **180/180 passed**.
- Real disposable MySQL Public/auth harness: **21/21 passed**.
- Real disposable MySQL Memory/Friends harness: **35/35 passed**, including
  1,005 retained + 1,005 owner rows with no historical 1,000-row truncation.
- Separate personal/Friends harness: **26/26 passed**.
- Migration 055 isolated up/down/reapply: 6 columns + 2 indexes, then 0 + 0,
  then 6 + 2.
- Shanghai disposable rehearsal: read-only plan, exactly 60 applied, exactly 2
  revisions advanced, exactly 60 cleaned, no live fixture markers remaining.
- Real Expo Web core journey: 13 production-screen captures; 32/32 hosted
  Mapbox resources completed; zero failed resources and zero runtime errors.
- Real Expo Web density matrix: **24/24** scenario/theme/zoom captures; 40
  hosted Mapbox resources; zero runtime errors; physical exact-overlap cluster
  click opened the eight-item sheet; physical distributed cluster click
  expanded zoom 11.8 -> 11.896 and opened no content sheet.
- Memory scale controlled suite: 2,001 cold 2,239.5 ms, incremental 226.7 ms,
  10,000 cold 8,612.8 ms, worst cooperative phase 21 ms. Full-app authority:
  2,001 cold 1,927.9 ms, incremental 189.9 ms, 10,000 cold 10,515.4 ms,
  worst cooperative phase 73 ms.
- `git diff --check` is clean. No Mapbox credential or other real secret was
  persisted; test token strings are explicit local QA placeholders only.

Repository-wide `npx tsc --noEmit` remains baseline red with 159 errors in
generated FriendsScreen code, preview screens, Playwright specs and existing
test/Turf typings. None identifies an O88 production file changed in closure;
this is documented, not represented as green.

## Release-gate boundary

- Gate A: `PASS WITH EVIDENCE`.
- Gate B: `NATIVE OWNER PENDING`; real Mapbox Web evidence passes, but required
  compatible-iPhone keyboard, VoiceOver, Dynamic Type, Reduce Motion, haptics,
  GPS/background and thermal/battery evidence does not exist.
- Gate C: `PASS WITH EVIDENCE` for isolated auth/DB, migration, outbox and
  client target handling; physical-device provider/display/locked delivery is
  an explicitly separate native acceptance item.
- Gate D: `OWNER DECISION / EXTERNAL BLOCKER`: no production seed, no field
  walk, no branch integration, no approved native build and no publication.
- Overall verdict: **OWNER NATIVE ACCEPTANCE PENDING**. There is no known open
  P0/P1 in the independently testable candidate, but it is not authorized or
  evidenced as a TestFlight/public-production release.
- The existing `O87` OTA marker was not incremented because this is a HOLD at
  native/integration/field authorization gates. App/runtime/build versions are
  unchanged.

## Evidence and safe next action

Final local evidence is under `/tmp/cairn-o88-final`; only the final green
`live-mapbox-review` and `mapbox-density` directories belong in the package.
Earlier `*-failed-*` directories are diagnostic harness attempts and must not
be presented as final product evidence.

After the local checkpoint commit and O88 review ZIP are complete, the first
safe next action is to open and read
`~/Downloads/Cairn_O88_After_Closure_Global_Theme_Visual_Audit_EN_V2.md`, then
perform that second task strictly read-only. Do not change O88 or Hike source
during the global audit.

## Still prohibited without new Owner authorization

No merge, rebase, cherry-pick, push, deploy, production/shared data write,
Shanghai seed, EAS Build, OTA/TestFlight publication, O-marker increment, or
change to the primary Hike worktree.
