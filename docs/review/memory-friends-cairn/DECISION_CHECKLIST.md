# Decision-to-code checklist

| ID | Accepted rule | Planned implementation authority | Status |
|---|---|---|---|
| M-01 | Memory uses the existing accepted-location lifecycle without hidden Activities | passive recorder + native supervisor contracts | implemented + 625/625 Activity CORE gate; native telemetry gated |
| M-02 | Existing opt-outs are not silently enabled | settings-store migration and transition UI | implemented |
| M-03 | City-first camera; explicit choice persists; no scope-change jump | persisted Memory camera store | implemented + account-race tests |
| F-01 | Sharing is directional, per friend, and only for accepted friendships | grant API + Friends UI | implemented + real MySQL |
| F-02 | Existing coarse grants do not silently gain full-history scope | additive grant scope/version | implemented |
| F-03 | Every shared contribution is delayed at least 30 minutes server-side | projection SQL/service | implemented + 29:59/30:00/30:01 tests |
| F-04 | Revocation is immediate and purges local projected caches | authorization + client stores | implemented + lock-race tests |
| F-05 | Selector shows all current friends, including shared-empty and disabled not-shared | sources API + picker | implemented |
| F-06 | Explicit empty selection survives reload | selection preference record | implemented |
| F-07 | Mine is strongest; friends share one quiet union; overlap is one warm class | tiled renderer + theme tokens | implemented; native visual QA gated |
| F-08 | Union geometry is derived display evidence only | no persistence path | implemented |
| C-01 | Cairn coordinate is fixed after initial placement | marker update validation | implemented |
| C-02 | Meaningful content changes create immutable revisions | revision service/tables | implemented |
| C-03 | Permission/no-op changes do not create a content revision | revision service tests | implemented |
| C-04 | Acquisition is version-specific and survives later source/access changes | acquisition + collection tables/API | implemented |
| C-05 | Genuine accepted passive evidence can acquire online without Activity finish | online discovery endpoint | implemented + real API/MySQL; active Activity requires its acknowledged canonical prefix |
| C-06 | Offline evidence is not retroactively awarded | request-time/server receipt gate | implemented |
| C-07 | Retry is idempotent; publication/friend/audience/newer revision needs a later genuine revisit | unique entitlement + temporal eligibility + presence policy | implemented + real API/MySQL |
| C-08 | Library separates I left / I found and exposes revision history | library API/client | implemented |
| C-09 | Report/appeal has available/under-review/unavailable states | moderation cases + UI | implemented |
| C-10 | No unauthenticated admin action and no threshold auto-deletion | authenticated operator routes only | implemented |
| D-01 | No global discovery cooldown; distinct localities remain immediately eligible | server local-visit service | implemented |
| D-02 | Ordinary target is 3; all eligible current-Friend Cairns are guaranteed first and may overflow | transactional visit/acquisition selector | implemented + 5 Friends/200 Public real path |
| D-03 | Same-locality reset requires both >120m departure and 15 minutes | durable visit transitions + accepted evidence | implemented |
| D-04 | Remaining slots split Updated/New Public approximately 50/50; Friend Cairns are not sampled | deterministic Friend pass + fair ordinary sampler | implemented; configurable freshness boost capped at 20%; Thanks boost omitted without reliable signal |
| D-05 | Acquisition idempotency is `(viewer, cairn, revision)` across audience snapshots | logical unique entitlement key | implemented + real cross-audience MySQL regression |
| D-06 | 20s presentation grouping is independent of durable acquisition | presentation group/event tables | implemented |
| D-07 | Haptic eligibility is at most once per 180s; sound defaults off; no native effect in this task | presentation metadata only | implemented, effects intentionally absent |
| D-08 | `announcedAt` and `readAt` are independent; restart does not replay announced groups | durable group and acquisition state | implemented |
| B-01 | A 50m-adjusted Cairn is always inside 30m Fog | conflicts with locked geometry; Owner decision required | blocked only for this promise |
