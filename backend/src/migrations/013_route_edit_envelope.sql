-- 013_route_edit_envelope.sql
-- Cairn MVT-Envelope migration (v224)
--
-- Adds server-precomputed junction graph cache per route. Built once at
-- save time by mvtEnvelopeBuilder.js using Mapbox Vector Tiles. App reads
-- this on edit-mode entry and skips on-device extractor.

CREATE TABLE IF NOT EXISTS route_edit_envelopes (
  route_id        BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  version         INT NOT NULL DEFAULT 1,
  bbox_west       DOUBLE NOT NULL,
  bbox_south      DOUBLE NOT NULL,
  bbox_east       DOUBLE NOT NULL,
  bbox_north      DOUBLE NOT NULL,
  pad_km          DOUBLE NOT NULL DEFAULT 1.5,
  source          VARCHAR(32) NOT NULL DEFAULT 'mapbox-mvt',
  ways_json       MEDIUMTEXT NOT NULL,
  junctions_json  MEDIUMTEXT NOT NULL,
  diagnostics     TEXT NULL,
  generated_at    BIGINT NOT NULL,
  generator_v     INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_envelope_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  INDEX idx_envelope_routeid (route_id),
  INDEX idx_envelope_generator_v (generator_v)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
