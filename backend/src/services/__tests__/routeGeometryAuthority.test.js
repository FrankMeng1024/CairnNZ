'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeRouteGeometry } = require('../routeGeometryAuthority');

const a = { lat: -41.29, lng: 174.77 };
const b = { lat: -41.285, lng: 174.775 };
const c = { lat: -41.28, lng: 174.78 };

function draft(parts, gaps = []) {
  return { schemaVersion: 1, draftId: 'draft-a', ownerId: '7', origin: 'plan', revision: 2, parts, gaps };
}

test('derives continuous authority and preserves connected provenance sections', () => {
  const ordered = draft([
    { id: 'recorded', resolution: 'recorded', points: [a, b] },
    { id: 'replacement', resolution: 'point', points: [b, c] },
  ]);
  const result = authorizeRouteGeometry({ ownerId: 7, points: [a, b, c], orderedDraft: ordered, resolutionState: 'continuous' });
  assert.equal(result.resolutionState, 'continuous');
  assert.deepEqual(result.points, [a, b, c]);
});

test('rejects a fake continuous state for a real ordered gap', () => {
  const ordered = draft([
    { id: 'left', resolution: 'recorded', points: [a, b] },
    { id: 'right', resolution: 'recorded', points: [{ lat: -41.2, lng: 174.9 }, c] },
  ], [{ id: 'gap-a', afterPartId: 'left', reason: 'activity-gap' }]);
  assert.throws(
    () => authorizeRouteGeometry({ ownerId: 7, points: [a, b, { lat: -41.2, lng: 174.9 }, c], orderedDraft: ordered, resolutionState: 'continuous' }),
    error => error.code === 'ROUTE_RESOLUTION_MISMATCH',
  );
});

test('rejects a fabricated flat shortcut, cross-owner draft and invalid gap reference', () => {
  const ordered = draft([{ id: 'path', resolution: 'draw-manual', points: [a, b, c] }]);
  assert.throws(
    () => authorizeRouteGeometry({ ownerId: 7, points: [a, c], orderedDraft: ordered, resolutionState: 'continuous' }),
    error => error.code === 'ROUTE_POINTS_MISMATCH',
  );
  assert.throws(
    () => authorizeRouteGeometry({ ownerId: 8, points: [a, b, c], orderedDraft: ordered, resolutionState: 'continuous' }),
    error => error.code === 'ROUTE_DRAFT_OWNER_MISMATCH',
  );
  const invalidGap = draft([{ id: 'path', resolution: 'recorded', points: [a, c] }], [{ id: 'gap', afterPartId: 'missing', reason: 'activity-gap' }]);
  assert.throws(
    () => authorizeRouteGeometry({ ownerId: 7, points: [a, c], orderedDraft: invalidGap, resolutionState: 'unresolved_gaps' }),
    error => error.code === 'ROUTE_GEOMETRY_INVALID',
  );
});
