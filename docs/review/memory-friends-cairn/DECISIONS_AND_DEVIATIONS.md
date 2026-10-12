# Decisions, supersessions and deviations

Updated: 2026-10-13 Asia/Shanghai

## Applied supersessions

- Current accepted Friend Cairns are guaranteed when all evidence and
  authorization checks pass. The earlier FRIEND/UPDATED/NEW_PUBLIC 50/25/25
  lottery is removed. All Friend Cairns run first and may exceed the ordinary
  locality target.
- Remaining ordinary capacity is category-first UPDATED/NEW_PUBLIC at 50/50,
  renormalized when one category is empty. A configurable freshness advantage
  is capped at 20%; no ratings, ranking feed or popularity monopoly was added.
- Discovery has no global cooldown. Local visit persistence and presentation
  cadence are separate state machines.
- Activity is factual and private. Its Save-as-Route entry will be removed only
  when the equivalent Routes import entry is wired and tested in B3.
- Route delivery in B3 means an immutable recipient snapshot, not a live sender
  reference and not an extra Save Copy step.
- The master authorizes only bounded acquired-Cairn grouping/reader/cue/Home
  state integration in B4. It does not authorize a broad Home redesign.

## Current tunables

| Parameter | Default | Bound/meaning |
|---|---:|---|
| `MAX_CAIRNS_PER_LOCAL_VISIT` | 3 | ordinary optional target; Friend guarantee may overflow |
| `SAME_LOCALITY_EXIT_DISTANCE_M` | 120 m | visit departure/re-entry, never the per-Cairn radius |
| `SAME_LOCALITY_REVISIT_MINUTES` | 15 min | elapsed after a genuine departure in current implementation |
| per-Cairn discovery radius | 50 m | existing encounter policy, unchanged |
| max horizontal accuracy | 50 m | existing encounter policy, unchanged |
| min observations/span | 2 / 10 s | existing encounter policy, unchanged |
| `PRESENTATION_MERGE_WINDOW_SECONDS` | 20 s | presentation grouping only |
| `HAPTIC_MIN_INTERVAL_SECONDS` | 180 s | eligibility metadata only; no native effect here |
| discovery sound | off | no audio added |
| `CAIRN_FRESHNESS_MAX_BOOST_PERCENT` | 20% | hard maximum and default |
| `CAIRN_FRESHNESS_WINDOW_HOURS` | 168 h | linearly decaying optional-selection boost |
| Friend Memory delay | 1,800 s | later of trusted observation/server receipt, enforced in SQL |

## Deliberate bounded deviations

1. Same-locality revisit currently measures 15 minutes after recorded departure,
   which is at least as strict as the requested departure-plus-time contract.
   It prevents a too-early return from becoming eligible merely by waiting in
   place. Native GPS QA may tune values, not weaken the two-factor requirement.
2. Friend projection no longer silently truncates at 20,000 evidence rows.
   Correct complete history is preferred to undisclosed loss. This creates a
   measured scalability risk and needs pagination/incremental projection before
   very large production histories; no silent approximation was substituted.
3. MySQL temporal comparisons use SQL-produced Unix milliseconds rather than
   JavaScript parsing of timezone-less `DATETIME`. This was required because a
   Beijing process otherwise shifted UTC eligibility by eight hours.
4. A discovery request uses at most 400 fresh witness rows. This bounds online
   processing and covers the two-minute evidence window; no canonical points or
   Activity truth are rewritten.

## Unresolved product/policy conflicts

- A marker may be initially adjusted up to 50 m while Fog visualization uses a
  30 m accepted-presence radius. Guaranteeing that every adjusted marker is
  visibly inside Fog would require changing locked truth or geometry, so that
  promise remains blocked.
- Account deletion/retention policy is unchanged and remains an Owner gate.
- No production Mapbox terms conclusion is inferred from public documentation;
  account-specific storage/sharing terms must be confirmed before release.
