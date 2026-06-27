# Cairn Friend System — Brainstorm & Recommendation

**Status**: Brainstorming. NOT for development yet. User sign-off required before any code.
**Author**: Synthesized from 4 parallel research reports (DS strand model / hiking apps / tiering decision / Cairn current state).
**Date**: 2026-06-27

---

## 0. User Sign-Off Inputs (this session)

| Decision Point | User's call | Source |
|---|---|---|
| Tiering of friends | NO — flat, 5 friends all equal | Initial brief + research consensus |
| Paywall at 5 friends | DEFERRED — open it up, decide later | Q1 this session |
| Bidirectional vs follower | **Bidirectional friends** — "好友都一定是关系很好的，不是路人就可以 follow 的" | Q2 this session |
| Per-mark person-level targeting | NO — 1-tap shares with all 5 friends | Q3 this session |
| **Product soul (NEW)** | **"我们可以一起探索 memory 是核心"** — friends collaboratively expand a shared memory map | Q2 this session |

**This last input is the most important thing surfaced in this session.** It re-frames everything below.

---

## 1. Product Soul: "Co-Exploration of Memory"

User's exact words: **"我们可以一起探索 memory 是核心"** (the core is that we can explore memory together).

This is deeper than "share posts with friends". It is a Death Stranding strand: **the act of walking somewhere itself contributes to a shared canvas, and friends extend that canvas with their walking**.

What this re-frames:

- A friend isn't a **viewer** of my content. A friend is a **co-author** of the same memory map.
- Memory tab on my phone should show **OUR memory** (mine + accepted friends'), not "my memory + a feed of friend posts".
- "Sharing" is the wrong metaphor. The right metaphor is **opening up to a shared layer**.
- Activities are private (per original brief) BECAUSE the canvas — the cleared fog — is the shared artifact. You don't show me HOW you walked; you walked, and now the world has less fog.

This is fully consistent with DS:
- Sam doesn't share "trips". Sam walks, and structures appear in other Sams' worlds.
- The other Sams don't see "Sam's walk feed". They see a world where ladders now exist.

---

## 2. Three Layers of the System (Mental Model)

Use these three layers as the spine of every design conversation:

### Layer A — Personal (default, always)
- My own marks / routes / activities / cleared fog
- Visible only to me
- This already works today

### Layer B — Trusted Circle (the new layer)
- Up to 5 bidirectional friends
- ONE shared memory canvas: my cleared fog ∪ their cleared fog ∪ shared marks ∪ shared routes
- Activities NEVER leak in
- 1-tap "include in trusted circle" on a mark/route → all 5 friends see it on the shared canvas

### Layer C — Public Strand (Death Stranding mode, FUTURE)
- DS-style: any user, no friendship needed, geographic pull (within ~50m of an opted-public mark)
- Heart-only feedback
- Already half-built in DB (`markers.permission = 'public'`) but **no UI surface exists today**
- **MVP defers this.** Keep schema, no UI yet. Open the door later without redesign.

> **Layer-naming rule**: code/UI should literally use "Personal / Circle / Public" as the three states everywhere. Consistency is more valuable than clever names.

---

## 3. The Single Hardest Question (Settled)

**"Do we tier friends?"** — NO.

Cross-check from 4 reports:
- DS: zero tiering. Strand is fully flat.
- Hiking apps (Strava/AllTrails/Komoot/Polarsteps/Wikiloc): zero tiering of followers.
- Social apps (FB Lists, G+ Circles): tiering existed everywhere, used by ~no one.
- 5-friend math: any "tier" cuts 5 people into trivial groups the user already knows.
- User decision: confirmed.

**Lock this. Do not revisit unless user expands to 30+ friends in a future sprint.**

---

## 4. Recommended MVP Behavior (the spec)

### 4.1 Friend management
- **Already built** (FriendsScreen.tsx, /api/friends/*). Keep as-is.
- Add-by-email → friend_request → accept/decline → friend pair row. Bidirectional.
- Cap: 5 friends (soft cap, just block the add-friend flow; paywall conversation deferred).
- Block-list: defer to v2.

### 4.2 Sharing model — replace "Sharing toggle" with "Circle visibility"
- **Today**: each FriendRow has a local-only Sharing Switch. It's lying — the backend doesn't read it.
- **Replace**: remove the per-friend Sharing Switch entirely. Replace with a single global state: "Circle on" or "Circle off" (user-level setting, default ON for new friends).
- Rationale: per-friend toggle is the start of tiering. Killing it is consistent with the 4-research consensus.

### 4.3 Mark visibility (the 3-state already in DB)
- `personal` (default, private) — current behavior, unchanged
- `circle` (rename from `group` in code; the DB ENUM stays but UI says "Circle") — visible to all 5 friends
- `public` (DS strand layer, MVP no UI) — schema kept, no UI exposed

When creating a mark:
```
[ Personal  •  Circle  •  Public(soon) ]
```
3-tap segmented control. Default Personal. Last-used remembered per-user.

### 4.4 Route sharing (NEW)
- Route table needs `visibility ENUM('personal','circle','public') DEFAULT 'personal'`. (Schema gap.)
- Same 3-state segmented control as marks.
- Routes from activities: when the user converts an activity → route, the conversion screen asks "Personal / Circle". This is the ONLY path activity-derived content reaches friends.

### 4.5 Activity (sessions)
- **NEVER shareable.** No visibility column added. No UI. Locked architecturally.
- This is the only way to honor user's "不宣传走过的途径" requirement.

### 4.6 Friend's content rendering — the "shared canvas"

Critical UI question: how do I distinguish my-vs-friend's marks on the same map?

Recommendation (after 4 research reports + DS soul):

- **Memory map (fog reveal)**: when Circle is ON, the cleared-fog polygon is the UNION of mine + each accepted friend's. No visual distinction. This expresses "co-exploration".
- **Marks (cairns)**: visible distinction — friend marks get a thin colored ring (one color per friend, auto-assigned from a 5-color palette stable per friend). My own marks stay unringed. Tap a friend mark → header shows friend's name. No "delete" button on friend marks.
- **Routes**: same approach — friend routes drawn in a slightly thinner stroke with the friend's color ring, mine in the standard primary color.

Why ring (not full color swap)? The mark's content (icon, position) is the shared artifact. The author is metadata. Ring keeps the map readable when fog merges with 5 friends' coverage.

### 4.7 Heart-only interaction (DS hardcoded)
- One DB column `markers.hearts INT DEFAULT 0`. One table `marker_hearts(user_id, marker_id)` for dedup.
- NO comments table. NO reactions table. NO "viewed by X" tracking.
- Tapping a friend's mark surfaces a heart button. Bottom of mark detail sheet: "♥ 12".
- This must be a SCHEMA-LEVEL decision. Future "add comments" requests are explicitly denied — adding comments breaks the entire emotional model.

### 4.8 Notifications
- **Pull only, no push.**
- Friend requests: in-app badge on Friends tab. No system push.
- Hearts received: badge dot, no push.
- Friend added a circle mark: NO notification of any kind. User discovers it next time they open the map (DS philosophy: presence felt, not paged).

### 4.9 Privacy guardrail (research mandatory)
- **Home masking is a launch blocker** per hiking-apps research. Strava/Komoot/Polarsteps all have it.
- MVP: every user sets a "private radius" (default 200m around home address). Cleared fog within this radius is NOT shared to circle, ever. Marks created inside it default to `personal` and the segmented control hides the Circle option (forces user to explicitly move the mark before sharing).
- Defer the UI for setting private radius; ship with a sensible default and a settings entry.

---

## 5. UI Distinguishing — Visual Spec

| Surface | My item | Circle item (friend's) |
|---|---|---|
| Memory map fog | sepia cleared region | same sepia (UNION — no visual difference; this is the point) |
| Memory map mark | unringed icon | thin 2px ring in friend's auto-color |
| Memory map route | primary green line | friend's auto-color, 0.5x stroke weight |
| Flags tab list | "Mine" tab + "Circle" tab (two segments) | tap row → bottom sheet with friend attribution |
| Mark detail | edit/delete buttons | author name + ♥ count + ♥ button. No delete. |

Friend auto-color palette (stable per friend, deterministic from friend_id hash):
```
#5d7c46 (default mine)   -- reserved for self
#c87941, #3d7ab5, #b36b00, #2e8c3a, #5a4fcf   -- 5 colors for 5 friends
```

---

## 6. What This Plan Does NOT Build (explicit non-goals)

| Not building | Why |
|---|---|
| Activity feed of any kind | User explicit + DS philosophy |
| Comments / reactions beyond hearts | Hardcoded in schema, by design |
| Per-friend mark targeting | Tiering by another name; rejected |
| Friend groups / lists | Same, rejected |
| Push notifications | DS pull model |
| Public/community discovery UI | Deferred (Layer C, future) |
| Block list / mute | v2 |
| Friend search / discovery | We're an invite-only trusted circle. Users add friends they already know. No search UI. |
| Sharing to non-Cairn users | Out of scope per user (email recipient must be on Cairn) |

---

## 7. Backend / Schema Gaps (concrete work list)

From `04_current_state.md`:

### Already there (good)
- users, friends (bidirectional pairs), friend_requests
- markers.permission ENUM('personal','group','public')
- markers.public_snapshot JSON (kept, no UI yet)
- GET /api/friends/:id/markers (exists, no client calls it)

### Schema changes needed
1. `routes.visibility ENUM('personal','circle','public') DEFAULT 'personal'` (NEW column)
2. `markers.hearts INT DEFAULT 0` (NEW column) — counter
3. `marker_hearts(user_id INT, marker_id INT, PRIMARY KEY(user_id, marker_id))` (NEW table)
4. `users.private_radius_m INT DEFAULT 200` (NEW column)
5. `users.private_lat DOUBLE NULL, users.private_lng DOUBLE NULL` (NEW columns) — set on first save
6. (No new column for "Circle on/off per friend" — we killed that.)
7. Code rename: `'group'` ENUM value stays in DB (don't break existing rows), but UI/code uses the word "Circle" everywhere new.

### Backend endpoints needed
1. `GET /api/circle/marks` — union of all my friends' circle-visibility marks (deduped, server-side filtered against my private_radius)
2. `GET /api/circle/routes` — same for routes
3. `GET /api/circle/fog` — union of friends' cleared-fog polygons, server-side clipped against each friend's private_radius
4. `POST /api/marks/:id/heart` — add heart, idempotent per (user, mark)
5. `DELETE /api/marks/:id/heart` — remove
6. `POST /api/routes` — extend with visibility param
7. `PATCH /api/marks/:id/visibility` — change between personal/circle/public

### Frontend work
1. Replace FriendRow Sharing Switch with read-only "Circle: ON" label (or remove)
2. Add 3-state segmented control to mark creation/edit
3. Add same to route creation (after activity → route conversion)
4. Memory map: composite fog (mine + circle endpoint result, gated by Settings "Circle Layer" toggle)
5. Memory map: render friend marks with auto-color ring
6. Flags tab: add "Mine | Circle" segmented header
7. Mark detail: heart UI + author attribution for friend marks
8. Activity → Route conversion sheet: add visibility step

---

## 8. Data Migration Plan (9163 → ldy@qq.com)

This is **independent of the friend system design** — it's a one-time data move. Schedule when user is ready.

Required SQL (run on aliyun MySQL after backup):

```sql
-- 1) Find 9163 user_id
SELECT id, name, email FROM users WHERE email LIKE '%9163%' OR name LIKE '%9163%';

-- 2) Find target ldy@qq.com user (must already exist, or create)
SELECT id FROM users WHERE email = 'ldy@qq.com';
-- if missing: INSERT users... (need user to register first, OR we admin-insert)

-- 3) List hack-suffix sessions
SELECT id, name FROM sessions WHERE user_id = <9163_id> AND name LIKE '%hack%';

-- 4) DRY-RUN review with user, then:
UPDATE sessions SET user_id = <ldy_id> WHERE id IN (<list>);

-- 5) Rebuild memory_points from remaining 9163 sessions (server has v358 script:
--    _spike/v358-fix-back-session/resmooth_v358.py — re-run scoped to user 9163)
-- 6) Rebuild memory_points for ldy user using same Kalman migration
```

**Hard rule (from memory_dry_run_before_delete)**: Every step above MUST run with `--dry-run` flag first showing what would change. Only execute after user confirms the listed session IDs match what they expect.

---

## 9. Phased Delivery Recommendation

If user accepts this brainstorm, suggest splitting into 4 sprints (use /project skill):

**Sprint F1 — Schema + Backend foundation**
- Add 5 schema columns + 1 table
- 7 new endpoints
- Migrate 9163 → ldy (separate task; can run in F1 too)

**Sprint F2 — Mark sharing**
- Visibility segmented control on mark create/edit
- Friend marks rendered on Memory map (with ring colors)
- Flags tab Mine/Circle segments
- Heart button + count

**Sprint F3 — Route sharing**
- Activity → Route conversion with visibility
- Friend routes on Memory map
- Route share endpoint

**Sprint F4 — Shared fog (the "co-explore" core)**
- Composite fog rendering (union mine + circle)
- Private radius enforcement on server
- Settings UI for private radius

Each sprint is independently demoable. F2 alone is a usable feature.

---

## 10. Open Questions for User (after reading this)

1. **Private radius default of 200m** — acceptable? Or should it be 100m / 500m?
2. **Friend's marks: ring color OR full color swap?** Ring keeps the map clean; swap is more obvious. (My rec: ring.)
3. **Hearts visible to me on my own marks** (I see "5 hearts on this cairn") — yes/no? (My rec: yes, gentle dopamine consistent with DS.)
4. **Activity → Route conversion exists today?** Or needs to be built? (Quick code check; affects F3 scope.)
5. **9163 → ldy migration** — run before, parallel with, or after Sprint F1? (My rec: in F1, with explicit dry-run gate.)
6. **Sprint F4 (shared fog) is the riskiest** — it changes the most fundamental visual. Want to scope-down to "show friend marks but NOT merge fog" as MVP-MVP? (My rec: do full union; co-exploration is the soul, half-doing it kills the magic.)

---

## Appendix — Research File References

- `_research/friend-system/01_DS_strand_model.md` — Death Stranding strand mechanics + Cairn borrow matrix
- `_research/friend-system/02_hiking_apps_compare.md` — AllTrails/Strava/Komoot/Polarsteps/Wikiloc/FATMAP comparison
- `_research/friend-system/03_tiering_decision.md` — 8-app tiering analysis, final recommendation
- `_research/friend-system/04_current_state.md` — Cairn codebase audit, gaps, 9163 lookup SQL
