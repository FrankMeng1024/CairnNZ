-- v434 hierarchy migration
-- Adds Malaysia + 13 Malaysian states + 20 Chinese prefecture-level cities.
-- Idempotent via INSERT IGNORE.

-- ================================================================
-- 1. Malaysia country + 13 states
-- ================================================================

INSERT IGNORE INTO regions
  (id, parent_id, name_en, level, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, geom, source)
VALUES
  -- Malaysia country
  ('MYS', 'AS', 'Malaysia', 2,
    99.6413, 0.8557, 119.2711, 7.3819,
    ST_GeomFromText('POLYGON((99.6413 0.8557, 119.2711 0.8557, 119.2711 7.3819, 99.6413 7.3819, 99.6413 0.8557))', 4326, 'axis-order=long-lat'),
    'manual-v434'),
  -- Peninsular states
  ('MY-johor', 'MYS', 'Johor', 3, 102.5, 1.2, 104.5, 2.8,
    ST_GeomFromText('POLYGON((102.5 1.2, 104.5 1.2, 104.5 2.8, 102.5 2.8, 102.5 1.2))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-kedah', 'MYS', 'Kedah', 3, 99.6, 5.3, 101.3, 6.8,
    ST_GeomFromText('POLYGON((99.6 5.3, 101.3 5.3, 101.3 6.8, 99.6 6.8, 99.6 5.3))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-kelantan', 'MYS', 'Kelantan', 3, 101.5, 4.6, 102.7, 6.3,
    ST_GeomFromText('POLYGON((101.5 4.6, 102.7 4.6, 102.7 6.3, 101.5 6.3, 101.5 4.6))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-kuala-lumpur', 'MYS', 'Kuala Lumpur', 3, 101.6, 3.05, 101.75, 3.25,
    ST_GeomFromText('POLYGON((101.6 3.05, 101.75 3.05, 101.75 3.25, 101.6 3.25, 101.6 3.05))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-labuan', 'MYS', 'Labuan', 3, 115.15, 5.25, 115.30, 5.36,
    ST_GeomFromText('POLYGON((115.15 5.25, 115.30 5.25, 115.30 5.36, 115.15 5.36, 115.15 5.25))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-melaka', 'MYS', 'Melaka', 3, 102.0, 2.15, 102.6, 2.55,
    ST_GeomFromText('POLYGON((102.0 2.15, 102.6 2.15, 102.6 2.55, 102.0 2.55, 102.0 2.15))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-negeri-sembilan', 'MYS', 'Negeri Sembilan', 3, 101.7, 2.3, 102.9, 3.3,
    ST_GeomFromText('POLYGON((101.7 2.3, 102.9 2.3, 102.9 3.3, 101.7 3.3, 101.7 2.3))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-pahang', 'MYS', 'Pahang', 3, 101.3, 2.5, 103.7, 4.8,
    ST_GeomFromText('POLYGON((101.3 2.5, 103.7 2.5, 103.7 4.8, 101.3 4.8, 101.3 2.5))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-penang', 'MYS', 'Penang', 3, 100.1, 5.15, 100.55, 5.55,
    ST_GeomFromText('POLYGON((100.1 5.15, 100.55 5.15, 100.55 5.55, 100.1 5.55, 100.1 5.15))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-perak', 'MYS', 'Perak', 3, 100.1, 3.6, 102.0, 5.9,
    ST_GeomFromText('POLYGON((100.1 3.6, 102.0 3.6, 102.0 5.9, 100.1 5.9, 100.1 3.6))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-perlis', 'MYS', 'Perlis', 3, 100.1, 6.4, 100.55, 6.75,
    ST_GeomFromText('POLYGON((100.1 6.4, 100.55 6.4, 100.55 6.75, 100.1 6.75, 100.1 6.4))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-putrajaya', 'MYS', 'Putrajaya', 3, 101.66, 2.90, 101.73, 2.98,
    ST_GeomFromText('POLYGON((101.66 2.90, 101.73 2.90, 101.73 2.98, 101.66 2.98, 101.66 2.90))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-sabah', 'MYS', 'Sabah', 3, 115.2, 4.0, 119.3, 7.4,
    ST_GeomFromText('POLYGON((115.2 4.0, 119.3 4.0, 119.3 7.4, 115.2 7.4, 115.2 4.0))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-sarawak', 'MYS', 'Sarawak', 3, 109.5, 0.85, 115.7, 5.0,
    ST_GeomFromText('POLYGON((109.5 0.85, 115.7 0.85, 115.7 5.0, 109.5 5.0, 109.5 0.85))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-selangor', 'MYS', 'Selangor', 3, 100.8, 2.6, 101.9, 3.9,
    ST_GeomFromText('POLYGON((100.8 2.6, 101.9 2.6, 101.9 3.9, 100.8 3.9, 100.8 2.6))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('MY-terengganu', 'MYS', 'Terengganu', 3, 102.3, 4.0, 103.7, 5.9,
    ST_GeomFromText('POLYGON((102.3 4.0, 103.7 4.0, 103.7 5.9, 102.3 5.9, 102.3 4.0))', 4326, 'axis-order=long-lat'), 'manual-v434');

-- ================================================================
-- 2. Chinese prefecture-level cities (20 major cities)
-- Note: parent_id = 'CHN' directly (skip province level for these).
-- These coexist with existing province rows (CN-jiangsu etc). User will
-- see cities and provinces mixed in the list. v434 treats level=3 as
-- "child of country" regardless of subtype.
-- ================================================================

INSERT IGNORE INTO regions
  (id, parent_id, name_en, level, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, geom, source)
VALUES
  ('CN-suzhou', 'CHN', 'Suzhou', 3, 119.55, 30.75, 121.20, 32.05,
    ST_GeomFromText('POLYGON((119.55 30.75, 121.20 30.75, 121.20 32.05, 119.55 32.05, 119.55 30.75))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-hangzhou', 'CHN', 'Hangzhou', 3, 118.35, 29.20, 120.70, 30.55,
    ST_GeomFromText('POLYGON((118.35 29.20, 120.70 29.20, 120.70 30.55, 118.35 30.55, 118.35 29.20))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-nanjing', 'CHN', 'Nanjing', 3, 118.35, 31.15, 119.25, 32.60,
    ST_GeomFromText('POLYGON((118.35 31.15, 119.25 31.15, 119.25 32.60, 118.35 32.60, 118.35 31.15))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-shenzhen', 'CHN', 'Shenzhen', 3, 113.75, 22.45, 114.65, 22.90,
    ST_GeomFromText('POLYGON((113.75 22.45, 114.65 22.45, 114.65 22.90, 113.75 22.90, 113.75 22.45))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-guangzhou', 'CHN', 'Guangzhou', 3, 112.90, 22.55, 114.10, 23.95,
    ST_GeomFromText('POLYGON((112.90 22.55, 114.10 22.55, 114.10 23.95, 112.90 23.95, 112.90 22.55))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-chengdu', 'CHN', 'Chengdu', 3, 102.90, 30.05, 104.90, 31.45,
    ST_GeomFromText('POLYGON((102.90 30.05, 104.90 30.05, 104.90 31.45, 102.90 31.45, 102.90 30.05))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-xian', 'CHN', 'Xi''an', 3, 107.60, 33.65, 109.80, 34.75,
    ST_GeomFromText('POLYGON((107.60 33.65, 109.80 33.65, 109.80 34.75, 107.60 34.75, 107.60 33.65))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-wuhan', 'CHN', 'Wuhan', 3, 113.70, 29.95, 115.10, 31.35,
    ST_GeomFromText('POLYGON((113.70 29.95, 115.10 29.95, 115.10 31.35, 113.70 31.35, 113.70 29.95))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-changsha', 'CHN', 'Changsha', 3, 111.80, 27.85, 114.25, 28.70,
    ST_GeomFromText('POLYGON((111.80 27.85, 114.25 27.85, 114.25 28.70, 111.80 28.70, 111.80 27.85))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-qingdao', 'CHN', 'Qingdao', 3, 119.30, 35.55, 121.00, 37.15,
    ST_GeomFromText('POLYGON((119.30 35.55, 121.00 35.55, 121.00 37.15, 119.30 37.15, 119.30 35.55))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-dalian', 'CHN', 'Dalian', 3, 121.15, 38.75, 123.30, 40.20,
    ST_GeomFromText('POLYGON((121.15 38.75, 123.30 38.75, 123.30 40.20, 121.15 40.20, 121.15 38.75))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-xiamen', 'CHN', 'Xiamen', 3, 117.85, 24.35, 118.45, 24.90,
    ST_GeomFromText('POLYGON((117.85 24.35, 118.45 24.35, 118.45 24.90, 117.85 24.90, 117.85 24.35))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-kunming', 'CHN', 'Kunming', 3, 102.20, 24.40, 103.70, 26.55,
    ST_GeomFromText('POLYGON((102.20 24.40, 103.70 24.40, 103.70 26.55, 102.20 26.55, 102.20 24.40))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-hefei', 'CHN', 'Hefei', 3, 116.55, 30.90, 117.80, 32.65,
    ST_GeomFromText('POLYGON((116.55 30.90, 117.80 30.90, 117.80 32.65, 116.55 32.65, 116.55 30.90))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-zhengzhou', 'CHN', 'Zhengzhou', 3, 112.70, 34.25, 114.30, 34.95,
    ST_GeomFromText('POLYGON((112.70 34.25, 114.30 34.25, 114.30 34.95, 112.70 34.95, 112.70 34.25))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-jinan', 'CHN', 'Jinan', 3, 116.30, 36.05, 117.85, 37.60,
    ST_GeomFromText('POLYGON((116.30 36.05, 117.85 36.05, 117.85 37.60, 116.30 37.60, 116.30 36.05))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-sanya', 'CHN', 'Sanya', 3, 108.90, 18.15, 109.90, 18.65,
    ST_GeomFromText('POLYGON((108.90 18.15, 109.90 18.15, 109.90 18.65, 108.90 18.65, 108.90 18.15))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-lhasa', 'CHN', 'Lhasa', 3, 90.35, 29.15, 91.85, 30.55,
    ST_GeomFromText('POLYGON((90.35 29.15, 91.85 29.15, 91.85 30.55, 90.35 30.55, 90.35 29.15))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-ulumuqi', 'CHN', 'Urumqi', 3, 86.65, 42.75, 88.85, 44.15,
    ST_GeomFromText('POLYGON((86.65 42.75, 88.85 42.75, 88.85 44.15, 86.65 44.15, 86.65 42.75))', 4326, 'axis-order=long-lat'), 'manual-v434'),
  ('CN-harbin', 'CHN', 'Harbin', 3, 125.75, 44.05, 130.15, 46.65,
    ST_GeomFromText('POLYGON((125.75 44.05, 130.15 44.05, 130.15 46.65, 125.75 46.65, 125.75 44.05))', 4326, 'axis-order=long-lat'), 'manual-v434');

-- ================================================================
-- 3. Verify
-- ================================================================

SELECT COUNT(*) as total_l2, 'countries' as t FROM regions WHERE level=2
UNION SELECT COUNT(*), 'cn_children' FROM regions WHERE parent_id='CHN'
UNION SELECT COUNT(*), 'my_children' FROM regions WHERE parent_id='MYS'
UNION SELECT COUNT(*), 'v434_new' FROM regions WHERE source='manual-v434';
