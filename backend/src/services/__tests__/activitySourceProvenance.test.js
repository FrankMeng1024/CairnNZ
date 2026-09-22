'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eligibleSourceProvenanceSql,
  sourceProvenanceEligible,
  sourceProvenanceForRealm,
} = require('../activitySourceProvenance');

function withSourceContractEnvironment(values, assertion) {
  const previous = {
    CAIRN_REALM: process.env.CAIRN_REALM,
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT,
  };
  try {
    if (values.CAIRN_REALM === undefined) delete process.env.CAIRN_REALM;
    else process.env.CAIRN_REALM = values.CAIRN_REALM;
    if (values.ALLOW_ISOLATED_QA_SOURCE_CONTRACT === undefined) {
      delete process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT;
    } else {
      process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT = values.ALLOW_ISOLATED_QA_SOURCE_CONTRACT;
    }
    assertion();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('production source contract admits only server-bound native evidence', () => {
  withSourceContractEnvironment({ CAIRN_REALM: 'production' }, () => {
    assert.equal(sourceProvenanceEligible('native_real'), true);
    assert.equal(sourceProvenanceEligible('isolated_qa'), false);
    assert.equal(
      eligibleSourceProvenanceSql('session.source_provenance'),
      "session.source_provenance='native_real'",
    );
  });
});

test('isolated QA source is admitted only with both isolated realm fences', () => {
  withSourceContractEnvironment({
    CAIRN_REALM: 'isolated_review',
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: '1',
  }, () => {
    assert.equal(sourceProvenanceForRealm('isolated_qa'), 'isolated_qa');
    assert.equal(sourceProvenanceEligible('isolated_qa'), true);
    assert.equal(
      eligibleSourceProvenanceSql('source_session.source_provenance'),
      "source_session.source_provenance IN ('native_real','isolated_qa')",
    );
  });

  withSourceContractEnvironment({
    CAIRN_REALM: 'isolated_review',
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: '0',
  }, () => {
    assert.equal(sourceProvenanceEligible('isolated_qa'), false);
  });
});

test('source SQL accepts only validated identifier paths', () => {
  assert.throws(
    () => eligibleSourceProvenanceSql('source_provenance OR 1=1'),
    /invalid_source_provenance_column/,
  );
});
