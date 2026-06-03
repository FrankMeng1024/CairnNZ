# API_SPEC.md — Cairn

## Overview

REST API. Backend serves as sync layer — app is offline-first, backend handles:
- User auth (custom JWT — **CR-004**: replaced Firebase Auth with Node.js/Express JWT auth)
- Marker sync (CRUD + conflict resolution)
- Friend management
- DOC risk data cache/serving

Base URL (development): `http://localhost:3001`
Base URL (production): configurable via `EXPO_PUBLIC_API_BASE_URL` env var. **HTTPS required in production** to protect JWT tokens in transit.

---

## Authentication

Custom JWT tokens issued by backend. All endpoints require `Authorization: Bearer <jwt_token>` except `/health` and the auth endpoints below.

**Token lifetime**: 7 days. Tokens are stored in `expo-secure-store` (native) or `localStorage` (web).

**Rate limiting**: Auth endpoints (`/api/auth/register`, `/api/auth/login`) are rate-limited to **10 requests per 15 minutes per IP**. Exceeding this returns `429 Too Many Requests`.

### Auth Endpoints

```
POST /api/auth/register
Body: { "name": string, "email": string, "password": string }
Response 201: { "token": string, "user": { "id": number, "name": string, "email": string } }
Response 409: { "error": "Email already registered" }
Response 400: { "error": string } (validation failure)

POST /api/auth/login
Body: { "email": string, "password": string }
Response 200: { "token": string, "user": { "id": number, "name": string, "email": string } }
Response 401: { "error": "Invalid credentials" }

GET /api/auth/me
Headers: Authorization: Bearer <token>
Response 200: { "id": number, "name": string, "email": string }
Response 401: { "error": "Invalid or expired token" }
```

---

## Endpoints

### Health

```
GET /health
Response 200: { "status": "ok" | "degraded", "service": "cairn-backend", "version": "1.0.0", "db": "ok" | "error: <reason>", "timestamp": ISO8601 }
Note: Returns 503 when DB is unavailable (status: "degraded"). Extra fields (service, db, timestamp) are additive over original spec.
```

### Markers

```
GET /markers?lat=<lat>&lng=<lng>&radius=<meters>&visibility=<personal|group|public>
Response: { "markers": [...] }

POST /markers
Body: {
  "lat": number,
  "lng": number,
  "altitude": number | null,
  "type": "danger" | "scenic" | "supply" | "junction" | "free",
  "visibility": "personal" | "group" | "public",
  "text": string (max 30 chars),
  "audio_url": string | null (Phase 2),
  "heading": number (0-360),
  "created_at": ISO8601,
  "local_id": UUID (for offline sync)
}
Response: { "id": UUID, "local_id": UUID, "synced_at": ISO8601 }

PUT /markers/:id
Body: partial marker fields
Response: { "id": UUID, "updated_at": ISO8601 }

DELETE /markers/:id
Response: { "deleted": true }
```

### Marker Feedback (Phase 2)

```
POST /markers/:id/helpful
Response: { "helpful_count": number }
```

### Friends

```
GET /friends
Response: { "friends": [{ "id", "email_masked", "display_name", "added_at" }] }

POST /friends/invite
Body: { "email": string }
Response: { "status": "pending" | "accepted" | "already_friends" }

POST /friends/accept
Body: { "invite_id": UUID }
Response: { "status": "accepted" }

DELETE /friends/:id
Response: { "removed": true }

GET /friends/pending
Response: { "incoming": [...], "outgoing": [...] }
```

### Routes

```
GET /routes
Response: { "routes": [{ "id", "name", "created_at", "distance_km", "waypoints_count" }] }

POST /routes
Body: {
  "name": string,
  "waypoints": [{ "lat", "lng", "altitude", "timestamp" }],
  "geofence_radius_m": number (default 50)
}
Response: { "id": UUID }

GET /routes/:id
Response: full route with waypoints

DELETE /routes/:id
Response: { "deleted": true }
```

### Risk Data (DOC Cache)

```
GET /risks?lat=<lat>&lng=<lng>&radius=<meters>
Response: {
  "alerts": [{ "id", "type", "severity", "title", "description", "lat", "lng", "source", "updated_at" }],
  "closures": [{ "trail_name", "reason", "since", "expected_reopen" }]
}
```

### Sync

```
POST /sync
Body: {
  "last_sync": ISO8601,
  "local_changes": [{ "table", "action", "data", "local_id", "timestamp" }]
}
Response: {
  "server_changes": [...],
  "conflicts": [{ "local_id", "resolution": "server_wins" | "client_wins" }],
  "sync_token": ISO8601
}
```

---

## Offline-First Strategy

1. All CRUD operations first write to local WatermelonDB
2. When network available: batch sync via `/sync` endpoint
3. Conflict resolution: last-write-wins (by timestamp)
4. Friend markers: pulled on sync, cached locally
5. DOC risk data: pulled daily + on-demand when entering new area

---

## Data Models

### Marker
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Server-assigned |
| local_id | UUID | Client-assigned, for sync |
| user_id | UUID | Owner |
| lat | float | |
| lng | float | |
| altitude | float? | |
| heading | float | Device compass at mark time |
| type | enum | danger/scenic/supply/junction/free |
| visibility | enum | personal/group/public |
| text | string(30) | |
| audio_url | string? | Phase 2 |
| helpful_count | int | Phase 2 |
| created_at | datetime | |
| updated_at | datetime | |
| deleted_at | datetime? | Soft delete |

### Route
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| user_id | UUID | |
| name | string | |
| waypoints | JSON | Array of {lat, lng, alt, timestamp} |
| geofence_radius_m | int | Default 50 |
| distance_km | float | Calculated |
| created_at | datetime | |

### Friend
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| user_a_id | UUID | |
| user_b_id | UUID | |
| status | enum | pending/accepted |
| invited_by | UUID | Which user initiated |
| created_at | datetime | |
