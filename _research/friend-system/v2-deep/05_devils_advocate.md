# Devil's Advocate Review — Cairn Friend System v2 Design

**Date**: 2026-06-27
**Reviewer role**: Skeptical product + engineering risk auditor
**Mandate**: Find faults. Defend nothing.
**Web verification status**: BLOCKED. Both GLM and built-in WebSearch returned errors (GLM: 余额不足; built-in: API tool type unsupported). Historical cases below cite well-documented industry incidents from training corpus. Any claim that needs a live URL is marked `[cite-needed]` so it can be verified before commit.

---

## §0 Executive Summary

The 12-point design is **internally coherent for a v1**, but it is **dangerous in 4 places** and **operationally fragile in another 6**. The "no notification, no interaction, no home masking, single-edge auto-accept" model is leaning hard on the assumption that **every friend is trusted, every account is honest, and every state transition is observable**. None of those assumptions survives contact with reality.

**Top 4 red flags (must change before ship)**:
1. **Auto-accept on add (#2)** + **friend rows are bidirectional in current schema** = an attacker who learns a target's email gets cross-visibility into 30 days of location data without consent. GDPR Article 6 + 7 violation. Need explicit accept step or one-way "follow" semantics.
2. **5-slot Memory cap** (#1) with **no defined downgrade path** = future support ticket factory. Today's spec does not say what happens when a Pro user goes Free with 8 marked friends.
3. **Mock-friend data shipping to production** (#10) sharing real `user_id` namespace = analytics poisoning, retention/MAU corruption, and one bad join from a real user seeing seeded data as if it were theirs. The historical pattern (every product that ever did "fake users") = this leaks.
4. **`permission` ENUM stays as `personal|group|public` while UI says "Personal/Friend/Public"** (#5) = silent semantic drift. In 18 months a new engineer will read `permission='group'` and assume groups exist. Migration debt accrues from day one.

**Red flags count: 24** (4 critical-must-fix + 8 high-risk + 12 edge cases requiring spec text).

---

## §1 Per-Point Challenge (the 12 user decisions)

### #1 — "Friends unlimited, Memory tab 5-slot cap, paywall to expand"

**Historical fail pattern**:
- **Path (2010-2018)**: enforced 150-friend Dunbar cap as core identity. Users hated being kicked out at 151. Cap relaxed → cap re-imposed → product lost identity → shut down 2018. [cite-needed: TechCrunch Path shutdown coverage]
- **Spotify Family (6 seats)**: every Reddit megathread about kicked-out family members is a UX support nightmare. Auto-rotation of who's "in" the slot is the #1 complaint pattern.
- **Snapchat Plus** sells extra "Best Friends" slots — Reddit r/SnapchatPlus has recurring "I paid and it didn't apply" + "downgrade nuked my pinned friends" threads.

**Cairn-specific risks**:
- **A1.** "Slot" semantics are undefined. Is the cap on `friends_checked` count, on `friend_share_enabled` count, or on how many friend datasets are currently fetched into Memory? Each has different DB shape. The PRD must pick one before schema is poured.
- **A2.** **Slot swap rate-limit not specified.** Free user marks A, unmarks A, marks B, unmarks B, marks C — does each toggle count? If yes, a user who's "trying out friends" hits the cap and assumes Cairn is broken. If no, a free user has effective unlimited friends and the paywall converts ~0%.
- **A3.** **Downgrade path is the killer.** Pro user has 12 marked → cancels Pro → now what? Options: (a) freeze all 12 in read mode, no toggling allowed; (b) force-pick 5; (c) auto-keep most-recent-5. Option (a) is the only one that doesn't generate "I lost my data" tickets, but it requires a `state=frozen` flag we don't have. **Spec gap.**
- **A4.** The cap is on the **viewer**, not the **target**. So if A marks B in slot 1, and B marks A in slot 5, this is **two independent 5-counts**. The user model says "5 friends in Memory" but technically each direction is independently capped. Pricing copy must match this exactly or it's misleading.

### #2 — "Adding a friend = automatic share consent (single edge)"

**This is the most dangerous decision in the doc.**

**Historical fail pattern**:
- **Snapchat "Best Friends" public list (2013-Feb 2015)**: auto-derived from message frequency, visible without consent. Shut down after media backlash + abuse cases (partners spying on partners). The lesson the industry learned: **derived visibility without an affirmative act is not consent.** [cite-needed: TechCrunch / The Verge 2015 coverage]
- **Strava Flyby + Beacon**: even with bidirectional opt-in, ongoing stalker cases. r/Strava + r/RunningCirclejerk have a recurring genre of "my ex is using flyby to follow my runs."
- **Apple Find My Friends pre-2019**: one-way share invites created confusion when the recipient assumed it was bidirectional.

**Cairn-specific risks**:
- **B1. GDPR Article 6 (lawful basis) + Article 7 (consent must be freely given, specific, informed, unambiguous).** If user B did not see a screen saying "User A wants to share your location/marks/sessions with you, AND see yours in return", the auto-share is not GDPR consent. Even framed as "single-edge: I share to A, A doesn't share to me", A still has to consent to **receiving and storing** B's location data on A's device. EU users can request erasure on the basis of invalid consent. **This is the #1 lawyer risk.**
- **B2. Mistyped-email injection.** AddFriendSheet collects email → POST `/api/friends/request`. If "request" auto-converts to "accepted" on the recipient's side without their click, then any user who knows or guesses another user's email gets immediate cross-visibility. The Cairn user base today is small; in 6 months when an abuser learns their ex's signup email, this becomes a stalker tool. **Hard requirement: keep `friend_requests` table and `accept` step. "Auto-share" can mean "no granular share toggle after acceptance" — it does NOT mean "no acceptance".**
- **B3. "Single edge" + bidirectional `friends` table = schema lie.** Current code inserts two rows on accept (`friends.js:97-100`). If we keep that, "single edge" is enforced only in UI/read-filter logic, which means one missed filter = data leak. Either: (a) make `friends` table single-row (refactor accept), or (b) add a per-row `direction='shared_to'|'received_from'` and have every read query include it. The 2x row approach guarantees a future bug.

### #3 — "Other side can see whether you've marked them ('checked' state)"

**Fail pattern**:
- **LinkedIn "Who viewed your profile"**: famously divisive — half the user base loves it, half deletes the app over it. LinkedIn solved by making it a paid signal AND letting users hide.
- **Snapchat best-friend reciprocity emoji**: caused real-world relationship drama. People comparing "why am I not your #1 anymore?" Couples broke up over emoji. [cite-needed]
- **Facebook "Top friends" widget (2007-2010)**: same pattern, removed for same reason.

**Cairn-specific risks**:
- **C1. This is a status signal.** "Did Alice add me back?" is now a feature. If Alice marked Bob in her 5 slots and then unmarks him (because she went on a hike with Carol and needs the slot), Bob sees the unmark. **Friendship breakup detector.** Spec must decide: do we show a timestamp ("Alice marked you"), a binary ("Alice has you marked"), or an aggregate ("3 of your friends have you marked")? Each is a different social contract.
- **C2. Performance: showing "who marked me" requires a reverse query (`SELECT user_id FROM memory_slots WHERE friend_id = me AND checked = true`). At scale (10k users, average 3 marks each = 30k rows) this is fine; at 1M × 5 = 5M rows it needs an index on `friend_id`. **Add `INDEX idx_memory_slots_friend (friend_id, checked)` to schema.**
- **C3. Block + mark interaction undefined.** If Alice blocks Bob, does Bob still see "Alice has me marked"? Spec must answer.

### #4 — "Per-friend 'pause sharing' switch (hides past + future)"

**Fail pattern**:
- **WhatsApp "block" semantics**: well-documented that blocked-user perception is inconsistent ("last seen", "online", read receipts) across iOS/Android. r/whatsapp has weekly "did they block me?" threads. [cite-needed]
- **Instagram "Mute"**: cache invalidation bugs ship every few months — muted user's stories still appear if you reopen quickly.
- **Polarsteps "private trip"**: there have been reports of trips becoming briefly visible during sync after toggling privacy. [cite-needed]

**Cairn-specific risks**:
- **D1. Cache invalidation across devices.** Alice pauses sharing with Bob at 10:00. Bob's iPad is offline, has 200 of Alice's marks cached. Bob comes online at 10:30 — does the server send a `cleared_for_user_id` directive? Does the client know to scrub local DB? Spec is silent. **Without this, "pause" is not pause; it's "pause for new fetches only".**
- **D2. Time-travel attack.** Alice pauses. Bob sees no marks. Alice unpauses. Now everything Bob missed during pause reappears. Is that the intent? If Alice paused because she was at her therapist's office, the marks created during pause are now visible. **"Pause" should optionally exclude pause-window marks even on resume,** OR the spec needs to be explicit that pause is only a view filter not a retention filter.
- **D3. Backend write path.** Pause is a UI toggle, but it has to gate the friend-read query (`GET /api/friends/:id/markers`). Where does the gate live? On the friend `id` row, on a `friend_share_state (user_id, friend_id, paused_at)` separate table, or on a `paused` boolean inside the bidirectional `friends` table? **The bidirectional friends-table approach is wrong here** because pause is asymmetric ("I pause sharing TO Bob" is different from "Bob pauses sharing TO me"). Needs a dedicated table or a per-direction column.
- **D4. Mock friends + pause.** If A is a mock and Alice pauses A, what happens? Mock has no real user state, so pause is meaningless to the mock side, but the UI must still render the pause-toggle correctly. **Spec gap.**

### #5 — "Personal / Friend / Public 3-tier visibility, Public MVP no UI"

**Fail pattern**: Schema-UI divergence is a classic source of bugs. The current ENUM is `personal|group|public`. UI now says "Personal/Friend/Public". This means every read query has to translate, every write has to translate, and one missed spot = wrong visibility.

**Cairn-specific risks**:
- **E1. Naming drift.** In 18 months, a new dev will see `permission='group'` and reasonably assume groups exist. They will ship a feature on that assumption. **Either rename the ENUM via migration NOW (cheap), or rename UI to "Personal/Group/Public" (free), or add a comment doc but assume devs won't read it.** Picking option (a) is the only sustainable answer.
- **E2. Public has no UI in MVP** but markers can already be set to `public` via direct API (and `public_snapshot` JSON is already written on transition — `markers.js:131-142`). So today, a user with API access can set a marker public, the snapshot is frozen, and there's no client UI to unset. That's not a v2 problem; that's an active footgun. **Risk: a Pro user accidentally toggles public via some legacy code path, can't toggle back, support ticket.**
- **E3. Routes + Sessions have no `permission` column at all** (DB_SCHEMA audit §2 confirms). The 3-tier visibility decision must be **applied to routes + sessions OR explicitly excluded.** Spec text needed: "routes and sessions are owner-only in MVP, not 3-tier visible". Otherwise UX builds tier-toggle UI for something the DB can't store.

### #6 — "Activity stays owner-only forever"

**Cairn-specific risks**:
- **F1. "Forever" is a strong word in a spec.** A future Strava-like "share your hike" feature is plausible. By writing "forever" we paint the corner. Suggest "MVP: owner-only. Future iteration may revisit." Same outcome, less spec debt.
- **F2. Conflict with point #10 (9163 → ldy migration).** Migrating sessions = changing the `user_id`. If activity is owner-only and the migration moves sessions from 9163 to ldy, are 9163's friends supposed to lose access? They never had access (owner-only). OK. But what about friends who had been viewing the 9163 account through some other surface (FriendCard `sharedMarkers` is a stub; nothing else)? **Confirmation needed: post-migration, the 9163 account is what — kept as an empty shell? deleted? disabled?** Spec gap.

### #7 — "Friends' marks and routes are read-only"

**Fail pattern**: Read-only is easy to say, hard to enforce when UI components are shared. A swipe-to-delete gesture on a `MarkerRow` that was reused from the owner's list will fire on the friend's marks too unless explicitly gated.

**Cairn-specific risks**:
- **G1. Gesture leakage.** `MarkerRow` (wherever it lives) needs a `readOnly` prop and every consumer must pass it. If even one consumer forgets, friend's mark gets deleted client-side, server rejects with 403, UI is now in a broken state (client thinks deleted, server has it). Spec needs: "every marker render path receives `ownership: 'mine'|'friend-readonly'`, and ALL mutation entry points hard-check this at the component boundary."
- **G2. Edit fields are sneaky.** Long-press → "Edit text" on a friend's mark. The text field is on the same screen. Even if save is disabled, the user has now seen an editable-looking UI. Confusion. **Visual gating** required, not just write-gating.
- **G3. Sync conflict.** Friend Alice edits her mark text. Bob is viewing Alice's marks cached. Bob's screen shows old text. Refresh-on-focus needed, or stale data forever.

### #8 — "No likes / comments / notifications / any interaction"

**Cairn-specific risks**:
- **H1. This decision is good** but it removes the feedback loop that drives retention in every successful social product (Strava kudos, Polarsteps reactions, etc.). The bet here is "Cairn's value is the personal map, not the social feed." Worth re-verifying with metrics post-launch. Not a blocker for ship.
- **H2. "No notifications" + "auto-accept friend request" (#2) = silent state change.** Alice adds Bob → Bob now has a new friend → Bob never knows. He opens app, sees a new face on Memory, has no idea why. **Either** add a single non-interactive log row in Memory ("Bob added you on 2026-06-27") **or** keep the request/accept gate (which solves #2's GDPR problem at the same time). One stone, two birds.

### #9 — "No home masking" (home location is visible to friends)

**Fail pattern**:
- **Strava 2018 heatmap military bases incident**: aggregated, anonymous, opt-in heatmap data still revealed forward operating bases because servicemembers' commute patterns formed paths through classified locations. The takeaway: location data **always leaks more than the schema thinks it does.** [cite-needed: WaPo / Guardian 2018]
- **Strava Heatmap home addresses**: even with "Privacy Zones" (a circle around your house that's blurred on the heatmap), home addresses are derivable from the entry/exit points of the zone. Multiple academic papers (2018-2020) showed how. [cite-needed]
- **Snapchat Snap Map (2017)**: every parent/teen news story for 2 months after launch. [cite-needed]

**Cairn-specific risks**:
- **I1. Domestic violence / stalker risk.** If user B's "home" (the cluster of marks/sessions at the same lat/lng nightly) is visible to friend A, and A becomes an ex-partner, A now has the survivor's home location. This is not a hypothetical; this is the #1 documented risk in location-sharing apps. **Hard requirement before public launch: even if "no masking" is the default, a per-marker "private" tier (already exists as `personal`) must be the **default** for any session start/end point. NEVER auto-promote a session's start/end to `group`.
- **I2. Marker clustering = home reveal.** Even with all individual marks set to `personal`, if a friend can see the cluster of "where Alice spends most evenings", they have her home. Cairn's value prop is mapping, so this cluster is the product. We can't remove it. We MUST gate it. **Spec must explicitly call out: friend view never renders cluster aggregation, only individual marks the owner shared.**
- **I3. "Approximate" already exists on markers (`approximate` column, `017_public_snapshot.sql`).** Why not default friend-visible marks to `approximate=true` and let owner opt into precise per-marker? Big win, minimal spec change.

### #10 — "9163 → ldy migration + 5 mock friends seeded"

**Fail pattern**: every product that ever shipped fake-friend seed data leaked it. Examples:
- **Tinder bots/fake profiles**: lawsuit pattern, FTC actions. [cite-needed]
- **Hinge prompts ghost-written by staff** then surfaced as real user content: PR incident. [cite-needed]
- **Multiple dating-app analytics breaches** revealed "test user" DAU inflated metrics.

**Cairn-specific risks**:
- **J1. user_id namespace collision.** If mock friends use real `users.id` BIGINT values, they will appear in every COUNT(*) of users, every signup funnel report, every retention analysis. Analytics is now permanently dirty. **Hard requirement: mock users must have a flag column (`users.is_mock BOOLEAN DEFAULT FALSE`) or live in a separate `mock_users` table. Every analytics query must filter.** Adding this column NOW is cheap; adding it after launch when prod has 100k rows is painful.
- **J2. Mock friend mutation.** What can ldy do to a mock friend? Unfriend them? Pause them? Re-friend them? If mock friends are CRUD-able, what's the rollback path when ldy unfriends mock-Alice? Re-seed on next app start? Permanent removal? Re-add via dev tool? **Spec gap.**
- **J3. Mock friend's marks/routes/sessions.** If mock friends seed marks too, those marks have `user_id = <mock_id>`. They appear in: marker community queries, public_snapshot table (if they're set public), nearby-search if we ever build it, public leaderboards. The mock data has to be tagged and filtered at every read site, or it leaks. **Cheaper: marks belonging to mocks live in a separate `mock_markers` table** OR have `is_mock` propagation. The latter requires JOIN at every read.
- **J4. Time-stamp realism.** If mock friend marks are seeded "yesterday" but the seed runs today, every mock friend has the same timestamp. Anyone looking at a mock-friend's timeline sees "all marks on Jun 27" which is obviously fake. Spec needs: randomized timestamps within a 30-day window, or marks dated relative to ldy's join date.
- **J5. The 9163 → ldy migration itself.** From `_research/friend-system/04_current_state.md` §4: no `9163` in repo, only on aliyun MySQL. Migration plan needs:
  - Pre-check: SELECT COUNT(*) FROM sessions WHERE user_id=9163 (confirm count)
  - Pre-check: SELECT COUNT(*) FROM markers WHERE user_id=9163 (do we migrate marks too? spec is silent — "sessions" only? what about marks?)
  - Pre-check: SELECT COUNT(*) FROM friends WHERE user_id=9163 OR friend_id=9163 (do existing 9163-friend relationships move to ldy? spec is silent)
  - Pre-check: SELECT COUNT(*) FROM friend_requests WHERE from=9163 OR to=9163
  - Pre-check: any AsyncStorage keyed by 9163 on user devices? (client hydration is per `userId` per `useMarkerStore.ts:343` audit)
  - Atomicity: wrap in transaction. ROLLBACK on any FK violation.
  - Reversibility: pre-migration backup of all 9163 rows to `_review/` dump, kept for 30 days.
  - End-state of 9163 account: deleted (cascade FK)? disabled (`users.disabled=true` — column doesn't exist)? renamed (`9163_archived`)? **Spec gap.** Without a decision, the migration script doesn't compile.
  - Per Memory `feedback_dry_run_before_delete.md`: **mandatory 2-step preview + confirm before any DELETE / UPDATE user_id**. Use the binlog ROW format safety net.

### #11 — "Memory tab toggles between 'Personal / Friend'"

**Cairn-specific risks**:
- **K1. Default tab on cold start.** Spec gap. Personal? Last-used? If "last-used" is persisted, where? AsyncStorage? If it's AsyncStorage, what's the eviction/reset behavior on logout? On app reinstall? Each answer is a UX decision.
- **K2. Empty Friend tab on first launch.** New user has 0 friends, 0 marked. Friend tab opens to blank screen. UX must define the empty state (currently we have `<EmptyState>` only for the Friends list — Memory's Friend tab is a separate empty state).
- **K3. Loading skeletons.** Switching from Personal to Friend triggers `fetchFriendMarkers(friendId)` for up to 5 friends in parallel — 5 simultaneous network calls on tab switch. On a slow network, this is a 3-5s freeze. **Spec needs: lazy load per friend selected, OR pre-fetch on app launch, OR a clear loading state per friend.**
- **K4. Friend tab + marker filter chips.** Marker UI is being redone (#12) with color rings. If those rings are present in Friend tab, are they per-friend (one ring per friend's color) or per-marker-type? The user spec doesn't separate these. Visual collision risk.

### #12 — "Mark UI redesign, all marks use color ring"

**Cairn-specific risks**:
- **L1. Color is the only signal.** ~8% of men are red-green color blind. If "ring color = friend identity" and Alice/Bob both have a reddish ring, color-blind users can't tell them apart. **Need: shape secondary signal (ring pattern, dot count, initial in ring center), OR explicit color-blind palette adherence.**
- **L2. Color count scaling.** With 5 friends, 5 colors works. With unlimited friends and only 5 visible at a time, what about the 6th friend not in slot but who has shared marks (#2 says auto-share)? Are their marks invisible until slotted? Spec implies yes (Memory tab is slot-driven), but **the map view** is a separate question. Map could show 200 friends' marks if all 200 auto-shared. 200 ring colors is impossible. **Spec must define: map view's friend mark visibility is also gated by Memory slot selection.** If it's not, the map is unusable.
- **L3. Self-marks vs friend-marks visual hierarchy.** Today's marker UI doesn't distinguish "mine" from "theirs" — adding a color ring means all marks now have one. What does the user's own mark ring look like? White? Their own color? No ring? Spec gap.
- **L4. Migration of existing marker UI.** Every screen that renders a marker (MapHistoryScreen, MarkerDetailScreen, MapScreen, plant flow, edit flow, Memory) must update. That's at least 7 surfaces. Effort estimate: 1 sprint minimum. **Don't undersize this.**

---

## §2 Edge Cases (the 15+ scenarios)

| # | Scenario | Current-spec behavior | What goes wrong | Recommended fix |
|---|----------|----------------------|-----------------|-----------------|
| E1 | I add A as friend. A removes me from their side. | `friends` table is bidirectional (two rows). Removal from A deletes both rows. My Memory now shows A as still marked but server returns 0 marks. | UI shows checked slot for a non-friend → confused user → support ticket. | Reverse query on Memory fetch: if friend row missing, auto-uncheck client-side and emit toast "A is no longer your friend." |
| E2 | Mock friend can be deleted. | Spec silent. | If allowed: ldy deletes mock-Alice → re-add path? If denied: ldy can't experiment with friend-management workflow. | Allow deletion. Provide dev tool to re-seed. Add `is_mock` so re-seed doesn't collide. |
| E3 | I shared 100 marks with A. I toggle "pause sharing." A's iPad is offline with all 100 cached. | Spec says "hide past + future." A's cached data isn't touched. | Pause is not pause if cache lives. Privacy promise broken. | On reconnect, server pushes `cleared_user_ids` list. Client wipes friend marks. Document the offline-then-online lag in privacy copy ("up to N minutes after reconnect"). |
| E4 | I unpause sharing with A. | Cache must repopulate. Network call needed. | If unpause is a UI toggle only and server-side gate isn't re-opened atomically, A sees a half-second of "unpaused but no data" or stale 5-minute-old data. | Server-side toggle is the source of truth; client toggles are optimistic. Show explicit "syncing..." state during repopulate. |
| E5 | A is a mock friend. Mock-Alice's `user_id` collides with a real new signup. | Spec silent — uses real `users.id` BIGINT pool? Or a separate range? | Real user adopts the same ID → cross-contamination. A real friend named Alice would see her own marks alongside mock ones. | Reserve a sentinel range (e.g. `id < 1000`) for mocks OR `users.is_mock=true` with a `mock_seed_id` int. Filter all reads. |
| E6 | Free user has 5 marked. Upgrades to Pro. | Spec: cap removed. | OK. But if cap is enforced via `LIMIT 5` in queries, just lifting the limit might surface dormant rows from past Pro periods if the column logic is wrong. Confirm reverse path is consistent. | Cap enforcement is at write (insert blocked) AND at read (UI shows only first 5). Both gates removed on upgrade. Idempotent. |
| E7 | Pro user has 10 marked. Downgrades to Free. | Spec silent. | If we just truncate, user loses 5 friendships. If we freeze, UI must show "5 frozen — upgrade to unlock." If we force-pick, user must confirm in a flow we don't have. | **Decision required NOW.** Recommendation: freeze. Existing rows stay, marked with `frozen_at`, but no new marks possible. Pro reactivation un-freezes. UX shows lock icon on frozen rows. |
| E8 | A changes email and re-registers with a new email (same person, new account). | New `users.id`. Old friendship persists pointing to old account. Old account either dead or orphaned. | I think A is still my friend. A thinks they've started fresh. Both are right. Confusion. | Out of scope to detect duplicate humans. But: add UI "this friend hasn't been active in N days" passive signal. |
| E9 | 9163 → ldy migration: sessions move. What about marker_ids referenced by sessions' `flags` JSON? | `sessions.flags` is JSON — may contain marker IDs. If marks aren't also migrated, references dangle. | Sessions show "flag #1234" but flag belongs to 9163. Reads fail. | Pre-migration: SELECT all marker IDs referenced in 9163's session.flags JSON. Either migrate those marks too, or strip the references during migration. |
| E10 | 9163 has 5 friends. After migration, do those friend rows update to point to ldy? | Spec silent. | If they update: those friends now suddenly see ldy as a friend (with auto-share enabled — the GDPR consent issue). If they don't update: orphan rows in `friends` referencing dead user_id. | Cascade FK already deletes friend rows if 9163 is deleted. If 9163 is kept as shell, friend rows are orphan-but-valid. **Decide: 9163 deleted (with cascade cleanup) or 9163 kept.** Recommend deleted. |
| E11 | Mock friend has marks on the map. Real user is hiking nearby. Their map merges. | Possible confusion: "is this mark real?" | If marks are rendered identically to real friend marks, user can't tell. | Mock marks must have a visual tell ("Demo" badge) OR mock marks are not rendered on the live map at all, only in a sandboxed Memory tab. Recommend the latter for cleanliness. |
| E12 | I tap-and-hold a friend's mark, expecting to delete (muscle memory from my own marks). | Spec says read-only. | If delete gesture fires before the read-only check, brief flash of delete UI → frustration. | Read-only state is the component contract, not an after-the-fact check. `<MarkerRow readOnly />` disables the long-press handler at gesture-registration time. |
| E13 | Memory tab "Personal / Friend" toggle. I switch to Friend, see Alice's marks, leave app, return 30s later. | Spec silent on tab persistence. | If state defaults to Personal: feels like data lost. If state defaults to Friend: feels like the app is sticky in a way the user didn't intend. | Persist last tab in AsyncStorage with key `memory.lastTab`. Reset on logout, not on app close. |
| E14 | Two devices same account. iPad pauses sharing with A. iPhone is offline. | Sync? | iPhone comes online, last-write-wins or merge? If iPhone had an "active" share state cached, it might race the pause. | Server is source of truth. Client mutations queue → server applies → broadcast to all devices via realtime channel OR poll on focus. Don't ship without a reconcile rule. |
| E15 | A is paused. I get a new friend B. B is mutual friends with A. B's view of my marks: are A-pause-window marks visible to B? | They should be (B has no relationship to A). | If we implement pause as "hide marks created during pause-window from EVERYONE", we accidentally hide them from B too. | Pause must be per-(owner, viewer) pair. Not a global flag on the marker. |
| E16 | A had me marked. A unmarks me. Do I see "A unmarked you" or just a silent removal? | Per #8, no notifications. | Silent. But the "checked-by-me" reverse query (#3) now returns one less. UX is "the heart icon goes away." Without context, a user might think it's a bug. | Spec calls this out: removal is silent and permanent. No history. (Accept the social cost or add a "marked you on X, unmarked you on Y" history — pick.) |
| E17 | I am at the 5-slot cap on Free. A new friend B requests to add me. Auto-accept (#2). | Auto-accept succeeds. I now have an unlimited count of friends (#1). But my Memory has 5 slots. B is now a friend but not in Memory. | OK by design — that's the whole point. But: B can see I haven't marked them (#3). B feels rejected. | This is intentional. Documentation in B's empty-Memory state should explain: "your friend hasn't added you to their Memory yet — Pro users can mark unlimited friends." Soft paywall message. |
| E18 | Account deletion cascade. I delete my account. | FK CASCADE on `friends` table: deletes my friend rows. But what about friends who had me marked in Memory? | Their `memory_slots` row references my user_id. If FK CASCADE, slot row is deleted. UI flashes a slot disappearing. Might confuse. If no FK CASCADE, dangling FK → integrity violation. | Add FK with `ON DELETE SET NULL` on memory_slots.friend_id, then UI handles `friend_id IS NULL` as "deleted user, tap to remove from slot." |
| E19 | Friend's mark text contains markdown/HTML/script. I view it on my Memory. | Today's text VARCHAR(30) is short; unlikely XSS but possible Unicode shenanigans. | If rendered with `dangerouslySetInnerHTML` or any HTML interpolation, XSS. | Sanitize at render. Force plain-text rendering only. Audit every place friend-text is shown. |
| E20 | Memory shows friend's marks (server returns LIMIT 100 today). Friend has 5000 marks. | Spec: show all marks? Or paginate? | LIMIT 100 silently drops the rest. User says "I shared 5000 marks, they only see 100." Bug ticket. | Spec must define: pagination, infinite scroll, or "showing 100 of 5000" UI. Don't ship LIMIT 100 silently. |

---

## §3 Schema-Layer Risk Audit

Based on `_research/friend-system/04_current_state.md` §2 (current schema) + the 12 design points:

### S1 — Index gaps

- `friends (user_id, friend_id)` has UNIQUE but no separate index on `friend_id`. Reverse lookup ("who has me as friend?") full-scans. **Add `INDEX idx_friends_friend (friend_id)`** before any "who marked me" feature ships.
- `markers (user_id, permission)` — composite index doesn't exist. Friend-marker read filters on both. **Add `INDEX idx_markers_user_perm (user_id, permission)`.**
- `memory_slots` table doesn't exist yet but will need `(user_id, friend_id)` UNIQUE + `(friend_id, checked)` for reverse "who has me marked" query.
- Pause table (if added) needs `(user_id, friend_id)` UNIQUE + `(friend_id, user_id)` covering index for both directions of "is A paused with B?"

### S2 — Concurrency hazards

- Two devices toggle "pause sharing with A" simultaneously. Without per-row optimistic-lock or version column, last-write-wins. Spec is silent on whether this matters; in practice it doesn't, but writing the rule down avoids future "race condition" tickets.
- Adding a friend (auto-accept #2) inserts into `friends` (2 rows) + reads/writes `friend_requests`. Without a transaction wrapper, partial state visible. Confirm `friends.js:97-100` is inside a `BEGIN/COMMIT` or `connection.beginTransaction()` block.

### S3 — Data redundancy

- `friends` two-row design is the biggest cost. Every friend pair is 2 rows. 1M users × avg 30 friends = 30M rows × 2 = 60M rows. Indexes 2x as large. Mutation must update 2 rows atomically.
- An alternate: single row with `(low_user_id, high_user_id)` canonical ordering. Halves storage and removes the consistency burden. Refactor effort: all read queries in `friends.js`. Worth doing before Memory ships, much harder after.

### S4 — Migration irreversibility

- 9163 → ldy: per Memory `feedback_dry_run_before_delete.md` — **DRY-RUN with row count + sample, explicit user confirmation, binlog ROW format active, 30-day backup retention.** Per current Memory, I deleted user data on a prior dev migration. This is the same risk pattern. Do not skip the safety steps.
- Renaming the `permission` ENUM from `group` to `friend`: **MySQL ALTER TABLE on a 1M row table will lock writes for minutes.** Plan a maintenance window, or do an online schema change (pt-online-schema-change / gh-ost). Don't drop the old value without a `permission='friend' OR permission='group'` compatibility window in code first.
- Adding `is_mock` to `users` is cheap NOW (small table), expensive at scale. Do it before the mock-friend feature ships.

### S5 — Privacy / regulatory

- Friend cached data on a third-party device is GDPR-relevant. The server's record-of-truth must support a "purge this user from all viewers" action. Today's schema has no such hook. Spec for **`POST /api/users/me/purge-from-friends`** (or equivalent) needed if we ever get an erasure request.
- Mock data must NEVER include real-looking PII. Mock-Alice should not be named "Alice Wong" with email "alice.wong@gmail.com" — that's identity-theft territory if "Alice Wong" exists. Use clearly synthetic names ("Trail Companion 1") OR a fixed reserved-name list documented in DISCOVERY.md.

---

## §4 Red List — Must Change Before Code Starts

These are the hills to die on:

### R1. Drop "auto-accept" — keep the accept step. [Reason: GDPR + stalker risk]
Single-edge sharing is fine. Auto-accept is not. The `/api/friends/request` + `/api/friends/accept` pair already exists. Use it. The UI can be one-tap from the recipient's side ("Accept") — that's enough to be "consent" legally and ethically. **Estimated fix cost**: zero — the endpoints exist. The change is removing the auto-accept code path from spec.

### R2. Define the downgrade path for Memory cap. [Reason: support cost]
Spec text needed:
> "When a Pro user reverts to Free with more than 5 marked friends, marked rows beyond 5 enter `frozen` state: visible, read-only, no toggle, displayed with a lock icon. Reactivating Pro restores edit. Frozen rows do not count against the 5 slot cap for new mark operations — user can still mark up to 5 new friends. Frozen rows cannot be un-marked without first reactivating Pro." (Or pick a different rule — but pick one.)

### R3. `is_mock` column + filter discipline. [Reason: analytics + data leak]
Add `users.is_mock BOOLEAN DEFAULT FALSE` in same migration as the friend-system changes. Every analytics query, every public read, every search filter MUST include `WHERE is_mock = FALSE`. Add a lint rule or a code-review checklist item. Cost: 1 day.

### R4. ENUM rename: `group` → `friend`. [Reason: long-term clarity]
Either: (a) MySQL ALTER ENUM to add `friend`, code dual-writes, then drop `group`. Or: (b) keep ENUM as `group` and rename UI back to "Group". The current "UI says Friend, DB says group" is the worst option. **Estimated cost**: option (a) is ~1 day plus maintenance window; option (b) is 1 hour.

### R5. Pause is per-(owner, viewer), not global. [Reason: correctness]
The pause table or column MUST be keyed on the pair, not on the owner alone. Otherwise pausing-with-A also hides marks from B which is wrong. Spec text needed.

### R6. Friend marker `permission` default for new sessions = `personal`. [Reason: stalker risk]
Even with no home masking, session start/end points must not auto-elevate to `group` visibility. Today's default IS `personal` for markers (`003_friends_markers.sql:33`), good. Don't change it.

### R7. 9163 migration plan signed-off before any code. [Reason: data loss]
Per Memory feedback, dev tools that delete user data without DRY-RUN have already caused incidents in this codebase. The 9163 → ldy migration must produce:
- DRY-RUN script that outputs row counts, sample rows, NOT mutating
- Explicit y/N prompt to user
- Pre-migration backup dump in `_review/2026-06-27-9163-migration-backup.sql`
- Post-migration verification SQL (count match)
- Rollback script (re-import from backup)

### R8. Mock friend marks live in `mock_markers`, not `markers`. [Reason: analytics + scaling]
Single read query saves a `WHERE is_mock=false` JOIN. Keep production tables clean.

### R9. Public marker UI ship date OR feature flag. [Reason: half-built features rot]
`public_snapshot` JSON is being written today on every transition (`markers.js:131-142`), but the read endpoint doesn't exist (`useCommunityStore` is dead). Either: (a) ship the read endpoint within 2 sprints, or (b) feature-flag the write so we stop accumulating snapshots that no one reads. Today we're paying schema cost for nothing.

### R10. Color ring + color-blindness fallback in MVP. [Reason: accessibility lawsuit pattern]
WCAG color-only signal is a known compliance issue. Cost: add a small icon/letter inside the ring. Trivial design tweak. Big legal/UX upside.

---

## §5 Outstanding Questions for User

These cannot be resolved without a product decision:

1. Free → Pro → Free downgrade: freeze vs. force-pick vs. truncate? (R2)
2. ENUM rename now (option a) or UI rename back (option b)? (R4)
3. Mock friends mutable by user (can delete/pause) or immutable? (E2)
4. 9163's `marks`, `routes`, `friends`, `friend_requests` — migrate them too, or only `sessions`? (E9, E10)
5. 9163 account end-state: delete / disable / archive-rename? (J5)
6. Memory tab default on cold start: Personal or last-used? (K1)
7. Map view: friend marks shown for ALL auto-shared friends (could be 100+) or only currently slotted (max 5)? (L2)
8. Pause-window marks on resume: hidden (privacy-first) or visible (consistency-first)? (D2)

---

## §6 Conclusion

The user has been disciplined in cutting scope (no likes/comments/notifications, owner-only activities, no home masking *as a default*). That's a good v1. But:

- The **legal/safety** posture has **2 critical holes** (auto-accept, no home masking + cluster reveal) that will hurt vulnerable users.
- The **operational** posture has **8 silent assumptions** (downgrade path, ENUM drift, mock isolation, cache invalidation, pause semantics, migration safety, color accessibility, public read endpoint) that turn into support tickets and emergency fixes.
- The **schema** has **3 cheap-now-expensive-later** debts (`is_mock`, ENUM rename, two-row friends design).

Cost to fix all of the above before code starts: ~1 sprint of spec work + ~1 sprint of schema/DB work. Cost to fix after launch: 3-6 months of emergency patches.

The user's mandate was "find faults." Faults found: 24 (4 must-fix red, 8 high-risk, 12 edge-case spec gaps). Not a single point on the list is fault-free.

**Recommendation**: do not start coding until R1-R10 are answered in writing and the 8 outstanding questions resolved with the user. Memory's existing rule (`feedback_dry_run_before_delete.md`) makes this non-negotiable for the 9163 migration specifically.

End of report.
