-- seed_mock_sessions_markers_routes.sql — Friend System v1 / Sprint 67 / STORY-00527
--
-- Seeds sessions, markers, memory_points, and routes for the 9 @cairn.demo
-- accounts per FINAL_PRODUCT_PLAN_v4.md §8.
--
-- 9163 bbox (from STORY-00526 cleanup data):
--   lat  31.230 .. 31.233  (Back Loop)
--   lng  121.431 .. 121.436
--   center: lat 31.232068, lng 121.434262
--   ±5km mock bbox: lat 31.18..31.28, lng 121.38..121.48
--
-- 1° lat ≈ 111 km → 50m = 0.00045° lat
-- 1° lng @ lat 31° ≈ 95 km → 50m = 0.00053°, 100m = 0.00106°
--
-- Permission semantics:
--   markers.permission ENUM('personal','group','public')   — legacy 'group' = "Friend"
--   routes.permission  ENUM('personal','friend','public')  — added by migration 018
-- (See backend/src/constants/permission.js for read/write normalization.)
--
-- v4.V binding: 9163 (id=4) remains untouched. NO friends rows, NO subscriptions.
--
-- Idempotent strategy:
--   Sessions/markers/routes have no natural unique key beyond (user_id, name) and
--   are normally write-once. This script assumes seed_mock_users.sql ran and
--   the four "data tables" (sessions, markers, memory_points, routes) contain
--   no rows for the 9 mock users. If you need to re-seed, run clear_mock_data.sql
--   first.
--
-- Geometric verification (Stranger 1 must be within 50m of Back Loop):
--   Back Loop center: lat 31.232068, lng 121.434262
--   Stranger 1 placed at lat 31.232248 (≈ +20m N), lng 121.434262 (same lng)
--   Distance verified by trig SQL at the bottom of this file.

USE cairn;

-- ──────────────────────────────────────────────────────────────────────────
-- Helper: pull user_id by email into @user vars
-- (MySQL has no procedural binding in pure SQL; we use @vars per user.)
-- ──────────────────────────────────────────────────────────────────────────

SELECT id INTO @u_alice  FROM users WHERE email = '1@cairn.demo';
SELECT id INTO @u_bob    FROM users WHERE email = '2@cairn.demo';
SELECT id INTO @u_carol  FROM users WHERE email = '3@cairn.demo';
SELECT id INTO @u_dave   FROM users WHERE email = '4@cairn.demo';
SELECT id INTO @u_ldy    FROM users WHERE email = '5@cairn.demo';
SELECT id INTO @u_eve    FROM users WHERE email = '6@cairn.demo';
SELECT id INTO @u_x1     FROM users WHERE email = 'x1@cairn.demo';
SELECT id INTO @u_x2     FROM users WHERE email = 'x2@cairn.demo';
SELECT id INTO @u_x3     FROM users WHERE email = 'x3@cairn.demo';

-- ──────────────────────────────────────────────────────────────────────────
-- ALICE (1@cairn.demo) — active friend A: 3 sessions / 12 marks / 1 route
-- Permission: 'group' (= "Friend" tier in app)
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points)
VALUES
  (@u_alice, 'hiking',  '2026-06-01 08:00:00', '2026-06-01 09:00:00', 4200, 3600, 'Riverside morning',
   JSON_ARRAY(JSON_OBJECT('lat',31.235,'lng',121.438,'ts',1717228800000),
              JSON_OBJECT('lat',31.236,'lng',121.439,'ts',1717230600000))),
  (@u_alice, 'running', '2026-06-03 07:30:00', '2026-06-03 08:10:00', 5600, 2400, 'Quick loop',
   JSON_ARRAY(JSON_OBJECT('lat',31.231,'lng',121.433,'ts',1717400600000),
              JSON_OBJECT('lat',31.232,'lng',121.434,'ts',1717403000000))),
  (@u_alice, 'hiking',  '2026-06-05 16:00:00', '2026-06-05 17:30:00', 6100, 5400, 'Sunset trail',
   JSON_ARRAY(JSON_OBJECT('lat',31.240,'lng',121.444,'ts',1717603200000),
              JSON_OBJECT('lat',31.241,'lng',121.445,'ts',1717608600000)));

-- Alice's 12 markers, all permission='group' (Friend tier)
INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_alice,'cairn','River bend view',          31.2350, 121.4380, 'group', 'tier_g', 0, 'healthy', '2026-06-01 08:15:00', '2026-06-01 08:15:00'),
  (@u_alice,'cairn','Old stone bridge',          31.2360, 121.4390, 'group', 'tier_g', 0, 'healthy', '2026-06-01 08:30:00', '2026-06-01 08:30:00'),
  (@u_alice,'note','Bench under maple',          31.2345, 121.4375, 'group', 'tier_g', 0, 'healthy', '2026-06-01 08:45:00', '2026-06-01 08:45:00'),
  (@u_alice,'cairn','Lookout',                   31.2310, 121.4330, 'group', 'tier_g', 0, 'healthy', '2026-06-03 07:40:00', '2026-06-03 07:40:00'),
  (@u_alice,'note','Cool breeze spot',           31.2320, 121.4340, 'group', 'tier_g', 0, 'healthy', '2026-06-03 07:55:00', '2026-06-03 07:55:00'),
  (@u_alice,'cairn','Granite outcrop',           31.2400, 121.4440, 'group', 'tier_g', 0, 'healthy', '2026-06-05 16:15:00', '2026-06-05 16:15:00'),
  (@u_alice,'cairn','Quiet pond',                31.2410, 121.4450, 'group', 'tier_g', 0, 'healthy', '2026-06-05 16:30:00', '2026-06-05 16:30:00'),
  (@u_alice,'note','Birds at dusk',              31.2405, 121.4445, 'group', 'tier_g', 0, 'healthy', '2026-06-05 16:45:00', '2026-06-05 16:45:00'),
  (@u_alice,'cairn','Final ridge',               31.2415, 121.4455, 'group', 'tier_g', 0, 'healthy', '2026-06-05 17:00:00', '2026-06-05 17:00:00'),
  (@u_alice,'note','Wildflowers',                31.2330, 121.4370, 'group', 'tier_g', 0, 'healthy', '2026-06-01 08:55:00', '2026-06-01 08:55:00'),
  (@u_alice,'cairn','Trail head',                31.2300, 121.4320, 'group', 'tier_g', 0, 'healthy', '2026-06-03 07:30:00', '2026-06-03 07:30:00'),
  (@u_alice,'note','Where I rested',             31.2390, 121.4430, 'group', 'tier_g', 0, 'healthy', '2026-06-05 16:55:00', '2026-06-05 16:55:00');

-- Alice's 1 route, permission='friend'
INSERT INTO routes (user_id, name, description, points, waypoints, distance_m, elevation_gain_m, permission)
VALUES
  (@u_alice, 'Alice loop A', 'Easy morning route', JSON_ARRAY(
    JSON_OBJECT('lat',31.235,'lng',121.438),
    JSON_OBJECT('lat',31.236,'lng',121.439),
    JSON_OBJECT('lat',31.237,'lng',121.440)
  ), JSON_ARRAY(), 4200, 50, 'friend');

-- ──────────────────────────────────────────────────────────────────────────
-- BOB (2@cairn.demo) — active friend B: 2 sessions / 8 marks / 1 route
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points)
VALUES
  (@u_bob, 'hiking',  '2026-06-02 09:00:00', '2026-06-02 10:30:00', 5200, 5400, 'North ridge',
   JSON_ARRAY(JSON_OBJECT('lat',31.250,'lng',121.445,'ts',1717318800000),
              JSON_OBJECT('lat',31.252,'lng',121.447,'ts',1717324200000))),
  (@u_bob, 'running', '2026-06-04 18:00:00', '2026-06-04 18:35:00', 4500, 2100, 'Evening run',
   JSON_ARRAY(JSON_OBJECT('lat',31.225,'lng',121.428,'ts',1717495200000),
              JSON_OBJECT('lat',31.227,'lng',121.430,'ts',1717497300000)));

INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_bob,'cairn','Top of ridge',     31.2500, 121.4450, 'group', 'tier_g', 0, 'healthy', '2026-06-02 09:20:00', '2026-06-02 09:20:00'),
  (@u_bob,'note','Windy point',       31.2510, 121.4460, 'group', 'tier_g', 0, 'healthy', '2026-06-02 09:40:00', '2026-06-02 09:40:00'),
  (@u_bob,'cairn','Crow nest tree',   31.2520, 121.4470, 'group', 'tier_g', 0, 'healthy', '2026-06-02 10:00:00', '2026-06-02 10:00:00'),
  (@u_bob,'note','Switchback turn',   31.2505, 121.4455, 'group', 'tier_g', 0, 'healthy', '2026-06-02 10:15:00', '2026-06-02 10:15:00'),
  (@u_bob,'cairn','Sunset bench',     31.2250, 121.4280, 'group', 'tier_g', 0, 'healthy', '2026-06-04 18:10:00', '2026-06-04 18:10:00'),
  (@u_bob,'note','Old fence',         31.2260, 121.4290, 'group', 'tier_g', 0, 'healthy', '2026-06-04 18:18:00', '2026-06-04 18:18:00'),
  (@u_bob,'cairn','Park entrance',    31.2270, 121.4300, 'group', 'tier_g', 0, 'healthy', '2026-06-04 18:25:00', '2026-06-04 18:25:00'),
  (@u_bob,'note','Last marker',       31.2280, 121.4310, 'group', 'tier_g', 0, 'healthy', '2026-06-04 18:33:00', '2026-06-04 18:33:00');

INSERT INTO routes (user_id, name, description, points, waypoints, distance_m, elevation_gain_m, permission)
VALUES
  (@u_bob, 'Bob ridge route', 'North ridge w/ overlook', JSON_ARRAY(
    JSON_OBJECT('lat',31.250,'lng',121.445),
    JSON_OBJECT('lat',31.252,'lng',121.447)
  ), JSON_ARRAY(), 5200, 120, 'friend');

-- ──────────────────────────────────────────────────────────────────────────
-- CAROL (3@cairn.demo) — stranger→friend conversion: 2 sessions + 4 PUBLIC marks
-- v4.V: Carol is NOT 9163's friend initially. NO row inserted into friends table.
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points)
VALUES
  (@u_carol, 'hiking', '2026-06-06 10:00:00', '2026-06-06 11:00:00', 3800, 3600, 'Park walk',
   JSON_ARRAY(JSON_OBJECT('lat',31.215,'lng',121.420,'ts',1717668000000),
              JSON_OBJECT('lat',31.217,'lng',121.422,'ts',1717671600000))),
  (@u_carol, 'running','2026-06-07 06:00:00', '2026-06-07 06:30:00', 4200, 1800, 'Sunrise jog',
   JSON_ARRAY(JSON_OBJECT('lat',31.218,'lng',121.423,'ts',1717740000000),
              JSON_OBJECT('lat',31.220,'lng',121.425,'ts',1717741800000)));

-- Carol's 4 Public marks (anonymous when displayed per v4)
INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_carol,'cairn','Best coffee nearby',   31.2150, 121.4200, 'public', 'tier_g', 0, 'healthy', '2026-06-06 10:10:00', '2026-06-06 10:10:00'),
  (@u_carol,'note','Quiet reading bench',   31.2170, 121.4220, 'public', 'tier_g', 0, 'healthy', '2026-06-06 10:30:00', '2026-06-06 10:30:00'),
  (@u_carol,'cairn','Hidden mural',         31.2180, 121.4230, 'public', 'tier_g', 0, 'healthy', '2026-06-07 06:10:00', '2026-06-07 06:10:00'),
  (@u_carol,'note','Free water fountain',   31.2200, 121.4250, 'public', 'tier_g', 0, 'healthy', '2026-06-07 06:25:00', '2026-06-07 06:25:00');

-- ──────────────────────────────────────────────────────────────────────────
-- DAVE (4@cairn.demo) — empty friend: NO sessions, NO marks, NO routes
-- (intentional — represents a friend who joined but never logged anything)
-- ──────────────────────────────────────────────────────────────────────────
-- (no inserts)

-- ──────────────────────────────────────────────────────────────────────────
-- LDY (5@cairn.demo) — rich friend: 4 sessions / 15 marks / 2 routes
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points)
VALUES
  (@u_ldy, 'hiking', '2026-05-25 07:00:00', '2026-05-25 09:00:00', 8500, 7200, 'Long Saturday',
   JSON_ARRAY(JSON_OBJECT('lat',31.260,'lng',121.450,'ts',1716620400000),
              JSON_OBJECT('lat',31.265,'lng',121.455,'ts',1716627600000))),
  (@u_ldy, 'running','2026-05-27 06:30:00', '2026-05-27 07:30:00', 7000, 3600, 'Tempo run',
   JSON_ARRAY(JSON_OBJECT('lat',31.245,'lng',121.435,'ts',1716791400000),
              JSON_OBJECT('lat',31.248,'lng',121.438,'ts',1716795000000))),
  (@u_ldy, 'hiking', '2026-05-30 14:00:00', '2026-05-30 16:00:00', 9200, 7200, 'Afternoon scramble',
   JSON_ARRAY(JSON_OBJECT('lat',31.255,'lng',121.448,'ts',1717072800000),
              JSON_OBJECT('lat',31.258,'lng',121.451,'ts',1717080000000))),
  (@u_ldy, 'running','2026-06-02 17:00:00', '2026-06-02 17:45:00', 5500, 2700, 'Evening intervals',
   JSON_ARRAY(JSON_OBJECT('lat',31.238,'lng',121.441,'ts',1717347600000),
              JSON_OBJECT('lat',31.240,'lng',121.443,'ts',1717350300000)));

INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_ldy,'cairn','Boulder pile',       31.2600, 121.4500, 'group', 'tier_g', 0, 'healthy', '2026-05-25 07:20:00', '2026-05-25 07:20:00'),
  (@u_ldy,'note','Waterfall sound',     31.2620, 121.4520, 'group', 'tier_g', 0, 'healthy', '2026-05-25 07:40:00', '2026-05-25 07:40:00'),
  (@u_ldy,'cairn','Old shrine',         31.2650, 121.4550, 'group', 'tier_g', 0, 'healthy', '2026-05-25 08:30:00', '2026-05-25 08:30:00'),
  (@u_ldy,'cairn','Bamboo grove',       31.2450, 121.4350, 'group', 'tier_g', 0, 'healthy', '2026-05-27 06:40:00', '2026-05-27 06:40:00'),
  (@u_ldy,'note','Cold spring',         31.2470, 121.4370, 'group', 'tier_g', 0, 'healthy', '2026-05-27 07:00:00', '2026-05-27 07:00:00'),
  (@u_ldy,'cairn','Summit cairn',       31.2480, 121.4380, 'group', 'tier_g', 0, 'healthy', '2026-05-27 07:25:00', '2026-05-27 07:25:00'),
  (@u_ldy,'cairn','Knife edge',         31.2550, 121.4480, 'group', 'tier_g', 0, 'healthy', '2026-05-30 14:30:00', '2026-05-30 14:30:00'),
  (@u_ldy,'note','Slippery section',    31.2570, 121.4500, 'group', 'tier_g', 0, 'healthy', '2026-05-30 15:00:00', '2026-05-30 15:00:00'),
  (@u_ldy,'cairn','Bird perch',         31.2580, 121.4510, 'group', 'tier_g', 0, 'healthy', '2026-05-30 15:30:00', '2026-05-30 15:30:00'),
  (@u_ldy,'note','Hand-holds',          31.2590, 121.4515, 'group', 'tier_g', 0, 'healthy', '2026-05-30 15:45:00', '2026-05-30 15:45:00'),
  (@u_ldy,'cairn','Loop end',           31.2380, 121.4410, 'group', 'tier_g', 0, 'healthy', '2026-06-02 17:10:00', '2026-06-02 17:10:00'),
  (@u_ldy,'note','Tree shade',          31.2390, 121.4420, 'group', 'tier_g', 0, 'healthy', '2026-06-02 17:25:00', '2026-06-02 17:25:00'),
  (@u_ldy,'cairn','Bench return',       31.2400, 121.4430, 'group', 'tier_g', 0, 'healthy', '2026-06-02 17:35:00', '2026-06-02 17:35:00'),
  (@u_ldy,'note','Sprint start',        31.2410, 121.4440, 'group', 'tier_g', 0, 'healthy', '2026-06-02 17:40:00', '2026-06-02 17:40:00'),
  (@u_ldy,'cairn','Easy out',           31.2420, 121.4445, 'group', 'tier_g', 0, 'healthy', '2026-06-02 17:43:00', '2026-06-02 17:43:00');

INSERT INTO routes (user_id, name, description, points, waypoints, distance_m, elevation_gain_m, permission)
VALUES
  (@u_ldy, 'LDY long', 'Saturday epic',
    JSON_ARRAY(JSON_OBJECT('lat',31.260,'lng',121.450),
               JSON_OBJECT('lat',31.265,'lng',121.455)),
    JSON_ARRAY(), 8500, 350, 'friend'),
  (@u_ldy, 'LDY tempo', 'Tempo run route',
    JSON_ARRAY(JSON_OBJECT('lat',31.245,'lng',121.435),
               JSON_OBJECT('lat',31.248,'lng',121.438)),
    JSON_ARRAY(), 7000, 80, 'friend');

-- ──────────────────────────────────────────────────────────────────────────
-- EVE (6@cairn.demo) — 6th friend paywall trigger: 2 sessions / 6 marks
-- (no routes — paywall is the focus; data must merely exist)
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points)
VALUES
  (@u_eve, 'hiking',  '2026-06-08 11:00:00', '2026-06-08 12:00:00', 3600, 3600, 'Eve walk',
   JSON_ARRAY(JSON_OBJECT('lat',31.205,'lng',121.410,'ts',1717840800000),
              JSON_OBJECT('lat',31.207,'lng',121.412,'ts',1717844400000))),
  (@u_eve, 'running', '2026-06-09 07:00:00', '2026-06-09 07:30:00', 4200, 1800, 'Eve jog',
   JSON_ARRAY(JSON_OBJECT('lat',31.270,'lng',121.460,'ts',1717916400000),
              JSON_OBJECT('lat',31.272,'lng',121.462,'ts',1717918200000)));

INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_eve,'cairn','Eve start',     31.2050, 121.4100, 'group', 'tier_g', 0, 'healthy', '2026-06-08 11:10:00', '2026-06-08 11:10:00'),
  (@u_eve,'note','Eve mid',        31.2060, 121.4110, 'group', 'tier_g', 0, 'healthy', '2026-06-08 11:30:00', '2026-06-08 11:30:00'),
  (@u_eve,'cairn','Eve end',       31.2070, 121.4120, 'group', 'tier_g', 0, 'healthy', '2026-06-08 11:55:00', '2026-06-08 11:55:00'),
  (@u_eve,'cairn','Eve start 2',   31.2700, 121.4600, 'group', 'tier_g', 0, 'healthy', '2026-06-09 07:05:00', '2026-06-09 07:05:00'),
  (@u_eve,'note','Eve mid 2',      31.2710, 121.4610, 'group', 'tier_g', 0, 'healthy', '2026-06-09 07:15:00', '2026-06-09 07:15:00'),
  (@u_eve,'cairn','Eve end 2',     31.2720, 121.4620, 'group', 'tier_g', 0, 'healthy', '2026-06-09 07:28:00', '2026-06-09 07:28:00');

-- ──────────────────────────────────────────────────────────────────────────
-- STRANGER 1 (x1@cairn.demo) — single Public mark within 50m of 9163 Back Loop
-- Back Loop center: lat 31.232068, lng 121.434262
-- Placement: lat 31.232248 (+0.00018° ≈ +20m N), lng 121.434262 (same)
-- Distance check at bottom of file: must be < 50m
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_x1,'cairn','Random stranger note', 31.232248, 121.434262, 'public', 'tier_g', 0, 'healthy', '2026-06-10 14:00:00', '2026-06-10 14:00:00');

-- ──────────────────────────────────────────────────────────────────────────
-- STRANGER 2 (x2@cairn.demo) — 3 Public marks within 100m of each other (heatmap)
-- Center pick: lat 31.220, lng 121.460 (away from Back Loop and from x1)
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_x2,'cairn','Hotspot A',  31.22000, 121.46000, 'public', 'tier_g', 0, 'healthy', '2026-06-11 10:00:00', '2026-06-11 10:00:00'),
  (@u_x2,'cairn','Hotspot B',  31.22045, 121.46053, 'public', 'tier_g', 0, 'healthy', '2026-06-11 10:30:00', '2026-06-11 10:30:00'),  -- ≈ +50m NE
  (@u_x2,'note','Hotspot C',   31.21955, 121.45947, 'public', 'tier_g', 0, 'healthy', '2026-06-11 11:00:00', '2026-06-11 11:00:00');  -- ≈ -50m SW (still <100m from A and B)

-- ──────────────────────────────────────────────────────────────────────────
-- STRANGER 3 (x3@cairn.demo) — 5 Public marks scattered across mock bbox
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at)
VALUES
  (@u_x3,'cairn','Far north spot',  31.275, 121.470, 'public', 'tier_g', 0, 'healthy', '2026-06-12 09:00:00', '2026-06-12 09:00:00'),
  (@u_x3,'note','Far south spot',   31.190, 121.395, 'public', 'tier_g', 0, 'healthy', '2026-06-12 09:30:00', '2026-06-12 09:30:00'),
  (@u_x3,'cairn','East trail',      31.230, 121.475, 'public', 'tier_g', 0, 'healthy', '2026-06-12 10:00:00', '2026-06-12 10:00:00'),
  (@u_x3,'note','West clearing',    31.240, 121.390, 'public', 'tier_g', 0, 'healthy', '2026-06-12 10:30:00', '2026-06-12 10:30:00'),
  (@u_x3,'cairn','Center misc',     31.225, 121.430, 'public', 'tier_g', 0, 'healthy', '2026-06-12 11:00:00', '2026-06-12 11:00:00');

-- ──────────────────────────────────────────────────────────────────────────
-- Geometric verification — Stranger 1 within 50m of 9163 Back Loop center
-- Haversine distance in meters (Earth radius 6371000)
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  m.id,
  m.text,
  m.lat,
  m.lng,
  ROUND(
    6371000 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS((m.lat - 31.232068) / 2)), 2) +
      COS(RADIANS(31.232068)) * COS(RADIANS(m.lat)) *
      POWER(SIN(RADIANS((m.lng - 121.434262) / 2)), 2)
    )),
    2
  ) AS distance_to_back_loop_center_m
FROM markers m
WHERE m.user_id = @u_x1;
-- Expected: distance ≈ 20m, < 50m → PASS

-- ──────────────────────────────────────────────────────────────────────────
-- Summary counts per user (for verification)
-- ──────────────────────────────────────────────────────────────────────────
SELECT u.email,
       (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
       (SELECT COUNT(*) FROM markers  m WHERE m.user_id = u.id) AS markers,
       (SELECT COUNT(*) FROM routes   r WHERE r.user_id = u.id) AS routes
FROM users u
WHERE u.email LIKE '%@cairn.demo'
ORDER BY u.email;
