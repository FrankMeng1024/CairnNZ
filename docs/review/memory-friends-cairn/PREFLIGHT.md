# Memory, Friends Fog, and Cairn — targeted preflight

Date: 2026-10-12 (Asia/Shanghai)

## Baseline and isolation

- Source baseline: `codex/o75-final-diagnostic-truth-closure` at
  `24587efb19b272ff440280fc859c240f5e03f5de`.
- Implementation branch: `codex/memory-friends-cairn-implementation`.
- Isolated worktree: `/private/tmp/CairnNZ-memory-friends-cairn`.
- The Owner workspace was clean when the worktree was created and is not used
  for implementation writes.
- This task does not attempt to identify or change the Owner's installed phone
  build. No native build, cloud build, deployment, OTA, or production database
  operation is authorized.

## Six required preflight answers

1. **One location lifecycle:** the app already has one
   `nativeRealLocationSupervisor`. Activity and passive Memory are priority
   consumers of that supervisor, rather than independent native watchers.
   Pausing an Activity stops Activity truth while passive Memory may continue.
   The implementation will retain this ownership model and add regression
   tests instead of adding another watcher or hidden Activity.
2. **Per-contribution delay evidence:** `memory_points` has observation and
   creation time, while `memory_presence_witnesses` has observation,
   receipt/update time, accuracy, and source provenance. A trustworthy
   eligibility time can therefore be computed per contribution as the later of
   accepted observation time and server receipt time, plus at least 30 minutes.
   The current friend projection does not apply that delay and excludes passive
   witnesses; both are targeted changes. Future timestamps must delay or reject
   evidence, never make it visible sooner.
3. **Relationship, access, and entitlement:** current Friend/Public encounter
   rows are tied to live markers and live friendship/publication state. They do
   not preserve a versioned acquisition entitlement. Additive revision,
   collection, acquisition, and moderation records are required; current
   relationship/access checks remain separate from acquired-history reads.
4. **50m/30m geometry conflict:** a Cairn may be adjusted by up to 50m at first
   placement, while personal Fog uses a 30m accepted-presence radius. A valid
   Cairn can therefore be outside the literal personal Fog polygon. This task
   will not change either locked global value and will not fabricate an
   explored point. The dependent promise that every adjusted Cairn is visibly
   inside Fog is blocked pending an Owner decision. Independent fixed-place,
   revision, acquisition, and rendering work continues.
5. **Deletion and invalidation:** current source deletion cascades or explicitly
   removes encounter rows, so acquired history is not durable. Additive
   snapshots and collection tombstones are required. Unfriend/block/share
   revocation must invalidate live Friend projections immediately but must not
   erase legitimately acquired snapshots. Existing account deletion behavior
   remains unchanged; new user-owned rows use the current deletion boundary.
6. **Union feasibility:** Mapbox can render one de-duplicated friend union plus
   a bounded overlap classification without stacking individual friend
   opacities. The current layer incorrectly omits Mine geometry in Friends view
   and has no overlap class. The implementation will preserve bounded/tiled
   geometry and add theme-specific friend/overlap tokens, tests, and accessible
   selector/legend states. It will not write derived Union geometry back as
   canonical Fog.

## Reuse, changes, and non-goals

Reuse:

- canonical accepted Memory points and presence witnesses;
- the single native location supervisor and passive recorder;
- `friendship_episodes`, directional grant rows, privacy masks, and bounded
  projection pipeline;
- existing map-first Memory composition and theme token system;
- current Public/Friend proximity policy and moderation authentication.

Change:

- replace the coarse all-current/all-future sharing mode with explicit
  directional grants managed from Friends;
- retain legacy grants as legacy scope rather than silently broadening them;
- apply a server-side per-contribution 30-minute visibility delay and include
  eligible passive Memory evidence;
- list all current friends in the selector, distinguish authorized-empty from
  not-shared, and preserve an explicit empty selection;
- render Mine, Friend union, and Mine/Friend overlap as distinct non-stacking
  states and persist manual city choice;
- add immutable Cairn revision snapshots, version-specific acquisitions,
  collection/history states, and authenticated report/appeal moderation states;
- integrate online, server-authorized discovery without requiring a completed
  Activity or awarding offline retroactive acquisitions.

Non-goals:

- Home redesign, global discovery ritual, push notifications, nearby hint mode,
  Route redesign, seed operations, account-deletion policy, global Fog radius,
  GPS/filtering/Activity truth, Snap behavior, or production operations.

## Batch order and verification

1. Contracts/migration and directional sharing with delayed projection.
2. Selector, Union rendering, themes, and city persistence.
3. Cairn revisions/acquisitions/library and online discovery integration.
4. Report/appeal/freeze states and authenticated operator transitions.
5. Targeted production-path service/route tests, client tests, changed-Activity
   verification, web screenshots where safely renderable, independent review,
   and one review ZIP.

Every batch is intended to be a bounded local commit. Migrations are prepared
but never run against production. Native-only evidence remains an Owner gate.
