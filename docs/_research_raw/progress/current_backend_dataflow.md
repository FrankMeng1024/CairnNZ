# Cairn Backend & Data Flow

[STARTED]
## Part A - Backend API Endpoints

### Authentication & Users
- POST /api/auth/register — Sign up with email+password or OAuth
- POST /api/auth/login — Login with email+password or OAuth
- [All routes below require JWT auth]

### Routes Management (/api/routes)
- POST /api/routes — Create route (name, points[], distance_m, permission)
  - Rejects permission='public' (server-only)
- GET /api/routes — List user's routes by run_count DESC
- GET /api/routes/:id — Get route detail with full points JSON
- PUT /api/routes/:id — Update route (name, description, points)
- DELETE /api/routes/:id — Delete route
- PATCH /api/routes/:id/run — Increment run_count

### Markers (/api/markers)
- GET /api/markers — Get user's personal markers
- GET /api/markers/public?bbox=... — Get public markers in geo bbox (50 limit)
  - Anonymizes author_name, filters hidden items
- POST /api/markers — Create marker (type, text<250ch, lat, lng, permission)
  - Rejects permission='public' from client
- PUT /api/markers/:id — Update marker (text, type, permission)
- DELETE /api/markers/:id — Delete marker
- GET /api/markers/:id/community-state — Read helpful_count, report_count
- GET /api/markers/:id/interact-nonce — Get HMAC nonce (5min valid)
- POST /api/markers/:id/vote — Submit like or report (mutex: 1 vote per user)
  - Rate limits: 30 likes/min, 5 reports/min, 20 reports/hour
  - Server gates: 50m range, <100m GPS accuracy, ±60s clock skew
  - Auto-hide: 5 reports → status='hidden'

### Sessions (/api/sessions)
- POST /api/sessions — Save complete session (legacy all-in-one)
- POST /api/sessions/start — Start tracking, return session id
- PATCH /api/sessions/:id/append-points — Append GPS points (idempotent)
- PATCH /api/sessions/:id/save — v412 atomic finalize
- GET /api/sessions — List sessions by start_time DESC
- GET /api/sessions/:id — Get session detail with route_points + flags
- DELETE /api/sessions/:id — Delete session

### Memory (/api/memory)
- POST /api/memory/points — Upload visited points (max 1000 batch)
- GET /api/memory/points — Paginated pull (keyset: after_ts, after_cid)
- DELETE /api/memory/points — Wipe all memory

### Friends (/api/friends)
- POST /api/friends/request — Send friend request by email
- GET /api/friends/requests — Pending incoming requests
- POST /api/friends/accept — Accept request (create bidirectional rows)
- GET /api/friends — List all friends
- DELETE /api/friends/:id — Remove friend
- GET /api/friends/:id/markers — Get friend's permission='group'|'public' markers

### Circle (friend content aggregation)
- GET /api/circle/markers — UNION mutual-friends' markers (permission=friend|group|public)
- GET /api/circle/routes — UNION mutual-friends' routes (permission=friend|public)
- GET /api/circle/fog — UNION subscribed-friends' memory_points (max 5)

### Hiding (/api/hide)
- POST /api/hide — Hide another user's marker/route (irreversible in v1)

---

## Part B - Core Data Models

### users
- id, name, email (unique), password_hash (nullable for OAuth)

### markers
- id, user_id, type ENUM(danger,junction,water,hut,cairn)
- text[<250], lat, lng, alt, permission ENUM(personal,group,public)
- status ENUM(healthy,hidden), hidden_at
- helpful_count, report_count (default 0)

### marker_votes
- PK(user_id, marker_id) — enforces 1 vote per user
- type ENUM(like,report), reason ENUM(fake_ad,info_mismatch,dislike)
- reporter_lat, reporter_lng, distance_m (anti-abuse)

### hidden_items
- PK(user_id, item_type, item_id)
- item_type ENUM(mark,route)
- [Viewer's personal blacklist]

### routes
- id, user_id, name, description
- points[JSON], waypoints[JSON]
- distance_m, elevation_gain_m, permission ENUM(personal,friend,public)
- run_count, last_run_at

### sessions
- id, user_id, type ENUM(hiking,running)
- start_time, end_time, finalized_at
- distance_m, duration_s, name
- route_points[JSON], route_points_raw[JSON], flags[JSON]

### memory_points
- PK(user_id, client_id) [was (user_id, ts) in v0.2.6.2 — breaks on collisions]
- lat, lng, ts[integer ms], client_id[UUID or deterministic hash]
- [User's visited GPS history]

### friends
- PK(user_id, friend_id)
- [BIDIRECTIONAL: both (A→B) and (B→A) rows exist]

### memory_subscriptions
- user_id, friend_id [max 5 subscriptions per user for fog UNION]

---

## Part C - Data Flow Examples

### Flow 1: Create Marker
1. POST /api/markers {type, text, lat, lng, permission}
2. Validate: permission ∉ {public}; text < 250ch
3. Map permission 'friend'→'group' for DB
4. INSERT markers (user_id, type, text, lat, lng, permission='group', status='healthy')
5. Response: echo {id, user_id, type, text, ...}
6. Visibility:
   - Own: visible in GET /api/markers
   - Friend's 'group': visible via /api/circle/markers (mutual friendship)
   - Public: visible via /api/markers/public (anonymized)

### Flow 2: Complete Hike
1. POST /api/sessions/start → session id
2. Poll GPS, accumulate route_points
3. Every 60s: PATCH /api/sessions/:id/append-points (server dedupes)
4. Simultaneously: POST /api/memory/points (server dedupes by client_id)
5. At end: PATCH /api/sessions/:id/save (finalize, set finalized_at)
6. Persisted data:
   - sessions.route_points → friends see via /api/circle/routes
   - memory_points → friends see via /api/circle/fog (if subscribed)

### Flow 3: Friend Request Acceptance
1. POST /api/friends/request {email} → friend_requests (pending)
2. GET /api/friends/requests → shows pending
3. POST /api/friends/accept → creates friends(A→B) + friends(B→A)
4. Now A sees B's content: /api/circle/markers, /api/circle/routes, /api/circle/fog

---

## Part D - Stranger Visibility & Permissions

### Public Markers
- GET /api/markers/public returns permission='public' markers
- author_name = null (always anonymized)
- Filtered by viewer's hidden_items

### Personal Markers
- Only owner sees them (GET /api/markers)
- Never visible to friends or strangers

### Friend Markers
- Visible to MUTUAL FRIENDS ONLY (via /api/circle/markers)
- author_name revealed to friends
- Not visible to strangers

### Marker Voting (Stranger + Friend)
- ANY authenticated user within 50m can vote
- Votes anonymous to others
- Counts (helpful, report) visible to all
- User's own vote visible to user only

### "Hide from me"
- POST /api/hide allows hiding any marker/route
- Hidden items filtered from /api/circle/*, /api/markers/public
- Also filters from friend fog UNION

---

## Part E - Fog-of-War / Memory System

### Memory Storage
- memory_points: fine-grained visited history (lat, lng, ts, user_id, client_id)
- UNIQUE(user_id, client_id) prevents duplicates

### Fog Computation
- NO server-side fog polygon computation found
- GET /api/circle/fog returns flat list of friend memory_points
- Client tessellates into polygons (h3/mesh)

### Fog Sharing
- User must POST /api/memory/subscriptions/{friend_id}
- Max 5 subscriptions per user
- GET /api/circle/fog unions subscribed-friends' memory_points
- Filtered by hidden_items (if viewer hid that friend's marker)

### Stranger Access
- Strangers cannot access /api/circle/fog
- GET /api/markers/public shows locations only (no history)

---

## Part F - Moderation & Content Policies

### Auto-Hide on Reports
- marker_votes UNIQUE(user_id, marker_id) enforces 1 vote per user
- When report_count >= 5 → UPDATE markers SET status='hidden', hidden_at=NOW()
- No manual mod queue; threshold-based only

### Report Types
- VALID_REASONS = {fake_ad, info_mismatch, dislike}
- All reasons trigger same auto-hide threshold (no differentiation)

### Anti-Spam Controls
- Rate limits: 30 likes/min, 5 reports/min, 20 reports/hour (per user)
- GPS gates: <100m accuracy, <50m from marker, <5km in 60s
- Nonce gate: 5-min HMAC (replay prevention)
- abuseSignals.log tracks all violations

### Content Filtering
- NO keyword blacklist found
- NO AI/classification pipeline
- Manual hide-from-me only user-facing suppression

### Missing / Not Implemented
- Keyword content filtering
- Admin manual review queue
- User account suspension/banning
- Report resolution workflow
- User reputation system

EOF
