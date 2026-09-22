'use strict';

function isolatedQaContractEnabled() {
  return process.env.CAIRN_REALM === 'isolated_review'
    && process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT === '1';
}

function sourceProvenanceForRealm(activitySourceRealm) {
  return activitySourceRealm === 'isolated_qa' ? 'isolated_qa' : 'native_real';
}

function sourceProvenanceEligible(sourceProvenance) {
  return sourceProvenance === 'native_real'
    || (sourceProvenance === 'isolated_qa' && isolatedQaContractEnabled());
}

function eligibleSourceProvenanceSql(column) {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(String(column))) {
    throw new Error('invalid_source_provenance_column');
  }
  return isolatedQaContractEnabled()
    ? `${column} IN ('native_real','isolated_qa')`
    : `${column}='native_real'`;
}

module.exports = {
  isolatedQaContractEnabled,
  sourceProvenanceForRealm,
  sourceProvenanceEligible,
  eligibleSourceProvenanceSql,
};
