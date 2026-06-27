# Current State Audit — Friend / Share / Visibility (2026-06-27)

Scope: report-only. No code changes. References use absolute paths.

---

## §1 Existing Friends UI

| Item | Path | State |
|---|---|---|
| Friends Screen | `C:\ClaudeCodeProjects\Cairn\app\src\screens\FriendsScreen.tsx` (819 LOC) | Real, not mock. STORY-00045 + STORY-00109 + STORY-00167 |
| Mock removal note | FriendsScreen lines 276-279 | Mock removed; empty list → `<EmptyState>` UI |
| Empty illustration | `EmptyFriends` from `app/src/components/Illustrations.tsx` | "Cairn is better with trail companions" + "Invite friends..." + CTA |

Behaviour:
- Pulls friends from `useFriendStore.loadFriendsFromBackend()` on mount (`useEffect`, line 326)
- Also pulls incoming requests from `fetchFriendRequests()` → renders pending request section at top (collapse if N>1, line 435)
- `AddFriendSheet` (line 142) collects an email → POSTs `/api/friends/request` → success state → 2s timeout → close
- `FriendCard` renders avatar (LinearGradient initials), name, lastSeen pill, "shared flags" count, and a per-friend "Sharing/Hidden" Switch
- The per-friend `Switch` (line 127) is **local state only** (`toggleShare` in line 386) — never persisted to backend or used by any read query
- `friend.online`, `friend.lastSeen`, `friend.sharedMarkers` are **stub fields**: backend's `GET /api/friends` returns only `id/name/email/added_at` (`backend/src/routes/friends.js:130`); UI hardcodes `online: false`, `lastSeen: 'N/A'`, `sharedMarkers: 0` (`mapStoreFriend` line 282-291)

Style: glass-cream cards (`backgroundColor: 'rgba(255,255,255,0.88)'`), Spacing/Radius/Colors tokens from `app/src/components/tokens`. Staggered entrance animations (60ms each). Matches Cairn's current "frosted glass + warm cream" palette.

---

## §2 Data Model Current State

**users table** (`backend/src/migrations/004_auth_rebuild.sql`)
```
id BIGINT, name VARCHAR(100), email VARCHAR(255) UNIQUE,
password_hash NULL, created_at, updated_at
```
- No `username` / `handle` field
- Email is the only addressable identity (FriendsScreen.AddFriendSheet collects email)
- OAuth links in `user_oauth (user_id, provider, provider_id)`

**friends table** (`003_friends_markers.sql:15-23`) — bidirectional pair rows
```
id, user_id, friend_id, created_at, UNIQUE(user_id, friend_id)
```
Accept inserts **two** rows (A→B and B→A) — `friends.js:97-100`.

**friend_requests** (`003_friends_markers.sql:4-13`)
```
id, from_user_id, to_user_id, status ENUM(pending|accepted|rejected),
created_at, UNIQUE(from_user_id, to_user_id)
```

**markers** (`003_friends_markers.sql:25-40` + `012_marker_community.sql` + `017_public_snapshot.sql`)
```
id, user_id, type, text VARCHAR(250), lat, lng, alt,
permission ENUM('personal','group','public') DEFAULT 'personal',
approximate, public_snapshot JSON, helpful_count, report_count,
status (healthy|suspicious|hidden), hidden_at, created_at, updated_at
```
No `owner_id`/`shared_with`/`group_id` table. "Visibility" is the single `permission` enum.

**routes** (`005_routes.sql`)
```
id, user_id, name, description, points JSON, waypoints JSON,
distance_m, elevation_gain_m, run_count, last_run_at, created_at, updated_at
```
**No** `visibility`, `shared_with`, `permission`, or `owner_id` fields. Routes are owner-private only.

**sessions** (`002_sessions.sql` + `004_auth_rebuild.sql:51-65` + `007_session_name.sql`)
```
id, user_id, type ENUM(hiking|running), start_time, end_time,
distance_m, duration_s, name VARCHAR(60), route_points JSON,
flags JSON, route_id, created_at
```
**No** visibility/share fields. Sessions = activities. There is **no `activity` or `activities` table** — "activity" terminology in UI (`RecentActivityRow`, line 1) maps to `sessions`.

**memory_points** (runtime-created — not in versioned migrations; referenced in `backend/src/routes/memory.js:97`)
```
user_id, lat, lng, ts, client_id (UNIQUE(user_id, client_id))
```
Owner-scoped only.

---

## §3 Marker / Flag Visibility — Current State

Three permission values exist on every marker: `personal`, `group`, `public`.

| Surface | Behaviour |
|---|---|
| Owner read (`GET /api/markers`) | `markers.js:103-107` — returns all own markers regardless of permission |
| Friend read (`GET /api/friends/:id/markers`) | `friends.js:159-179` — verifies bidirectional friendship, returns target's markers where `permission IN ('group','public')`, LIMIT 100 |
| Public read | **No endpoint exists** for cross-user public-marker browsing. `useCommunityStore` (`app/src/store/useCommunityStore.ts`) is built but `setMarkers` is never called from a network source. CommunityStore is wired in code but dead at runtime. |
| Friend marker fetch on client | `fetchFriendMarkers(friendId)` exists in `useFriendStore.ts:294-302` but is **not called by any screen** (only `loadFriendsFromBackend` is wired in `FriendsScreen` `useEffect`) |
| Public snapshot | When permission first flips to `public`, server + client both write an immutable `public_snapshot` JSON (`markers.js:131-142`, `useMarkerStore.ts:174-189`). Owner edits afterwards do **not** mutate the snapshot. Designed for the future cross-user view; no read endpoint consumes it yet. |
| Per-friend "Sharing" Switch in FriendsScreen | UI-only local state (line 386). No backend column, no read filter, no write. |
| Marker edit UI for permission | `MarkerDetailScreen` (verified by `validPermissions` enum referenced in `markers.js:128, 195`); plant flow defaults `personal` |

**Net**: a friend can fetch group/public markers of another user via `/api/friends/:id/markers`, but no client code currently calls this endpoint. End-user-visible cross-user sharing is effectively dormant.

---

## §4 Account "9163" + Hack-Suffix Activity Data

**Not found in repo.**
- `Grep` for `9163` against repo (excluding Unity IL2CPP output): zero matches in source code, store, backend routes, or migrations. Only hits are URL fragments in unrelated baidu research dumps.
- `Grep` for `hack` against source code: no occurrences in `app/src/` or `backend/src/`. Hits are in unrelated `_review/` / `_research/` docs and Unity build artefacts.
- No `username` / `handle` field exists on `users` — "9163" is not stored as a username. It is most plausibly a literal `users.id` value (BIGINT auto-increment) on aliyun MySQL, or a fragment of an email address local-part.

**Where to look** (out of repo):
- aliyun MySQL: `SELECT id, name, email, created_at FROM users WHERE id = 9163 OR email LIKE '%9163%' OR name LIKE '%9163%'`
- aliyun MySQL: `SELECT COUNT(*) FROM sessions WHERE user_id = 9163` (= activity count, since `sessions` = activities)
- Optional: `SELECT id, name FROM sessions WHERE user_id = 9163 AND name LIKE '%hack%'` for the hack-suffix activities the user mentioned

**Data-migration cost (if 9163 is in aliyun MySQL)**:
- Sessions are pure rows in one table, FK only to `users` and (nullable) `routes`. No file-system or AsyncStorage coupling on the server side.
- A "copy sessions to a friend's account" operation = `INSERT INTO sessions (user_id, type, ...) SELECT <new_user_id>, type, ... FROM sessions WHERE user_id=9163 [AND name LIKE '%hack%']`. Single SQL. Low risk.
- Caveat: client `useSessionStore` is hydrated per `userId` (`useSessionStore`/AsyncStorage keying — see hydrate patterns in `useMarkerStore.ts:343`). The new owner has to call their `loadFromBackend` to see the rows.

**Cannot confirm without DB access. The 9163 user_id has to be looked up on the live MySQL instance.**

---

## §5 Backend API — Friend / Share Surface

**Existing** (`backend/src/routes/friends.js`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/friends/request` | Send friend request by email |
| GET | `/api/friends/requests` | List pending incoming requests |
| POST | `/api/friends/accept` | Accept request → creates two friend rows |
| POST | `/api/friends/reject` | Reject request |
| GET | `/api/friends` | List own friends |
| DELETE | `/api/friends/:id` | Remove friend (deletes both directions) |
| GET | `/api/friends/:id/markers` | Friend's group/public markers (LIMIT 100) |

**Marker community** (`backend/src/routes/markers.js`):
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/markers/:id/community-state` | Likes/reports/user-vote |
| GET | `/api/markers/:id/interact-nonce` | HMAC nonce for vote |
| POST | `/api/markers/:id/vote` | Submit like / report (mutex per user/marker) |

**Missing / Not built** (gap surface):
- `GET /api/friends/:id/routes` — friend's shared routes (no endpoint, no DB column to even filter on)
- `GET /api/friends/:id/sessions` — friend's activities/sessions (no endpoint, no visibility column)
- `POST /api/routes/:id/share` — share route with friend(s) (no endpoint, no junction table)
- `POST /api/sessions/:id/share` or `/duplicate-to/:userId` — copy/share activity to a friend (no endpoint)
- `GET /api/markers/public` — global public marker browse (no endpoint despite `useCommunityStore` expecting it)
- Cancel/recall outgoing friend request (no endpoint; only accept/reject from the recipient side)
- Block user / unfriend with cleanup of shared content
- "Sharing on/off" persistence — the FriendsScreen toggle has no backend target

---

## §6 Gap List — Current → Possible New Requirements

**Frontend**
- FriendsScreen "Sharing/Hidden" Switch is purely cosmetic — no backend wiring, no read filter, no persistence
- No screen renders friends' markers/routes/sessions on the user's own map. `fetchFriendMarkers` exists but is never called.
- No "Share this route with…" entry point in `RouteEditorScreen` / `RoutesScreen` / `MapHistoryScreen`
- No "Share this activity with…" entry in session detail (`MapHistoryScreen` or session row)
- `useCommunityStore` is dead code — wired but never populated from network
- FriendCard surfaces `online` / `lastSeen` / `sharedMarkers` as stubs (`N/A`, 0); backend has no presence channel

**Backend**
- `friends.js` is the only friend route file; no `routes/share`, `sessions/share`, or community-marker endpoint
- `GET /api/friends/:id/markers` exists but is unused by any client; if reused, returns owner-edited fields, not `public_snapshot` — read path needs decision
- No "shared_with" / many-to-many table — share model must be chosen (broadcast via `permission` enum vs. per-friend ACL via junction table)
- Sessions API is strictly owner-scoped (`sessions.js` queries `req.user.userId` everywhere); friend visibility on sessions = greenfield
- No cancel-outgoing-request endpoint

**DB Schema**
- `routes` table has no visibility column — needs either `permission ENUM` (mirroring `markers`) or a `route_shares (route_id, shared_with_user_id)` junction table
- `sessions` table same situation — no visibility column, no junction
- `friends` table has no per-friend per-resource preferences (e.g. "share my routes with Sam but not markers")
- `users` table has no `username`/`handle`, so identity for share is email (UX implication — FriendsScreen already enforces this)
- No `activity_share_log` / audit table if "copied X's activity to Y" is a flow we want to track

**Data**
- 9163 account + its hack-suffix sessions cannot be located in repo. Migration requires aliyun MySQL access. Sessions are single-table; INSERT…SELECT into a target `user_id` is trivial SQL once 9163 is confirmed.

---

End of report.
