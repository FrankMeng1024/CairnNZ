# Shanghai dense field-test plan

> **NOT APPLIED. No data has been planted in production or any shared backend. An iPhone cannot encounter these O88 fixtures now.**

## Purpose and allocation

The private operator manifest defines 60 distinct bilingual place notes: 34 Public and 26 Friends. Distribution is 14/18/14/14 across four broad candidate areas. It includes single points, same-place groups of 2–8, separated groups, 11 layout cases, six revision-two cases, four ordinary update checks, and two revisit-only pages.

Candidate broad areas:

| Area | Count | Intended public-space review | Status |
|---|---:|---|---|
| Zhangjiang/Jinke | 14 | broad technology-park pedestrian corridors near Jinke Road | candidate only; field safety not verified |
| Wuding Road/Jing'an | 14 | broad station/streetscape walking corridor | candidate only; field safety not verified |
| Sanhe Road/Yangpu | 18 | broad public street corridor | candidate only; coordinate conversion needs field confirmation |
| Caojiadu | 14 | broad public neighborhood/commercial walking corridor | candidate only; field safety not verified |

Coordinates are stored as QA candidate WGS84 points with source notes, never as an Owner/user GPS trail. A public review should expose only these broad areas—not exact fixture coordinates. Before activation, a human must verify every point in the actual Mapbox client for public pedestrian access, no road/river/private/sensitive placement, and realistic phone GPS behavior.

## Isolation model

- Batch identity and manifest SHA are immutable operator inputs.
- TTL defaults to 14 days.
- Readers must be explicitly allowlisted in the batch cohort.
- The batch must be active, unexpired, and `field_verified` before fixture discovery SQL will include it.
- Public fixture authors remain strangers; Friends fixture authors receive real test-account friendships.
- Public authors/readers must pass the same effective pilot authority and configured sensitive-zone policy before apply.
- Fixture publication uses the normal coarse Public retained location and location-policy-bound publication hash.
- Normal creator publication is not bypassed for ordinary markers. The fixture namespace does not manufacture an author Activity or claim the author visited.
- Reader arrival, evidence, distance, acquisition, revisit, versioning, presentation, and notifications use normal product logic.

## Layer A: field experience card, after approval and verification

Permissions: signed-in QA reader, foreground precise location, Memory enabled; notifications optional and tested separately. Do not require Always unless the test is specifically about background behavior.

1. Operator applies only the reviewed batch to the exact backend the iPhone uses and runs `verify`.
2. Tester records the batch id, app commit, backend SHA, account id, and system location/notification permissions.
3. Walk a verified 5–12 minute public ground-level corridor at normal speed. Do not follow a straight synthetic line or enter roads/private sites.
4. Keep the app foreground for the first pass. Expect opportunities for roughly 1–3 grouped encounters, not all nearby notes. Record the actual count; **frequency is not established** until field telemetry exists.
5. Use `Later` once and prove the note appears in `I found`; use `Open` once and inspect version/identity/audience.
6. Leave the encounter area, satisfy the real revisit/time policy, then return for one staged new revision. Do not widen the radius or backfill a historical route.
7. For a second pass only, test background/locked state and record acquisition, enqueue, provider receipt, display, and tap separately.
8. End with operator `verify`; cleanup the exact batch and verify zero active fixtures/cohort rows.

## Layer B: non-field density and authorization

Use disposable MySQL or an isolated QA backend—not production—to exercise exact-point groups at 20/60/100, paging/dedupe, one presentation group, notification dedupe, friend authorization negatives, withdrawn/moderated rows, account switching, and revision retention. O88’s disposable MySQL run covers these server cases; real Mapbox rendering/performance remains pending.

## Must-pass before any production-like activation

- Owner gives explicit batch-specific approval.
- Exact backend identity and client environment are recorded.
- All candidate points are field-reviewed and marked `field_verified`.
- Effective Public pilot and sensitive-zone policy succeed for test actors.
- QA accounts contain no real-person private data and are not normal production users.
- Cleanup is rehearsed against an isolated database and independently verified.
- No secrets or exact private user coordinates enter the review package.
