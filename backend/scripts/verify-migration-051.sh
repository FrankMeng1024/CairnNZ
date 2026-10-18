#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD required}"

query() {
  if [ -n "${MYSQL_DOCKER_CONTAINER:-}" ]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_DOCKER_CONTAINER" \
      mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
  else
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  fi
}

[ "$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('memory_coverage_evidence','memory_coverage_tiles','memory_coverage_source_state','memory_coverage_regions')")" = "4" ]
[ "$(query "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_coverage_evidence' AND index_name='idx_memory_coverage_owner_ready_tile'")" -ge "1" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_evidence evidence LEFT JOIN memory_points point ON point.id=evidence.memory_point_id WHERE point.id IS NULL")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_evidence WHERE coverage_rule_version<>4")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_regions mapped LEFT JOIN memory_coverage_evidence evidence ON evidence.memory_point_id=mapped.memory_point_id WHERE evidence.memory_point_id IS NULL")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_points mp WHERE mp.evidence_source IN ('activity_real','passive_real') AND mp.continuity_state='accepted' AND mp.horizontal_accuracy_m BETWEEN 0 AND 50 AND mp.ts<=(UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000)+300000 AND (mp.evidence_source='passive_real' OR EXISTS (SELECT 1 FROM sessions source_session JOIN JSON_TABLE(COALESCE(source_session.route_points_canonical,JSON_ARRAY()), '\$[*]' COLUMNS(lat DOUBLE PATH '\$.lat',lng DOUBLE PATH '\$.lng',observed_ms BIGINT PATH '\$.t',segment_id VARCHAR(80) PATH '\$.segment_id')) canonical ON ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(mp.ts AS SIGNED))<=1000 AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(mp.lng,mp.lat))<=5 AND CONVERT(COALESCE(canonical.segment_id,'legacy-0') USING utf8mb4) COLLATE utf8mb4_unicode_ci=COALESCE(mp.source_segment_id,'legacy-0') COLLATE utf8mb4_unicode_ci WHERE source_session.user_id=mp.user_id AND source_session.client_activity_id=mp.source_activity_client_id AND source_session.finalized_at IS NOT NULL AND source_session.abandoned_at IS NULL AND source_session.source_provenance='native_real')) AND NOT EXISTS (SELECT 1 FROM memory_coverage_evidence evidence WHERE evidence.memory_point_id=mp.id)")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_evidence evidence JOIN memory_points point ON point.id=evidence.memory_point_id JOIN regions region ON region.level IN (2,3) AND point.lng BETWEEN region.bbox_min_lng AND region.bbox_max_lng AND point.lat BETWEEN region.bbox_min_lat AND region.bbox_max_lat AND ST_Contains(region.geom,ST_GeomFromText(CONCAT('POINT(',point.lng,' ',point.lat,')'),4326,'axis-order=long-lat')) LEFT JOIN memory_coverage_regions mapped ON mapped.memory_point_id=evidence.memory_point_id AND mapped.region_id=region.id COLLATE utf8mb4_unicode_ci WHERE evidence.coverage_rule_version=4 AND mapped.memory_point_id IS NULL")" = "0" ]

echo "migration 051 verified"
