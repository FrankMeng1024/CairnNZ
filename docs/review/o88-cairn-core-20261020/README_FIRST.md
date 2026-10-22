# Cairn O88 Core Experience — review first

## Candidate identity

- Branch: `codex/cairn-encounter-experience-20261020`
- Isolated worktree: `/Users/mzm/Desktop/cairn/CairnNZ-o88-cairn-experience`
- Fork/base and verified `origin/main`: `79b99a2b4b48f99658d4dc7cc564579d50603486`
- Active Hike/Run worktree observed, but not modified: `/Users/mzm/Desktop/cairn/CairnNZ`, branch `codex/hike-run-quality-upgrade-20261020`, observed HEAD `084a34e6de853d077ba8c24b2d5b9ae288144c21`
- Candidate commit: see `CANDIDATE_GIT_IDENTITY.txt` in the packaged review after the final local commit.

## What this candidate delivers

O88 makes Cairn creation and retention read as one place-note experience: write, fold/leave, encounter, open, add a new version, archive/remove, or withdraw. It adds a reusable stone/paper visual family, compact adaptive creation layout, truthful audience actions, a persisted-success moment, version-aware detail, explicit deletion consequences, grouped Memory encounters, dense authorized cluster paging, placement provenance, explicit notification consent, secure notification deep links, and Friends legacy-endpoint authorization.

It also supplies a disabled-by-default Shanghai 60-Cairn field-test system with cohort isolation, TTL, idempotent apply/verify/revision/cleanup commands, reviewed-point gating, and a production approval interlock.

## Boundaries honored

- **Not merged, rebased, cherry-picked, pushed, deployed, built with EAS, or published by OTA.**
- **No production Cairns, users, Activities, permissions, or Memory records were changed.**
- The existing Home `O87` marker and app/runtime/build versions were not changed.
- All writes used the isolated Git worktree, browser fixtures, or a disposable local MySQL 8 container.
- Port `8118` belonged to this review; the Hike/Run session on `8098` was left running.
- No Mapbox token was available to this isolated shell, so final map screenshots truthfully show the application fallback. Native Mapbox/Fog and actual GPS field acceptance remain pending.

## Read in this order

1. `EXPERIENCE_REVIEW.html` for the actual UI capture and video.
2. `USER_JOURNEYS_AND_STATE_MATRIX.md` for end-to-end semantics.
3. `TEST_AND_EVIDENCE_MANIFEST.md` for what is proven and what is not.
4. `SECURITY_AND_CROSS_BRANCH.md` and `NOTIFICATION_NATIVE_CAPABILITY.md` for high-risk boundaries.
5. `SHANGHAI_DENSE_FIELD_TEST_PLAN.md`, then `SEED_PLAN_AND_COMMANDS.md`, before considering any fixture activation.
6. `OWNER_ACTIONS.md` for the smallest next decisions and device checks.

## Material limitations

- The captured UI is actual Expo Web at mobile viewports with controlled isolated QA responses; it is not an iPhone capture and does not prove native animation frame rate, haptics, keyboard behavior, VoiceOver, APNs delivery, or background execution.
- A server push is enqueued only after authoritative server acquisition. The current passive background task records evidence but has not been proven to perform background discover/acquisition. “Immediate lock-screen encounter while the app is terminated” is not claimed.
- Shanghai coordinates are candidate WGS84 QA points. They have not been field-walked, checked in real Mapbox in this worktree, or approved for production activation. **No Shanghai data has been planted; an iPhone will not encounter these fixtures now.**
- Run still has the O87 private empty quick-Cairn behavior. Unifying it with the full editor is an Owner decision and cross-branch integration task.
