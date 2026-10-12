# Decisions, supersessions and deviations

## Applied latest decisions

- Friend Cairns are deterministic: every eligible current-Friend Cairn is
  acquired before ordinary choices, including Friend-authored Public Cairns.
  Friend overflow may exceed the ordinary locality capacity but shares one
  restrained presentation group.
- Remaining ordinary capacity is split fairly between unseen Public and
  eligible updated non-Friend Public content. There is no global discovery
  cooldown. Visit persistence, true exit/revisit, revision deduplication and
  acquisition/presentation/read separation remain server-owned.
- Activity is factual and private. Activity Detail exposes neither social
  sharing nor Save as Route. Conversion remains available only from
  `Trails > Routes > Create Route > Use an Activity`.
- Route sharing delivers an immutable recipient snapshot directly into Shared
  Routes. Identical retry is idempotent; changed re-share is a new retained
  delivery; editing starts a separate owned copy.
- B4 adds durable grouping, unread state, acquired marker clustering and
  restrained foreground cues. It deliberately does not add global overlays,
  push, sound or new native haptic effects.
- Home keeps its original scenic frame/artwork. The bounded state window uses
  recovery/active-Activity/discovery priority without a new dashboard.

## Explicitly not changed

- Activity GPS filters, raw acceptance/rejection rules, WAL/durable frontier,
  canonical geometry/distance/time/segments, Snap candidate thresholds,
  provider budgets, final revision/fingerprint and Memory evidence geometry.
- Home background assets, crop selector, primary actions and three-theme DNA.
- Account-deletion product policy, nearby-hint/search mode, push, global
  discovery rituals, navigation product claims, seed operations and Public
  Route marketplace.

## Necessary deviations from earlier text

- The old FRIEND/UPDATED/NEW_PUBLIC 50/25/25 lottery was superseded by
  guaranteed Friends plus roughly 50/50 ordinary remaining slots.
- The old live Friend Route concept remains separate; new explicit sharing is
  an independent snapshot delivery and does not grant Fog/Cairn/Activity data.
- The old Activity Detail Save as Route entry was removed only after the Routes
  import path was wired and verified.
- Discovery qualification moved out of Activity tracking callbacks into the
  shared accepted-presence synchronization path. This removes duplicate
  per-screen/per-Activity side effects without altering tracking truth.

## Honest limitations / unproven assumptions

- Web visual evidence uses production React Native Web screens but lacks a
  Mapbox token; `Map unavailable` is an environment gate, not proof that native
  maps fail.
- Provider responses in deterministic Route tests are captured/fixture data;
  no claim is made about every bridge, trail or access restriction.
- Migration 046 was rehearsed locally on a legacy fixture, not on production.
- Full repository TypeScript remains nonzero; selected gates pass and the
  overnight-touched Route/B4 files add no listed TypeScript errors.

