# User journeys and state matrix

## Create → persist

1. Standalone Plant acquires or reuses a qualified sample, allows pin adjustment, then opens the place-note editor.
2. Hike Plant preserves the exact Activity identity and return route. A current Activity coordinate is accepted only when finite, no older than 30 seconds, and accuracy is at most 100 m; otherwise Plant reacquires without ending the Activity.
3. Run retains its existing one-tap private, empty quick-Cairn path; it does not use the O88 note editor yet.
4. Submit calls `useMarkerStore.addMarker`. The optimistic/offline entity now carries an atomic provenance tuple: accuracy, capture time, source, and sample count. The backend accepts all four or none, rejects simulator provenance, future timestamps, and invalid Activity provenance.
5. The success state appears only after the store returns a committed or durable pending result. Offline copy explicitly says it is saved on the device and waiting to sync.

## Audience semantics

| State | Only me | Friends | Public |
|---|---|---|---|
| Create | Any authenticated creator | Any authenticated creator | Effective Public pilot, useful text, eligible Activity, policy/review path |
| Owner view | Immediate | Immediate | Immediate; pending/rejected/published status remains explicit |
| Other-person location/text | Never | Encounter acquisition path for eligible Friends; retained snapshot thereafter | Server-qualified encounter only; retained response uses coarse Public location |
| Offline create | Durable pending entity | Durable pending entity | Durable request may sync, but publication still requires server eligibility/review |
| Edit | Mutates owner marker | Creates a new immutable content revision for future acquisition | Creates a new revision and review/publication transition |
| Existing recipient after edit | N/A | Prior acquired revision stays; revisit may acquire later revision | Prior acquired revision stays; revisit may acquire later published revision |
| Owner delete | Removes owner marker | Stops future encounters; acquired immutable revisions remain | Stops future encounters; acquired immutable revisions remain |
| Recipient archive | N/A | Hides from normal collection, reversible by existing endpoint | Same |
| Recipient remove | N/A | Hides collection and suppresses future automatic encounters; no current in-app restore | Same |

## Encounter → read → later

The authoritative server `/api/cairn-memory/discover` transaction creates immutable recipient revisions and presentation groups. The client presentation store fetches those groups. Memory shows exactly one passive bottom card per group with `Open` and `Later`; `Later` acknowledges presentation but does not discard the acquired content. `Open` navigates to a single acquired detail where unambiguous, otherwise to `I found`.

Repeated discover calls are idempotent. A content update can create another retained revision and a restrained “A new page was waiting here” presentation. Prior versions are selectable in acquired detail. Author mutation or ordinary deletion does not overwrite a recipient snapshot.

## Read/update/remove vocabulary

- Owner detail: full note, place/source/audience/publish state, `Edit`, and `Withdraw and delete`.
- Edit: “Add a new version”; acquired old versions are explicitly preserved.
- Recipient detail: latest retained version plus earlier version navigation, source audience, anonymous/friend identity according to authorization, Thanks/report where supported.
- Archive: hide from normal library while preserving acquired history.
- Remove: hide and prevent automatic reacquisition; no in-app undo currently exists.
- Author delete/withdraw: future acquisition stops; already acquired retained versions remain.

## Failure and recovery

| Condition | Current behavior |
|---|---|
| Location stale/inaccurate | Does not use Activity fast path; GPS acquisition UI remains in the flow |
| Network failure during create | Draft/pin stay owned by Plant; offline entity/outbox is durable where queueing succeeds |
| Duplicate retry | Client UUID idempotency returns the existing marker; provenance must match immutable replay |
| Public ineligible | Disabled with an exact reason before submit; backend remains authoritative |
| Encounter card dismissed | Acquired item remains in `I found` |
| Account switch | stores clear at the account boundary; notification target is reauthorized against logged-in owner |
| Notification unavailable | Acquisition and in-app presentation continue independently |
| Source withdrawn/moderated | New acquisitions stop; retained presentation follows server status rules, not a live mutable source reference |
