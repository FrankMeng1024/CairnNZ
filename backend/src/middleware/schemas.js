/**
 * schemas — Joi validation schemas for all backend endpoints.
 *
 * Central registry. When a route adds/removes fields, update the schema here
 * so validation stays in sync. Each schema is named by <resource>.<action>
 * to keep imports readable at call sites.
 *
 * Coordinate ranges:
 *   lat: [-90, 90]      — global spec, though NZ is [-47, -34]
 *   lng: [-180, 180]    — global spec, though NZ is [166, 179]
 *   alt: [-1000, 10000] — sanity range for GPS altitude (meters)
 *
 * Common patterns:
 *   .required()    — must be present
 *   .allow('')     — empty string permitted (distinct from missing)
 *   .allow(null)   — explicit null permitted
 *   .strict()      — no type coercion (rejects "42" for a number field)
 */
'use strict';

const Joi = require('joi');

// ── Reusable primitives ────────────────────────────────────────────────
const lat = Joi.number().min(-90).max(90);
const lng = Joi.number().min(-180).max(180);
const alt = Joi.number().min(-1000).max(10000).allow(null);
const isoDate = Joi.string().isoDate();
const positiveInt = Joi.number().integer().min(0);

// ── Markers ────────────────────────────────────────────────────────────
const markerCreate = Joi.object({
  type: Joi.string().valid(
    'cairn', 'danger', 'water', 'junction', 'scenic', 'supply',
    'shelter', 'hazard', 'note', 'free'
  ).required(),
  text: Joi.string().max(250).allow(''),
  lat: lat.required(),
  lng: lng.required(),
  alt: alt,
  permission: Joi.string().valid('personal', 'group', 'public').default('personal'),
  approximate: Joi.boolean().default(false),
  // Sprint 6 round-25 R25F6: restrict voice_memo_url scheme to https only
  // (no javascript:, no file:, no http:). Pre-fix, Joi.uri() accepted any
  // scheme, so if the feature were wired up (currently the handler drops
  // this field silently), a marker could store `javascript:alert(1)` or
  // `http://attacker.com/tracking-pixel` → XSS in WebView, IP disclosure
  // to attacker on playback, SSRF vector on server-side transcoding.
  // Locking scheme now while the feature is still latent — no user impact
  // (existing markers have null; new markers with http:// or unusual
  // schemes would 400, which is desired).
  voice_memo_url: Joi.string().uri({ scheme: ['https'] }).max(512).allow(null),
  voice_memo_duration_ms: Joi.number().integer().min(0).max(65535).allow(null),
});

const markerUpdate = Joi.object({
  type: Joi.string().valid(
    'cairn', 'danger', 'water', 'junction', 'scenic', 'supply',
    'shelter', 'hazard', 'note', 'free'
  ),
  text: Joi.string().max(250).allow(''),
  // Sprint 6 round-25 R25F3: removed lat/lng/alt from update schema. The
  // handler at markers.js:237 only destructures {text, permission, type}
  // and silently drops any lat/lng in the body. Pre-fix, a client PUT
  // with lat/lng would pass Joi validation, return 200, and the user
  // would believe they moved the marker — but the DB row was untouched.
  // Data-integrity bug: user's mental model diverges from server state.
  // If moving markers is a wanted feature, it needs a distinct endpoint
  // (POST /:id/move with distance/authority checks). For now: reject
  // any client attempt to move a marker via PUT with a clear error.
  permission: Joi.string().valid('personal', 'group', 'public'),
  approximate: Joi.boolean(),
}).min(1); // at least one field to update

// ── Sessions ───────────────────────────────────────────────────────────
const sessionStart = Joi.object({
  type: Joi.string().valid('hiking', 'running').required(),
  start_time: isoDate.required(),
});

const sessionAppendPoints = Joi.object({
  points: Joi.array().items(
    Joi.object({
      lat: lat.required(),
      lng: lng.required(),
      alt: alt,
      t: Joi.number().integer().min(0).required(),
      acc: Joi.number().min(0).allow(null),
    })
  ).min(1).max(500).required(),
});

const pointObj = Joi.object({
  lat: lat.required(),
  lng: lng.required(),
  alt: alt,
  t: Joi.number().integer().min(0),
  acc: Joi.number().min(0).allow(null),
});

const sessionSave = Joi.object({
  end_time: isoDate.required(),
  distance_m: Joi.number().min(0).max(1000000).default(0),
  duration_s: positiveInt.default(0),
  route_points: Joi.array().items(pointObj).min(2),
  route_points_raw: Joi.array().items(pointObj).allow(null),
  flags: Joi.object().allow(null),
  route_id: Joi.number().integer().min(1).allow(null),
  name: Joi.string().max(100).allow(null, ''),
  // O1 batch 27 revert: 恢复 max=10000。batch 17 一度改成 1000 与 handler
  // 手工检查对齐,但 batch 15 已删 handler 手工检查 → 现在两边都没保护 →
  // saveHikeAtomic 长 hike (10h 可产 3000-4000 memory_points) 会 400 →
  // pendingSyncStore 无限重试 → 用户 hike memory 永远丢。backend 事务里
  // 有 CHUNK=1000 分批 INSERT,10000 上界足够所有真实 hike。
  memory_points: Joi.array().items(pointObj).max(10000).allow(null),
});

const sessionUpdate = Joi.object({
  end_time: isoDate,
  distance_m: Joi.number().min(0).max(1000000),
  duration_s: positiveInt,
  route_points: Joi.array().items(pointObj).min(2),
  route_points_raw: Joi.array().items(pointObj).allow(null),
  flags: Joi.object().allow(null),
  name: Joi.string().max(100).allow(null, ''),
}).min(1);

// ── Routes ─────────────────────────────────────────────────────────────
const routeCreate = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  route_points: Joi.array().items(pointObj).min(2).max(10000).required(),
  distance_m: Joi.number().min(0).max(1000000),
  region_code: Joi.string().max(8).default('nz'),
  visibility: Joi.string().valid('personal', 'group', 'public').default('personal'),
});

const routeUpdate = Joi.object({
  name: Joi.string().min(1).max(100),
  route_points: Joi.array().items(pointObj).min(2).max(10000),
  distance_m: Joi.number().min(0).max(1000000),
  visibility: Joi.string().valid('personal', 'group', 'public'),
}).min(1);

// ── Friends ────────────────────────────────────────────────────────────
const friendRequest = Joi.object({
  email: Joi.string().email().max(255).required(),
});

// Sprint 6 round-42 R42: schemas MUST match client field names + handler
// destructure to avoid the R31 class of "schema/handler drift = every
// request 400s" bug. Client (useFriendStore.acceptFriendRequestAPI,
// rejectFriendRequestAPI) sends `{ requestId }` (camelCase). Handler
// destructures `{ requestId }`. Schema was requiring `request_id`
// (snake_case) — Joi with stripUnknown:false rejects unknown fields,
// so every /accept and /reject was returning 400 Validation failed.
// Fix: schema uses `requestId` to match both sides.
const friendAccept = Joi.object({
  requestId: Joi.number().integer().min(1).required(),
});

const friendReject = Joi.object({
  requestId: Joi.number().integer().min(1).required(),
});

// ── Auth ───────────────────────────────────────────────────────────────
// O18 AUTH-06: dateOfBirth required at register. Enforced <13 in the
// route (Joi cannot easily do "must be >= 13 years ago" cross-field).
const authRegister = Joi.object({
  name: Joi.string().min(1).max(60).required(),
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(200).required(),
  dateOfBirth: Joi.string().isoDate().required(),
});

const authVerify = Joi.object({
  email: Joi.string().email().max(255).required(),
  code: Joi.string().length(6).pattern(/^\d+$/).required(),
});

const authLogin = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(1).max(200).required(),
});

const authResend = Joi.object({
  email: Joi.string().email().max(255).required(),
});

const authGoogle = Joi.object({
  id_token: Joi.string().min(10).required(),
});

// Sprint 6 R63: apple schema. Pre-fix, POST /apple had no validateBody,
// relying on inline `if (!identity_token)` guard. All other fields
// (name, raw_nonce) were coerced via `String(x).trim().slice()` at
// use time — not vulnerable, but inconsistent with the rest of auth.
// A schema makes the input contract explicit and rejects oversized
// name / raw_nonce payloads before any processing.
const authApple = Joi.object({
  identity_token: Joi.string().min(10).max(4000).required(),
  raw_nonce: Joi.string().max(200).allow(null, ''),
  name: Joi.string().max(60).allow(null, ''),
});

// O18 batch 6.3: field names match route handler (currentPassword/newPassword).
// currentPassword optional because OAuth users setting password for first time
// have no current password to verify.
const authPasswordChange = Joi.object({
  currentPassword: Joi.string().min(1).max(200).allow('', null),
  newPassword: Joi.string().min(8).max(200).required(),
});

// O18 AUTH-04: password reset flow.
const authPasswordResetRequest = Joi.object({
  email: Joi.string().email().max(255).required(),
});

const authPasswordResetVerify = Joi.object({
  email: Joi.string().email().max(255).required(),
  code: Joi.string().length(6).pattern(/^\d+$/).required(),
  new_password: Joi.string().min(8).max(200).required(),
});

// O18 AUTH-06: legacy DOB backfill for pre-migration users.
const authSetDob = Joi.object({
  dateOfBirth: Joi.string().isoDate().required(),
});

// ── Hide ───────────────────────────────────────────────────────────────
const hideCreate = Joi.object({
  item_type: Joi.string().valid('mark', 'route').required(),
  item_id: Joi.alternatives().try(
    Joi.number().integer().min(1),
    Joi.string().pattern(/^\d+$/).max(20)
  ).required(),
});

// ── Memory ─────────────────────────────────────────────────────────────
// memory.js POST /points expects: points[].ts (unix ms), optional cid
const memoryPointObj = Joi.object({
  lat: lat.required(),
  lng: lng.required(),
  alt: alt,
  ts: Joi.number().integer().min(0).required(),
  cid: Joi.string().min(1).max(128).allow(null),
});

const memoryPoints = Joi.object({
  // O1 batch 27 revert: 恢复 max=5000。POST /api/memory/points client 侧
  // MAX_BATCH=500 所以真实 batch 不会 >500,但 initial reveal 或 backfill
  // 可能一次 push 数千点,1000 太紧。
  points: Joi.array().items(memoryPointObj).min(1).max(5000).required(),
});

module.exports = {
  marker: {
    create: markerCreate,
    update: markerUpdate,
  },
  session: {
    start: sessionStart,
    appendPoints: sessionAppendPoints,
    save: sessionSave,
    update: sessionUpdate,
  },
  route: {
    create: routeCreate,
    update: routeUpdate,
  },
  friend: {
    request: friendRequest,
    accept: friendAccept,
    reject: friendReject,
  },
  auth: {
    register: authRegister,
    verify: authVerify,
    login: authLogin,
    resend: authResend,
    google: authGoogle,
    apple: authApple,
    passwordChange: authPasswordChange,
    // O18 batch 6.3
    passwordResetRequest: authPasswordResetRequest,
    passwordResetVerify: authPasswordResetVerify,
    setDob: authSetDob,
  },
  hide: {
    create: hideCreate,
  },
  memory: {
    points: memoryPoints,
  },
};
