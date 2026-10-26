'use strict';

const crypto = require('crypto');
const polygonClipping = require('polygon-clipping');
const { eligibleSourceProvenanceSql } = require('./activitySourceProvenance');

const COVERAGE_RULE_VERSION = 4;
const COVERAGE_RADIUS_M = 30;
const COVERAGE_RING_STEPS = 20;
const EARTH_RADIUS_M = 6371008.8;
const MERCATOR_RADIUS_M = 6378137;
const TILE_SIZE_M = 1000;
const MAX_VIEWPORT_SPAN_DEGREES = 20;
const DEFAULT_SNAPSHOT_PAGE_SIZE = 24;
const MAX_SNAPSHOT_PAGE_SIZE = 64;
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

function mercatorTile(lat, lng) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const x = MERCATOR_RADIUS_M * Number(lng) * Math.PI / 180;
  const y = MERCATOR_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + clamped * Math.PI / 360));
  return { x: Math.floor(x / TILE_SIZE_M), y: Math.floor(y / TILE_SIZE_M) };
}

function latitudeFromMercatorY(y) {
  return (2 * Math.atan(Math.exp(y / MERCATOR_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI;
}

function coverageTileBbox(tile) {
  const west = tile.x * TILE_SIZE_M / MERCATOR_RADIUS_M * 180 / Math.PI;
  const east = (tile.x + 1) * TILE_SIZE_M / MERCATOR_RADIUS_M * 180 / Math.PI;
  const south = latitudeFromMercatorY(tile.y * TILE_SIZE_M);
  const north = latitudeFromMercatorY((tile.y + 1) * TILE_SIZE_M);
  return [west, Math.min(south, north), east, Math.max(south, north)];
}

function snapshotPageSize(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_SNAPSHOT_PAGE_SIZE;
  return Math.min(MAX_SNAPSHOT_PAGE_SIZE, parsed);
}

function snapshotCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function parseSnapshotCursor(value) {
  if (value == null || value === '') return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return Number.isInteger(parsed?.offset) && parsed.offset >= 0 ? parsed.offset : null;
  } catch {
    return null;
  }
}

function snapshotVisibleAt(value, nowMs = Date.now()) {
  if (value == null) return new Date(nowMs);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)
    || parsed > nowMs + 60_000
    || nowMs - parsed > SNAPSHOT_MAX_AGE_MS) return null;
  return new Date(parsed);
}

function coverageRing(latValue, lngValue) {
  const lat = Number(latValue) * Math.PI / 180;
  const lng = Number(lngValue) * Math.PI / 180;
  const angular = COVERAGE_RADIUS_M / EARTH_RADIUS_M;
  const ring = [];
  for (let index = 0; index < COVERAGE_RING_STEPS; index += 1) {
    const bearing = index * 2 * Math.PI / COVERAGE_RING_STEPS;
    const circleLat = Math.asin(
      Math.sin(lat) * Math.cos(angular)
      + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
    );
    const circleLng = lng + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(circleLat),
    );
    ring.push([circleLng * 180 / Math.PI, circleLat * 180 / Math.PI]);
  }
  ring.push([...ring[0]]);
  return ring;
}

function unionPolygonInputs(inputs) {
  if (!inputs.length) return [];
  let level = inputs;
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 64) {
      const chunk = level.slice(index, index + 64);
      next.push(chunk.length === 1 ? chunk[0] : polygonClipping.union(...chunk));
    }
    level = next;
  }
  return level[0];
}

function asGeometry(coordinates) {
  return { type: 'MultiPolygon', coordinates: Array.isArray(coordinates) ? coordinates : [] };
}

function geometryHash(geometry) {
  return crypto.createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
}

function parseViewport(raw) {
  const values = Array.isArray(raw) ? raw.map(Number) : [];
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -85 || north > 85
    || west >= east || south >= north
    || east - west > MAX_VIEWPORT_SPAN_DEGREES
    || north - south > MAX_VIEWPORT_SPAN_DEGREES) return null;
  return { west, south, east, north };
}

function viewportTileBounds(viewport) {
  const latPad = COVERAGE_RADIUS_M / 110574;
  const midLat = (viewport.south + viewport.north) / 2;
  const lngPad = COVERAGE_RADIUS_M / Math.max(1, 111320 * Math.cos(midLat * Math.PI / 180));
  const sw = mercatorTile(viewport.south - latPad, viewport.west - lngPad);
  const ne = mercatorTile(viewport.north + latPad, viewport.east + lngPad);
  return { minX: sw.x, maxX: ne.x, minY: sw.y, maxY: ne.y };
}

async function synchronizeCoverageSubset(db, ownerId, filterSql = '', filterParams = []) {
  const [result] = await db.execute(
    `INSERT IGNORE INTO memory_coverage_evidence
       (memory_point_id, owner_id, coverage_rule_version, tile_x, tile_y,
        observed_at_ms, share_ready_at, evidence_source)
     SELECT mp.id,mp.user_id,${COVERAGE_RULE_VERSION},
            FLOOR((6378137 * RADIANS(mp.lng)) / ${TILE_SIZE_M}),
            FLOOR((6378137 * LOG(TAN(PI()/4 + RADIANS(
              GREATEST(-85.05112878, LEAST(85.05112878,mp.lat))) / 2))) / ${TILE_SIZE_M}),
            mp.ts,
            DATE_ADD(GREATEST(
              TIMESTAMPADD(
                MICROSECOND,
                MOD(mp.ts,1000)*1000,
                TIMESTAMPADD(SECOND,FLOOR(mp.ts/1000),CAST('1970-01-01 00:00:00.000' AS DATETIME(3)))
              ),
              mp.received_at
            ),INTERVAL 1800 SECOND),
            mp.evidence_source
       FROM memory_points mp
      WHERE mp.user_id=?
        AND mp.evidence_source IN ('activity_real','passive_real')
        AND mp.continuity_state='accepted'
        AND mp.horizontal_accuracy_m IS NOT NULL
        AND mp.horizontal_accuracy_m BETWEEN 0 AND 50
        AND mp.ts <= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000)+300000
        ${filterSql}
        AND (mp.evidence_source='passive_real' OR EXISTS (
          SELECT 1 FROM sessions source_session
          JOIN JSON_TABLE(COALESCE(source_session.route_points_canonical,JSON_ARRAY()), '$[*]' COLUMNS(
            lat DOUBLE PATH '$.lat',lng DOUBLE PATH '$.lng',
            observed_ms BIGINT PATH '$.t',segment_id VARCHAR(80) PATH '$.segment_id'
          )) canonical
            ON ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(mp.ts AS SIGNED))<=1000
           AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(mp.lng,mp.lat))<=5
           AND CONVERT(COALESCE(canonical.segment_id,'legacy-0') USING utf8mb4) COLLATE utf8mb4_unicode_ci
               =COALESCE(mp.source_segment_id,'legacy-0') COLLATE utf8mb4_unicode_ci
         WHERE source_session.user_id=mp.user_id
           AND source_session.client_activity_id=mp.source_activity_client_id
           AND source_session.finalized_at IS NOT NULL
           AND source_session.abandoned_at IS NULL
           AND ${eligibleSourceProvenanceSql('source_session.source_provenance')}
        ))`,
    [ownerId, ...filterParams],
  );
  await db.execute(
    `INSERT IGNORE INTO memory_coverage_regions
       (memory_point_id,owner_id,coverage_rule_version,region_id,region_level,share_ready_at)
     SELECT evidence.memory_point_id,evidence.owner_id,evidence.coverage_rule_version,
            region.id,region.level,evidence.share_ready_at
       FROM memory_coverage_evidence evidence
       JOIN memory_points mp ON mp.id=evidence.memory_point_id
       JOIN regions region
         ON region.level IN (2,3)
        AND mp.lng BETWEEN region.bbox_min_lng AND region.bbox_max_lng
        AND mp.lat BETWEEN region.bbox_min_lat AND region.bbox_max_lat
        AND ST_Contains(region.geom,ST_GeomFromText(
              CONCAT('POINT(',mp.lng,' ',mp.lat,')'),4326,'axis-order=long-lat'))
      WHERE evidence.owner_id=? AND evidence.coverage_rule_version=${COVERAGE_RULE_VERSION}
        ${filterSql}`,
    [ownerId, ...filterParams],
  );
  if (Number(result.affectedRows) > 0) {
    await db.execute(
      `INSERT INTO memory_coverage_source_state
         (owner_id,coverage_rule_version,evidence_revision)
       VALUES (?,${COVERAGE_RULE_VERSION},1)
       ON DUPLICATE KEY UPDATE evidence_revision=evidence_revision+1,
         coverage_rule_version=VALUES(coverage_rule_version)`,
      [ownerId],
    );
  }
  return Number(result.affectedRows) || 0;
}

async function synchronizeCoverageEvidence(db, ownerId) {
  return synchronizeCoverageSubset(db, ownerId);
}

async function synchronizeCoverageEvidenceForClientIds(db, ownerId, rawClientIds) {
  const clientIds = [...new Set((rawClientIds || []).map(String).filter(Boolean))];
  let inserted = 0;
  for (let index = 0; index < clientIds.length; index += 400) {
    const chunk = clientIds.slice(index, index + 400);
    inserted += await synchronizeCoverageSubset(
      db,
      ownerId,
      `AND mp.client_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
  }
  return inserted;
}

async function synchronizeCoverageEvidenceForActivity(db, ownerId, clientActivityId) {
  if (!clientActivityId) return 0;
  return synchronizeCoverageSubset(
    db,
    ownerId,
    'AND mp.source_activity_client_id=?',
    [String(clientActivityId)],
  );
}

async function synchronizeCoverageEvidenceForSegments(db, ownerId, rawSegmentIds) {
  const segmentIds = [...new Set((rawSegmentIds || []).map(String).filter(Boolean))];
  let inserted = 0;
  for (let index = 0; index < segmentIds.length; index += 400) {
    const chunk = segmentIds.slice(index, index + 400);
    inserted += await synchronizeCoverageSubset(
      db,
      ownerId,
      `AND mp.source_segment_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
  }
  return inserted;
}

function visibilityFence(visibility, alias, visibleAt) {
  if (visibility !== 'shared') return { sql: '', params: [] };
  return visibleAt
    ? { sql: `AND ${alias}.share_ready_at <= ?`, params: [visibleAt] }
    : { sql: `AND ${alias}.share_ready_at <= UTC_TIMESTAMP(3)`, params: [] };
}

async function tileSummary(db, ownerId, visibility, tile, visibleAt = null) {
  const ready = visibilityFence(visibility, 'evidence', visibleAt);
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS evidence_count,COALESCE(MAX(memory_point_id),0) AS evidence_max_id
       FROM memory_coverage_evidence evidence
      WHERE evidence.owner_id=? AND evidence.coverage_rule_version=${COVERAGE_RULE_VERSION}
        AND evidence.tile_x=? AND evidence.tile_y=? ${ready.sql}`,
    [ownerId, tile.x, tile.y, ...ready.params],
  );
  return {
    count: Number(rows[0]?.evidence_count) || 0,
    maxId: Number(rows[0]?.evidence_max_id) || 0,
  };
}

async function buildTile(db, ownerId, visibility, tile, summary, visibleAt = null) {
  const ready = visibilityFence(visibility, 'evidence', visibleAt);
  const [rows] = await db.execute(
    `SELECT point.lat,point.lng
       FROM memory_coverage_evidence evidence
       JOIN memory_points point ON point.id=evidence.memory_point_id
      WHERE evidence.owner_id=? AND evidence.coverage_rule_version=${COVERAGE_RULE_VERSION}
        AND evidence.tile_x=? AND evidence.tile_y=? ${ready.sql}
      ORDER BY evidence.memory_point_id`,
    [ownerId, tile.x, tile.y, ...ready.params],
  );
  const coordinates = unionPolygonInputs(rows.map(row => [coverageRing(row.lat, row.lng)]));
  const geometry = asGeometry(coordinates);
  const hash = geometryHash(geometry);
  await db.execute(
    `INSERT INTO memory_coverage_tiles
       (owner_id,coverage_rule_version,visibility,tile_x,tile_y,evidence_count,
        evidence_max_id,geometry_json,geometry_sha256,built_at)
     VALUES (?,${COVERAGE_RULE_VERSION},?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE evidence_count=VALUES(evidence_count),
       evidence_max_id=VALUES(evidence_max_id),geometry_json=VALUES(geometry_json),
       geometry_sha256=VALUES(geometry_sha256),built_at=VALUES(built_at)`,
    [ownerId, visibility, tile.x, tile.y, summary.count, summary.maxId, JSON.stringify(geometry), hash],
  );
  return { geometry, hash, rebuilt: true, evidenceCount: summary.count };
}

async function loadTile(db, ownerId, visibility, tile, visibleAt = null, expectedSummary = null) {
  const summary = expectedSummary ?? await tileSummary(db, ownerId, visibility, tile, visibleAt);
  const [cached] = await db.execute(
    `SELECT evidence_count,evidence_max_id,geometry_json,geometry_sha256
       FROM memory_coverage_tiles
      WHERE owner_id=? AND coverage_rule_version=${COVERAGE_RULE_VERSION}
        AND visibility=? AND tile_x=? AND tile_y=?`,
    [ownerId, visibility, tile.x, tile.y],
  );
  const row = cached[0];
  if (row && Number(row.evidence_count) === summary.count
    && Number(row.evidence_max_id) === summary.maxId) {
    return {
      geometry: JSON.parse(row.geometry_json),
      hash: row.geometry_sha256,
      rebuilt: false,
      evidenceCount: summary.count,
    };
  }
  return buildTile(db, ownerId, visibility, tile, summary, visibleAt);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function loadPreparedCoverage(db, ownerId, visibility, viewport) {
  const bounds = viewportTileBounds(viewport);
  const ready = visibility === 'shared' ? 'AND evidence.share_ready_at <= UTC_TIMESTAMP(3)' : '';
  const summaryStartedAt = Date.now();
  const [summaryRows] = await db.execute(
    `SELECT evidence.tile_x,evidence.tile_y,COUNT(*) AS evidence_count,
            COALESCE(MAX(evidence.memory_point_id),0) AS evidence_max_id
       FROM memory_coverage_evidence evidence
      WHERE evidence.owner_id=? AND evidence.coverage_rule_version=${COVERAGE_RULE_VERSION}
        AND evidence.tile_x BETWEEN ? AND ? AND evidence.tile_y BETWEEN ? AND ? ${ready}
      GROUP BY evidence.tile_x,evidence.tile_y
      ORDER BY evidence.tile_y,evidence.tile_x`,
    [ownerId, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY],
  );
  const summaryMs = Date.now() - summaryStartedAt;
  const cacheStartedAt = Date.now();
  const [cachedRows] = await db.execute(
    `SELECT tile_x,tile_y,evidence_count,evidence_max_id,geometry_json,geometry_sha256
       FROM memory_coverage_tiles
      WHERE owner_id=? AND coverage_rule_version=${COVERAGE_RULE_VERSION} AND visibility=?
        AND tile_x BETWEEN ? AND ? AND tile_y BETWEEN ? AND ?`,
    [ownerId, visibility, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY],
  );
  const cacheMs = Date.now() - cacheStartedAt;
  const cachedByTile = new Map(cachedRows.map(row => [`${row.tile_x}:${row.tile_y}`, row]));
  const buildStartedAt = Date.now();
  const loaded = await mapWithConcurrency(summaryRows, 4, async row => {
    const tile = { x: Number(row.tile_x), y: Number(row.tile_y) };
    const summary = { count: Number(row.evidence_count), maxId: Number(row.evidence_max_id) };
    const cached = cachedByTile.get(`${tile.x}:${tile.y}`);
    if (cached && Number(cached.evidence_count) === summary.count
      && Number(cached.evidence_max_id) === summary.maxId) {
      return {
        geometry: JSON.parse(cached.geometry_json),
        hash: cached.geometry_sha256,
        rebuilt: false,
        evidenceCount: summary.count,
      };
    }
    return buildTile(db, ownerId, visibility, tile, summary);
  });
  const tileBuildMs = Date.now() - buildStartedAt;
  const unionStartedAt = Date.now();
  const polygons = loaded.flatMap(item => item.geometry?.coordinates?.length ? [item.geometry.coordinates] : []);
  const geometry = asGeometry(unionPolygonInputs(polygons));
  const unionMs = Date.now() - unionStartedAt;
  const [stateRows] = await db.execute(
    `SELECT evidence_revision FROM memory_coverage_source_state WHERE owner_id=?`,
    [ownerId],
  );
  const versionMaterial = JSON.stringify({
    rule: COVERAGE_RULE_VERSION,
    visibility,
    revision: Number(stateRows[0]?.evidence_revision) || 0,
    tiles: loaded.map(item => item.hash),
  });
  return {
    coverage_rule_version: COVERAGE_RULE_VERSION,
    radius_m: COVERAGE_RADIUS_M,
    ring_steps: COVERAGE_RING_STEPS,
    geometry,
    evidence_count: loaded.reduce((sum, item) => sum + item.evidenceCount, 0),
    tile_count: summaryRows.length,
    rebuilt_tile_count: loaded.filter(item => item.rebuilt).length,
    coverage_version: crypto.createHash('sha256').update(versionMaterial).digest('hex'),
    stage_ms: {
      evidence_summary: summaryMs,
      prepared_tile_read: cacheMs,
      tile_rebuild: tileBuildMs,
      viewport_union: unionMs,
    },
  };
}

async function loadCoverageRegions(db, ownerId, visibility, visibleAt = null) {
  const ready = visibilityFence(visibility, 'mapped', visibleAt);
  const [rows] = await db.execute(
    `SELECT ranked.id,ranked.parent_id,ranked.level,ranked.name_en,
            ranked.bbox_min_lng,ranked.bbox_min_lat,
            ranked.bbox_max_lng,ranked.bbox_max_lat,
            ranked.anchor_lng,ranked.anchor_lat
       FROM (
         SELECT region.id,region.parent_id,region.level,region.name_en,
                region.bbox_min_lng,region.bbox_min_lat,
                region.bbox_max_lng,region.bbox_max_lat,
                point.lng AS anchor_lng,point.lat AS anchor_lat,
                ROW_NUMBER() OVER (
                  PARTITION BY region.id
                  ORDER BY evidence.observed_at_ms DESC,evidence.memory_point_id DESC
                ) AS recency_rank
           FROM memory_coverage_regions mapped
           JOIN memory_coverage_evidence evidence
             ON evidence.memory_point_id=mapped.memory_point_id
            AND evidence.owner_id=mapped.owner_id
            AND evidence.coverage_rule_version=mapped.coverage_rule_version
           JOIN memory_points point ON point.id=evidence.memory_point_id
           JOIN regions region ON region.id COLLATE utf8mb4_unicode_ci=mapped.region_id
          WHERE mapped.owner_id=? AND mapped.coverage_rule_version=${COVERAGE_RULE_VERSION} ${ready.sql}
       ) ranked
      WHERE ranked.recency_rank=1
      ORDER BY ranked.level,ranked.id`,
    [ownerId, ...ready.params],
  );
  return rows.map(region => ({
    id: String(region.id),
    parent_id: region.parent_id == null ? null : String(region.parent_id),
    level: Number(region.level),
    name_en: String(region.name_en),
    bbox: [
      Number(region.bbox_min_lng), Number(region.bbox_min_lat),
      Number(region.bbox_max_lng), Number(region.bbox_max_lat),
    ],
    // Mine can navigate to its own latest accepted witness. Friends receive a
    // coarse region centre only: coverage geometry is authorized, but a raw
    // foreign observation coordinate is not a navigation/API contract.
    anchor: visibility === 'shared'
      ? [
          (Number(region.bbox_min_lng) + Number(region.bbox_max_lng)) / 2,
          (Number(region.bbox_min_lat) + Number(region.bbox_max_lat)) / 2,
        ]
      : [Number(region.anchor_lng), Number(region.anchor_lat)],
  }));
}

function snapshotChanged(message = 'Coverage snapshot changed') {
  const error = new Error(message);
  error.code = 'SNAPSHOT_CHANGED';
  error.httpStatus = 409;
  return error;
}

async function loadCoverageSnapshotManifest(db, ownerId, visibility, options = {}) {
  const pageSize = snapshotPageSize(options.pageSize);
  const visibleAt = snapshotVisibleAt(options.visibleAt);
  if (!visibleAt) throw snapshotChanged('Coverage snapshot expired');
  const ready = visibilityFence(visibility, 'evidence', visibility === 'shared' ? visibleAt : null);
  const startedAt = Date.now();
  const [tileRows] = await db.execute(
    `SELECT evidence.tile_x,evidence.tile_y,COUNT(*) AS evidence_count,
            COALESCE(MAX(evidence.memory_point_id),0) AS evidence_max_id
       FROM memory_coverage_evidence evidence
      WHERE evidence.owner_id=? AND evidence.coverage_rule_version=${COVERAGE_RULE_VERSION}
        ${ready.sql}
      GROUP BY evidence.tile_x,evidence.tile_y
      ORDER BY evidence.tile_y,evidence.tile_x`,
    [ownerId, ...ready.params],
  );
  const [stateRows] = await db.execute(
    `SELECT evidence_revision FROM memory_coverage_source_state WHERE owner_id=?`,
    [ownerId],
  );
  const regions = await loadCoverageRegions(
    db,
    ownerId,
    visibility,
    visibility === 'shared' ? visibleAt : null,
  );
  const tiles = tileRows.map(row => ({
    id: `${Number(row.tile_x)}:${Number(row.tile_y)}`,
    x: Number(row.tile_x),
    y: Number(row.tile_y),
    evidence_count: Number(row.evidence_count) || 0,
    evidence_max_id: Number(row.evidence_max_id) || 0,
    bbox: coverageTileBbox({ x: Number(row.tile_x), y: Number(row.tile_y) }),
  }));
  const datasetRevision = Number(stateRows[0]?.evidence_revision) || 0;
  const asOf = visibleAt.toISOString();
  const snapshotId = crypto.createHash('sha256').update(JSON.stringify({
    owner: String(ownerId),
    visibility,
    authority: String(options.snapshotAuthority ?? ownerId),
    rule: COVERAGE_RULE_VERSION,
    datasetRevision,
    asOf: visibility === 'shared' ? asOf : null,
    pageSize,
    tiles: tiles.map(tile => [tile.id, tile.evidence_count, tile.evidence_max_id]),
  })).digest('hex');
  return {
    snapshot_id: snapshotId,
    dataset_revision: String(datasetRevision),
    coverage_rule_version: COVERAGE_RULE_VERSION,
    radius_m: COVERAGE_RADIUS_M,
    ring_steps: COVERAGE_RING_STEPS,
    as_of: asOf,
    page_size: pageSize,
    expected_pages: tiles.length === 0 ? 0 : Math.ceil(tiles.length / pageSize),
    expected_tiles: tiles.length,
    expected_evidence_count: tiles.reduce((sum, tile) => sum + tile.evidence_count, 0),
    regions,
    terminal_status: tiles.length === 0 ? 'empty' : 'pages_required',
    complete: tiles.length === 0,
    manifest_ms: Date.now() - startedAt,
    _tiles: tiles,
    _visibleAt: visibility === 'shared' ? visibleAt : null,
  };
}

function publicCoverageSnapshotManifest(manifest) {
  const { _tiles, _visibleAt, ...value } = manifest;
  void _tiles;
  void _visibleAt;
  return value;
}

async function loadCoverageSnapshotPage(db, ownerId, visibility, request = {}) {
  const cursor = parseSnapshotCursor(request.cursor);
  if (cursor == null) {
    const error = new Error('Invalid coverage snapshot cursor');
    error.code = 'INVALID_CURSOR';
    error.httpStatus = 400;
    throw error;
  }
  const manifest = await loadCoverageSnapshotManifest(db, ownerId, visibility, {
    pageSize: request.pageSize,
    visibleAt: request.visibleAt,
    snapshotAuthority: request.snapshotAuthority,
  });
  if (request.snapshotId && request.snapshotId !== manifest.snapshot_id) throw snapshotChanged();
  if (cursor > manifest._tiles.length
    || (cursor !== manifest._tiles.length && cursor % manifest.page_size !== 0)) {
    const error = new Error('Invalid coverage snapshot cursor offset');
    error.code = 'INVALID_CURSOR';
    error.httpStatus = 400;
    throw error;
  }
  const pageRows = manifest._tiles.slice(cursor, cursor + manifest.page_size);
  const buildStartedAt = Date.now();
  const loaded = await mapWithConcurrency(pageRows, 4, tile => loadTile(
    db,
    ownerId,
    visibility,
    { x: tile.x, y: tile.y },
    manifest._visibleAt,
    { count: tile.evidence_count, maxId: tile.evidence_max_id },
  ));
  const revalidated = await loadCoverageSnapshotManifest(db, ownerId, visibility, {
    pageSize: manifest.page_size,
    visibleAt: manifest.as_of,
    snapshotAuthority: request.snapshotAuthority,
  });
  if (revalidated.snapshot_id !== manifest.snapshot_id) throw snapshotChanged();
  const nextOffset = cursor + pageRows.length;
  const complete = nextOffset >= manifest._tiles.length;
  return {
    manifest: publicCoverageSnapshotManifest(manifest),
    page: {
      snapshot_id: manifest.snapshot_id,
      page_index: manifest.page_size === 0 ? 0 : Math.floor(cursor / manifest.page_size),
      tile_offset: cursor,
      tile_count: pageRows.length,
      evidence_count: pageRows.reduce((sum, tile) => sum + tile.evidence_count, 0),
      tiles: pageRows.map((tile, index) => ({
        id: tile.id,
        bbox: tile.bbox,
        evidence_count: tile.evidence_count,
        geometry_sha256: loaded[index].hash,
        geometry: loaded[index].geometry,
      })),
      next_cursor: complete ? null : snapshotCursor(nextOffset),
      terminal_status: complete ? (manifest.expected_tiles === 0 ? 'empty' : 'complete') : 'more',
      complete,
      stage_ms: {
        tile_materialization: Date.now() - buildStartedAt,
      },
    },
  };
}

async function materializeOwnerCoverage(db, ownerId, { synchronize = true } = {}) {
  // Explicit backfills call this with the default so old accepted evidence is
  // discovered before tiles are built. Live ingestion has already inserted
  // the exact affected evidence rows inside its source transaction; repeating
  // the owner-wide INSERT…SELECT in the asynchronous worker needlessly locks
  // historical memory_points and can deadlock a following ingestion/update.
  if (synchronize) await synchronizeCoverageEvidence(db, ownerId);
  const [rows] = await db.execute(
    `SELECT DISTINCT tile_x,tile_y FROM memory_coverage_evidence
      WHERE owner_id=? AND coverage_rule_version=${COVERAGE_RULE_VERSION}`,
    [ownerId],
  );
  for (const row of rows) {
    const tile = { x: Number(row.tile_x), y: Number(row.tile_y) };
    await loadTile(db, ownerId, 'mine', tile);
    await loadTile(db, ownerId, 'shared', tile);
  }
  return rows.length;
}

// Live GPS writes can arrive faster than a tile rebuild. Keep one worker per
// owner and collapse every burst received while it is queued/running into at
// most one follow-up pass. This preserves revision correctness without piling
// up owner-wide scans or concurrent polygon work for the same account.
const materializationJobs = new Map();

function scheduleCoverageMaterialization(db, ownerId) {
  const key = String(ownerId);
  const existing = materializationJobs.get(key);
  if (existing) {
    existing.dirty = true;
    return;
  }
  const job = { dirty: false };
  materializationJobs.set(key, job);
  setImmediate(() => {
    void (async () => {
      do {
        job.dirty = false;
        try {
          await materializeOwnerCoverage(db, ownerId, { synchronize: false });
        } catch (error) {
          console.error('[memory-coverage/materialize]', { ownerId, error: error?.message || String(error) });
        }
      } while (job.dirty);
    })().finally(() => {
      if (materializationJobs.get(key) === job) materializationJobs.delete(key);
    });
  });
}

module.exports = {
  COVERAGE_RULE_VERSION,
  COVERAGE_RADIUS_M,
  COVERAGE_RING_STEPS,
  DEFAULT_SNAPSHOT_PAGE_SIZE,
  MAX_SNAPSHOT_PAGE_SIZE,
  SNAPSHOT_MAX_AGE_MS,
  coverageRing,
  coverageTileBbox,
  mercatorTile,
  parseViewport,
  parseSnapshotCursor,
  snapshotPageSize,
  snapshotVisibleAt,
  synchronizeCoverageEvidence,
  synchronizeCoverageEvidenceForClientIds,
  synchronizeCoverageEvidenceForActivity,
  synchronizeCoverageEvidenceForSegments,
  loadPreparedCoverage,
  loadCoverageRegions,
  loadCoverageSnapshotManifest,
  loadCoverageSnapshotPage,
  publicCoverageSnapshotManifest,
  materializeOwnerCoverage,
  scheduleCoverageMaterialization,
  // Read-only test seam; production callers must use the scheduler function.
  _materializationJobs: materializationJobs,
};
