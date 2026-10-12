# Routes continuation state

- Preserved upstream checkpoint: Memory/Friends/Cairn commit `27865c7`; ZIP in
  `/Users/mzm/Downloads/Cairn_Memory_Friends_Cairn_Implementation.zip`.
- Final source checkpoint: `d8a715b` (behavior through `aa9b109`; the last
  commit only aligns legacy regression fixtures with current store/navigation
  contracts).
- Baseline worktree: `/private/tmp/CairnNZ-memory-friends-cairn`.
- Completed: targeted preflight; one Create entry with Plan / Use an Activity;
  ordered multipart draft and atomic Undo; Draw and Point provider contracts;
  append, interval replacement and adjacent-gap repair; draft recovery;
  Activity import/Trim; owner-scoped offline persistence; received immutable
  Route snapshots; explicit multi-recipient delivery; separate editable copy;
  Use for Hike/Run snapshot pinning; Activity Detail entry removal; and
  server-authoritative topology plus gap-excluded distance.
- Final deterministic Route result: 15 client suites / 195 tests and 75 shared
  backend target tests pass on the final candidate. Migration 046 upgraded a
  populated legacy fixture and rolled back in isolated MySQL. The full app
  TypeScript command remains nonzero with 159 known repository-wide errors;
  none are in files touched after this preserved Routes checkpoint.
- Independent final focused review of `aa9b109` returned ACCEPT after fixes for
  account-switch cache isolation, high-density Draw spur detection, partial
  share idempotency and server distance authority.
- External gates: Mapbox account-specific durable-result terms; native gesture,
  Reduce Motion, native renderer, live-provider coverage and device performance.
  No build, migration deployment, provider batch, OTA or release was run.
