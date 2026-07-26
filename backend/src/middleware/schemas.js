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
  voice_memo_url: Joi.string().uri().max(512).allow(null),
  voice_memo_duration_ms: Joi.number().integer().min(0).max(65535).allow(null),
});

const markerUpdate = Joi.object({
  type: Joi.string().valid(
    'cairn', 'danger', 'water', 'junction', 'scenic', 'supply',
    'shelter', 'hazard', 'note', 'free'
  ),
  text: Joi.string().max(250).allow(''),
  lat: lat,
  lng: lng,
  alt: alt,
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

const friendAccept = Joi.object({
  request_id: Joi.number().integer().min(1).required(),
});

const friendReject = Joi.object({
  request_id: Joi.number().integer().min(1).required(),
});

// ── Auth ───────────────────────────────────────────────────────────────
const authRegister = Joi.object({
  name: Joi.string().min(1).max(60).required(),
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(200).required(),
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

const authPasswordChange = Joi.object({
  old_password: Joi.string().min(1).max(200).required(),
  new_password: Joi.string().min(8).max(200).required(),
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
    passwordChange: authPasswordChange,
  },
  hide: {
    create: hideCreate,
  },
  memory: {
    points: memoryPoints,
  },
};
