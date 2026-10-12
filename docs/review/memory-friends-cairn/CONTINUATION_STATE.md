# Overnight continuation state

Updated: 2026-10-13 Asia/Shanghai

## Candidate

- Worktree: `/private/tmp/CairnNZ-memory-friends-cairn`
- Branch: `codex/memory-friends-cairn-implementation`
- Exact base: `24587efb19b272ff440280fc859c240f5e03f5de` (O75)
- B2 review-closure code checkpoint: `a5967b50bc7336304380f1b8ff6ae9c349639fa3`
- Active batch: B2 standalone package freeze; B3 Routes preflight next
- Original Owner workspace is not used for implementation writes.

## Completed checkpoints

1. B0 preserved the existing branch, isolated worktree, queued Routes contract,
   UI DNA and Home assets. Protected hashes are in `PROTECTED_ASSETS.sha256`.
2. B1 implemented directional full-history grants, the server-enforced
   30-minute contribution delay, private-place masks, city/selector state and
   derived Mine/Friend/overlap rendering without changing canonical Fog.
3. B2 implemented immutable Cairn revisions/acquisitions, personal history,
   online discovery, guaranteed current-Friend acquisitions, durable locality
   visits, presentation groups and revision/source-scoped moderation.
4. The first independent review returned HOLD. Its five confirmed findings are
   fixed in the working delta: account fencing, canonical Activity evidence,
   temporal eligibility, revision/source moderation scope and reader removal.
5. The second review-closure delta removes the remaining contradictory legacy
   acquisition path, enforces Public viewer authorization, adds Friend revision
   temporal boundaries, logical cross-audience moderation/idempotency, and
   private aggregate Thanks with self-Thanks denial.
6. The fourth review found a whole-second Marker timestamp race. The closure
   adds a dedicated `DATETIME(3)` content frontier, updates it transactionally
   through both production material-write paths, and verifies authenticated
   v1-to-v5 updates after visit entry rather than editing the fixture directly.
7. Real isolated results at the closure checkpoint: Activity CORE 625/625;
   targeted client 146/146; backend 129/129; personal/friend MySQL 21/21;
   Public 21/21; Memory/Cairn 24/24; production viewer gate 2/2; migration down
   postconditions 0/0/0/1. Locked Hike/Run final fingerprints remain
   `f678f89d` / `a1479659` in an exact-checkpoint 16/16 replay.
8. The same independent reviewer returned PASS on exact code checkpoint
   `a5967b50bc7336304380f1b8ff6ae9c349639fa3` after exact temporal equality
   was changed to fail closed.

## Retained failures and limits

- Initial extended MySQL runs failed in sequence because of an incompatible
  `JSON_TABLE ... FOR SHARE`, an incomplete audience-epoch fixture, a real UTC
  `DATETIME` versus local-time comparison defect, insufficient post-publication
  test observations, and one invalid fixture enum. All original logs are kept
  outside Git for the review package; none was rerun away without diagnosis.
- 100 guaranteed Friend Cairns are correct but final local API transactions
  measured roughly 6.0-7.2 seconds under load. This is a performance warning,
  not a functional failure.
- The existing 10k Memory scale fixture took roughly 42 seconds in Jest.
- A full-repository run retained one Memory performance failure: a 2,278 ms
  wall-clock slice while Expo/Metro workers were live. The exact isolated file
  passed 6/6 after stopping them (16 ms max slice). No threshold was changed.
- Full `tsc --noEmit` still reports 159 pre-existing errors; changed production
  client files report zero matching errors.
- Native Mapbox, GPS/background delivery, battery, haptic feel and iOS UI remain
  native/device gates. No native build was run.
- The locked 50 m initial Cairn adjustment versus 30 m Fog visual footprint is
  still an Owner decision; no Fog geometry was changed.

## Exact next action

1. Preserve the standalone Memory/Cairn review package.
2. Re-read master section 9 and the queued R00-R14 contract, then start the
   Routes-only preflight on this exact checkpoint.

## External gates

- Production migration/deploy/flags/moderation ownership: not authorized.
- Native build, TestFlight, OTA and device acceptance: not authorized.
- Account-erasure policy and the 50 m/30 m visual promise: Owner decisions.
- Mapbox account-specific storage/contract interpretation: Owner/legal gate if
  current account terms cannot be evidenced locally.
