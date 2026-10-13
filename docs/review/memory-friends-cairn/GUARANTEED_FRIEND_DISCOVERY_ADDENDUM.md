# Queued decision update — guaranteed friend discovery and Route delivery

Recorded 2026-10-12 while the Memory/Friends/Cairn implementation checkpoint
was active. This file preserves scheduling authority without switching modules.

## Apply in the current Memory/Friends/Cairn checkpoint

- Eligible Cairns from a current accepted friend are deterministic acquisitions,
  whether the current audience is Friends or Public.
- Acquire every eligible Friend Cairn before ordinary capacity. More than three
  Friends may overflow the normal locality target, but one visit/presentation
  group still contains the batch.
- Fill remaining ordinary slots up to three from UPDATED and NEW_PUBLIC with an
  approximately 50/50 category choice, redistributing empty categories.
- Do not apply author-diversity suppression, popularity, or random omission to
  guaranteed Friend Cairns.
- Trusted accepted evidence, 50 m proximity, current authorization, moderation,
  Hide/Remove, immutable revision deduplication, and genuine revisit remain
  mandatory.

## Apply at the queued Routes checkpoint

- Activity Detail is factual/private and loses the Save as Route entry only
  after Routes > Create Route > Use an Activity is reachable.
- Preserve the conversion capability and never mutate source Activity truth.
- Explicit friend delivery stores an independent immutable recipient snapshot
  in Shared Routes. Exact repeat is idempotent; revised re-share creates a new
  delivery without overwriting earlier snapshots.
- Received snapshots grant no Activity, timestamp, Fog, Memory, Cairn, encounter,
  or friendship authority. Editing creates a recipient-owned copy.

Full acceptance requirements remain in the Owner addendum; this note is the
module-scheduling and implementation ledger entry.
