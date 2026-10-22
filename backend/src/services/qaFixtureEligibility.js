'use strict';

/**
 * Shanghai QA fixtures are ordinary Cairns with one additional, fail-closed
 * read boundary. Keeping this predicate shared prevents an expired or
 * unreviewed fixture from surviving through a retained-library, deep-link,
 * legacy or presentation query after discovery itself has closed.
 *
 * Callers pass trusted SQL identifiers/expressions from source code, never
 * request data. The expression form avoids adding fragile duplicate bind
 * parameters to every nested query.
 */
function qaFixtureEligibleSql(markerIdExpression, viewerIdExpression) {
  if (!/^[A-Za-z0-9_.]+$/.test(markerIdExpression)
    || !(viewerIdExpression === '?' || /^[A-Za-z0-9_.]+$/.test(viewerIdExpression))) {
    throw new Error('qa_fixture_eligibility_invalid_sql_expression');
  }
  return `NOT EXISTS (
    SELECT 1
      FROM cairn_qa_fixtures qa_fixture
      JOIN cairn_qa_fixture_batches qa_batch
        ON qa_batch.batch_id=qa_fixture.batch_id
     WHERE qa_fixture.marker_id=${markerIdExpression}
       AND (
         qa_fixture.safety_state<>'field_verified'
         OR qa_batch.state<>'active'
         OR qa_batch.expires_at<=UTC_TIMESTAMP(3)
         OR NOT EXISTS (
           SELECT 1 FROM cairn_qa_fixture_readers qa_reader
            WHERE qa_reader.batch_id=qa_batch.batch_id
              AND qa_reader.viewer_id=${viewerIdExpression}
         )
       )
  )`;
}

function qaFixtureExpirySql(markerIdExpression) {
  if (!/^[A-Za-z0-9_.]+$/.test(markerIdExpression)) {
    throw new Error('qa_fixture_expiry_invalid_sql_expression');
  }
  return `(SELECT MIN(qa_expiry_batch.expires_at)
    FROM cairn_qa_fixtures qa_expiry_fixture
    JOIN cairn_qa_fixture_batches qa_expiry_batch
      ON qa_expiry_batch.batch_id=qa_expiry_fixture.batch_id
   WHERE qa_expiry_fixture.marker_id=${markerIdExpression})`;
}

module.exports = { qaFixtureEligibleSql, qaFixtureExpirySql };
