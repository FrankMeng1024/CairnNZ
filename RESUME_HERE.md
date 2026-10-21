# O88 targeted correctness and visual closure checkpoint

Updated: 2026-10-21 (Asia/Shanghai), after focused R01-R08 correctness work;
bounded visual closure and real-journey verification remain in progress.

## Current targeted task authority

- Worktree/branch: `/Users/mzm/Desktop/cairn/CairnNZ-o88-cairn-experience`
  on `codex/cairn-encounter-experience-20261020`.
- Recovered HEAD: `cfcf19d8ffea3c98cbef117154b6c91f321e0f2f`; worktree was clean,
  with no staged, unstaged, or untracked files before this checkpoint edit.
- The independent review of this commit reopens prior PASS claims. R01-R06
  have now been reproduced, repaired, and focused-tested. R07 publication
  truth and R08 provenance/hit-target changes are focused-tested; real UI and
  journey evidence remains pending.
- Available review authority:
  `~/Downloads/Cairn_O88_Independent_Quality_Review_20261021.md`. The optional
  `Cairn_O88_Independent_Probe_Evidence_20261021.zip` is not present.
- Applicable visual-system documents, asset manifest, locked QA boards, prior
  O88 closure package, and prior global visual audit have been read/inspected.
- Concurrent Hike/Run worktree was observed read-only at
  `c516ba2749f6e30660e7d462de829c8c1e397202` with its own uncommitted Activity
  changes. Do not touch, stash, clean, merge, rebase, or use it as an edit
  source. Re-read its identity only at delivery.
- No merge, rebase, push, deploy, shared/production write, seed, EAS Build,
  OTA, version/runtime marker change, or publication is authorized.

## R01-R05 corrected checkpoint

- R01: v4 persists session/origin/Activity/location, but hydration only checks
  owner/title/text, then combines old words/audience with the current entry
  context. The editor is not gated against a late storage result; draft writes
  and cleanup use only the owner-wide legacy key.
- R02: adjustment GPS Cancel and Pin Back both call `nav.goBack()`, exiting the
  complete Plant flow instead of restoring the existing editor and pin.
- R03: HTTP 200 malformed/empty/top-error bodies can still become `sent`; a
  partial ticket result marks the whole row sent; the 30-second bound ends at
  response headers rather than the body; unresolved receipt rows can starve
  later rows.
- R04: cluster intent generation increments only for cluster presses/unmount;
  a newer single-marker press does not invalidate delayed cluster work.
- R05: mutation authority trusts `--environment`; review material omits exact
  target/cohort/expiry/cleanup identity; reapply inserts new readers without
  rejecting cohort expansion.

Corrections now present but not yet locally committed:

- R01/R02: owner + exact Activity/generation/mode-scoped v5 Plant drafts,
  serialized writes with active-session fencing, truthful hydration gate,
  explicit standalone resume/discard, exact-session cleanup, and reversible
  GPS/pin adjustment Cancel/Back. Focused Plant suites: 18/18 passed.
- R03: push dispatch now retains per-original-target receipt identity, retries
  only unresolved targets, requires accepted ticket IDs, bounds headers and
  body, rejects malformed/short/unknown responses, and prevents unresolved
  receipt rows from starving later rows. Migration 056 persists bounded
  receipt attempts. Focused delivery/contract suites: 19/19 passed.
- R04: every single/cluster selection, dismissal/focus loss, data/theme
  generation, account switch, and unmount invalidates older asynchronous map
  work. Focused controller/component suites: 18/18 passed.
- R05: mutation target is resolved from MySQL server UUID + database against
  an explicit allowlist; the caller realm is only an assertion. The v2 field
  review and Owner plan bind target, allowlist, exact readers/creators, all
  reviewed points, fixed expiry/TTL, and exact cleanup scope. Unit authority
  suite: 8/8 passed. Fresh disposable MySQL rehearsal passed 10/10 checks,
  including target inspection, exact approval, cohort-expansion rejection,
  intentional partial-state recovery, revision, and cleanup. Evidence:
  `/tmp/cairn-o88-r05-rehearsal-20261021b`.
- R06: notification-open navigation now carries exact acquired revision
  identity, is account- and readiness-fenced, and persists a bounded generic
  retry target for cold-start/interrupted handling. Foreground visibility
  acknowledgement is AppState/frame-gated; headless delivery bounds both
  headers and body and retries durable work on later callbacks. Focused Cairn
  notification/presentation tests: 43/43 passed; focused headless/background
  tests: 14/14 passed.
- R07: an unlinked Cairn now reports Public publication as impossible rather
  than implying that waiting will make it eligible. Linked-but-unconfirmed
  Activity truth remains conditional and explicitly outside review/discovery;
  capability, empty-content, and suspension blocks are surfaced before Save.
- R08: encounter presentation now derives and exposes Friends/Public/mixed
  provenance from backend counts instead of hard-coding Public; Open/Later
  controls meet the 44px target. The combined publication/provenance/
  notification suite passes 71/71; the backend contract passes 26/26.
- Repository-wide TypeScript remains baseline-red in generated previews,
  Playwright typings, existing Activity tests, and Turf declarations. A
  filtered run reports no diagnostics in any file changed by this task.

First safe next action after interruption: inspect `git status`, verify the
latest local checkpoint commit, then continue the bounded R09 visual fixes
and real Mapbox/user-journey evidence. Do not run a production/shared fixture
command.

---

# Previous O88 quality-closure checkpoint (historical, superseded by review)

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
