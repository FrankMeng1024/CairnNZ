# Decision-to-code checklist

| ID | Accepted rule | Planned implementation authority | Status |
|---|---|---|---|
| M-01 | Memory uses the existing accepted-location lifecycle without hidden Activities | passive recorder + native supervisor contracts | in progress |
| M-02 | Existing opt-outs are not silently enabled | settings-store migration and transition UI | pending |
| M-03 | City-first camera; explicit choice persists; no scope-change jump | persisted Memory camera store | pending |
| F-01 | Sharing is directional, per friend, and only for accepted friendships | grant API + Friends UI | pending |
| F-02 | Existing coarse grants do not silently gain full-history scope | additive grant scope/version | pending |
| F-03 | Every shared contribution is delayed at least 30 minutes server-side | projection SQL/service | pending |
| F-04 | Revocation is immediate and purges local projected caches | authorization + client stores | pending |
| F-05 | Selector shows all current friends, including shared-empty and disabled not-shared | sources API + picker | pending |
| F-06 | Explicit empty selection survives reload | selection preference record | pending |
| F-07 | Mine is strongest; friends share one quiet union; overlap is one warm class | tiled renderer + theme tokens | pending |
| F-08 | Union geometry is derived display evidence only | no persistence path | pending |
| C-01 | Cairn coordinate is fixed after initial placement | marker update validation | pending |
| C-02 | Meaningful content changes create immutable revisions | revision service/tables | pending |
| C-03 | Permission/no-op changes do not create a content revision | revision service tests | pending |
| C-04 | Acquisition is version-specific and survives later source/access changes | acquisition + collection tables/API | pending |
| C-05 | Genuine accepted passive evidence can acquire online without Activity finish | online discovery endpoint | pending |
| C-06 | Offline evidence is not retroactively awarded | request-time/server receipt gate | pending |
| C-07 | Retry is idempotent; newer revision needs a later genuine revisit | unique entitlement + presence policy | pending |
| C-08 | Library separates I left / I found and exposes revision history | library API/client | pending |
| C-09 | Report/appeal has available/under-review/unavailable states | moderation cases + UI | pending |
| C-10 | No unauthenticated admin action and no threshold auto-deletion | authenticated operator routes only | pending |
| D-01 | No global discovery cooldown; distinct localities remain immediately eligible | server local-visit service | pending |
| D-02 | Maximum 3 acquisitions per persisted local visit | visit/acquisition rows under transaction lock | pending |
| D-03 | Same-locality reset requires both >120m departure and 15 minutes | durable visit transitions + accepted evidence | pending |
| D-04 | Category-first weights are Friends 50 / Updated 25 / Public 25 with redistribution | bounded server selector | pending |
| D-05 | Acquisition idempotency is `(viewer, cairn, revision)` | unique entitlement key | pending |
| D-06 | 20s presentation grouping is independent of durable acquisition | presentation group/event tables | pending |
| D-07 | Haptic eligibility is at most once per 180s; sound defaults off; no native effect in this task | presentation metadata only | pending |
| D-08 | `announcedAt` and `readAt` are independent; restart does not replay announced groups | durable group and acquisition state | pending |
| B-01 | A 50m-adjusted Cairn is always inside 30m Fog | conflicts with locked geometry; Owner decision required | blocked only for this promise |
