'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'public-cairns.js'), 'utf8');

test('Public encounter verification accepts active real Activities via incremental route authority', () => {
  assert.match(source, /WHERE user_id=\? AND client_activity_id=\?[\s\S]*AND abandoned_at IS NULL[\s\S]*eligibleSourceProvenanceSql/);
  assert.doesNotMatch(source.slice(source.indexOf("router.post('/encounters/verify'"), source.indexOf("router.get('/scene'")), /Only a completed real Activity/);
  assert.match(source, /CASE WHEN source_session\.finalized_at IS NULL\s+THEN source_session\.route_points\s+ELSE source_session\.route_points_canonical END/);
  assert.match(source, /CASE WHEN session\.finalized_at IS NULL\s+THEN session\.route_points\s+ELSE session\.route_points_canonical END/);
  assert.ok((source.match(/witness\.evidence_source='activity_real'/g) ?? []).length >= 4);
});

test('Public live verification still binds witnesses to server Activity points and current publication', () => {
  assert.match(source, /ABS\(CAST\(canonical\.observed_ms AS SIGNED\)-CAST\(evidence\.ts AS SIGNED\)\) <= 1000/);
  assert.match(source, /ST_Distance_Sphere\(POINT\(canonical\.lng,canonical\.lat\),POINT\(evidence\.lng,evidence\.lat\)\) <= 5/);
  assert.match(source, /FROM_UNIXTIME\(evidence\.ts \/ 1000\) >= \?/);
  assert.match(source, /marker\.publication_epoch=publication\.publication_epoch/);
  assert.match(source, /marker\.content_revision=publication\.content_revision/);
  assert.match(source, /evidence_observed_at_ms,evidence_segment_id,evidence_source/);
  assert.match(source, /COALESCE\(encounter\.evidence_lng,/);
  assert.match(source, /COALESCE\(encounter\.evidence_lat,/);
  assert.match(source, /COALESCE\(encounter\.evidence_segment_id,witness\.source_segment_id,'legacy-0'\)/);
});

test('consumer Public API requests use owner canary while operator incident access survives the kill switch', () => {
  assert.match(source, /enabled: publicPilotAuthorized\(req\.user\.userId\)/);
  assert.match(source, /req\.path\.startsWith\('\/operator\/'\) \|\| publicPilotAuthorized\(req\.user\.userId\)/);
  assert.match(source, /router\.get\('\/operator\/audit', requireOperator/);
  assert.match(source, /row && publicPilotAuthorized\(row\.author_id\) \? row : null/);
  assert.match(source, /candidates\.filter\(row => publicPilotAuthorized\(row\.author_id\)\)/);
  assert.match(source, /rows\.filter\(candidate => publicPilotAuthorized\(candidate\.author_id\)\)/);
});
