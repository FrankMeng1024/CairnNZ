import {
  assertExactKeys,
  assertPlainObject,
  assertSha256,
  assertUnique,
  bytesOf,
  invariant,
  sha256,
} from './common.mjs';
import { deriveTerminalStatus } from './status.mjs';

export const PROOF_POLICY_SCHEMA = 'cairnnz.external.proof-policy.v1';

function proofKey(proof) {
  return `${proof.evidenceSchema}\0${proof.assertionId}`;
}

// Structural-only: validates authorization claims, not the referenced receipt bytes.
export function validateAssertionProofStructure({ policy, allocations }) {
  assertPlainObject(policy, 'policy');
  assertExactKeys(policy, ['schema', 'assertions'], 'policy');
  invariant(policy.schema === PROOF_POLICY_SCHEMA, 'INVALID_SCHEMA', 'proof policy schema mismatch');
  invariant(Array.isArray(policy.assertions) && policy.assertions.length > 0, 'INVALID_POLICY', 'policy.assertions must be non-empty');

  const policies = new Map();
  for (const [index, rule] of policy.assertions.entries()) {
    assertPlainObject(rule, `policy.assertions[${index}]`);
    assertExactKeys(rule, ['planAssertionId', 'authorizedProofs', 'requiredNegativeControls'], `policy.assertions[${index}]`);
    invariant(typeof rule.planAssertionId === 'string' && rule.planAssertionId.length > 0, 'INVALID_POLICY', 'planAssertionId must be non-empty');
    invariant(Array.isArray(rule.authorizedProofs) && rule.authorizedProofs.length > 0, 'INVALID_POLICY', 'authorizedProofs must be non-empty');
    invariant(Array.isArray(rule.requiredNegativeControls), 'INVALID_POLICY', 'requiredNegativeControls must be an array');
    const authorized = rule.authorizedProofs.map((proof, proofIndex) => {
      assertPlainObject(proof, `authorizedProofs[${proofIndex}]`);
      assertExactKeys(proof, ['evidenceSchema', 'assertionId'], `authorizedProofs[${proofIndex}]`);
      invariant(typeof proof.evidenceSchema === 'string' && proof.evidenceSchema.length > 0, 'INVALID_POLICY', 'evidenceSchema must be non-empty');
      invariant(typeof proof.assertionId === 'string' && proof.assertionId.length > 0, 'INVALID_POLICY', 'assertionId must be non-empty');
      return proofKey(proof);
    });
    assertUnique(authorized, `${rule.planAssertionId}.authorizedProofs`);
    const controls = rule.requiredNegativeControls.map((control, controlIndex) => {
      invariant(typeof control === 'string' && control.length > 0, 'INVALID_POLICY', `negative control ${controlIndex} must be named`);
      return control;
    });
    assertUnique(controls, `${rule.planAssertionId}.requiredNegativeControls`);
    invariant(!policies.has(rule.planAssertionId), 'DUPLICATE_VALUE', `duplicate policy assertion: ${rule.planAssertionId}`);
    policies.set(rule.planAssertionId, { authorized: new Set(authorized), controls });
  }

  invariant(Array.isArray(allocations), 'INVALID_ALLOCATIONS', 'allocations must be an array');
  const allocationIds = [];
  const allocatedPlans = new Set();
  for (const [index, allocation] of allocations.entries()) {
    assertPlainObject(allocation, `allocations[${index}]`);
    assertExactKeys(
      allocation,
      ['allocationId', 'planAssertionId', 'evidenceSchema', 'assertionId', 'evidenceRawSha256', 'negativeControls'],
      `allocations[${index}]`,
    );
    invariant(typeof allocation.allocationId === 'string' && allocation.allocationId.length > 0, 'INVALID_ALLOCATION', 'allocationId must be non-empty');
    assertSha256(allocation.evidenceRawSha256, 'evidenceRawSha256');
    allocationIds.push(allocation.allocationId);
    const rule = policies.get(allocation.planAssertionId);
    invariant(rule, 'UNKNOWN_PLAN_ASSERTION', `no policy for ${allocation.planAssertionId}`);
    invariant(
      rule.authorized.has(proofKey(allocation)),
      'PROOF_MISALLOCATION',
      `${allocation.evidenceSchema}/${allocation.assertionId} is not authorized for ${allocation.planAssertionId}`,
    );
    invariant(Array.isArray(allocation.negativeControls), 'INVALID_NEGATIVE_CONTROLS', 'negativeControls must be an array');
    const controls = allocation.negativeControls.map((control, controlIndex) => {
      assertPlainObject(control, `negativeControls[${controlIndex}]`);
      assertExactKeys(control, ['name', 'result'], `negativeControls[${controlIndex}]`);
      invariant(typeof control.name === 'string' && control.name.length > 0, 'INVALID_NEGATIVE_CONTROL', 'negative control must be named');
      invariant(control.result === 'PASS', 'NEGATIVE_CONTROL_FAILED', `negative control did not pass: ${control.name}`);
      return control.name;
    });
    assertUnique(controls, `${allocation.allocationId}.negativeControls`);
    for (const required of rule.controls) {
      invariant(controls.includes(required), 'MISSING_NEGATIVE_CONTROL', `${allocation.planAssertionId} is missing negative control ${required}`);
    }
    allocatedPlans.add(allocation.planAssertionId);
  }
  assertUnique(allocationIds, 'allocationIds');
  const missingPlans = [...policies.keys()].filter((planId) => !allocatedPlans.has(planId));
  invariant(missingPlans.length === 0, 'MISSING_PROOF_ALLOCATION', 'policy assertions lack proof allocations', missingPlans);
  return { allocationCount: allocations.length, planAssertionCount: policies.size };
}

// Authoritative boundary: digest-binds allocations and validates assertions/controls in observed JSON receipts.
export function validateObservedAssertionProofs({ policy, allocations, observedEvidence }) {
  const structural = validateAssertionProofStructure({ policy, allocations });
  invariant(Array.isArray(observedEvidence), 'OBSERVED_EVIDENCE_REQUIRED', 'authoritative observed evidence bytes are required');
  const allocationById = new Map(allocations.map((allocation) => [allocation.allocationId, allocation]));
  const observedIds = [];
  for (const [index, observed] of observedEvidence.entries()) {
    assertPlainObject(observed, `observedEvidence[${index}]`);
    assertExactKeys(observed, ['allocationId', 'content'], `observedEvidence[${index}]`);
    invariant(typeof observed.allocationId === 'string' && observed.allocationId.length > 0, 'INVALID_OBSERVED_EVIDENCE', 'allocationId is required');
    observedIds.push(observed.allocationId);
    const allocation = allocationById.get(observed.allocationId);
    invariant(allocation, 'UNALLOCATED_OBSERVED_EVIDENCE', `no allocation for observed evidence ${observed.allocationId}`);
    const bytes = bytesOf(observed.content);
    invariant(
      sha256(bytes) === allocation.evidenceRawSha256,
      'OBSERVED_EVIDENCE_DIGEST_MISMATCH',
      `observed evidence bytes differ for ${observed.allocationId}`,
    );
    let receipt;
    try {
      receipt = JSON.parse(bytes.toString('utf8'));
    } catch {
      invariant(false, 'INVALID_OBSERVED_EVIDENCE', `observed evidence is not JSON: ${observed.allocationId}`);
    }
    assertPlainObject(receipt, `observed receipt ${observed.allocationId}`);
    invariant(receipt.schema === allocation.evidenceSchema, 'OBSERVED_EVIDENCE_SCHEMA_MISMATCH', `observed schema differs for ${observed.allocationId}`);
    const receiptTerminal = deriveTerminalStatus(receipt);
    invariant(
      receiptTerminal.status === 'PASS',
      'OBSERVED_RECEIPT_NOT_PASS',
      `observed receipt is not an unambiguous PASS: ${observed.allocationId}`,
      receiptTerminal,
    );
    invariant(Array.isArray(receipt.assertions), 'INVALID_OBSERVED_EVIDENCE', `observed assertions missing for ${observed.allocationId}`);
    const assertionResults = receipt.assertions.map((assertion, assertionIndex) => {
      assertPlainObject(assertion, `${observed.allocationId}.assertions[${assertionIndex}]`);
      assertExactKeys(assertion, ['id', 'result'], `${observed.allocationId}.assertions[${assertionIndex}]`);
      invariant(typeof assertion.id === 'string' && assertion.id.length > 0, 'INVALID_OBSERVED_ASSERTION', 'observed assertion id must be non-empty');
      invariant(
        ['PASS', 'FAIL', 'HOLD', 'UNVERIFIED', 'NOT_RUN'].includes(assertion.result),
        'INVALID_OBSERVED_ASSERTION',
        `observed assertion has invalid result: ${assertion.id}`,
      );
      return assertion;
    });
    const targetResults = assertionResults.filter(({ id }) => id === allocation.assertionId).map(({ result }) => result);
    invariant(targetResults.length > 0, 'OBSERVED_ASSERTION_MISSING', `observed assertion missing for ${observed.allocationId}`);
    invariant(
      new Set(targetResults).size <= 1,
      'CONTRADICTORY_ASSERTION_RESULTS',
      `observed target assertion has contradictory results: ${allocation.assertionId}`,
    );
    invariant(
      targetResults.length === 1,
      'ASSERTION_RESULT_CARDINALITY',
      `observed target assertion must have exactly one result: ${allocation.assertionId}`,
    );
    invariant(
      targetResults[0] === 'PASS',
      'OBSERVED_ASSERTION_NOT_PASS',
      `observed target assertion did not pass: ${allocation.assertionId}`,
    );
    invariant(Array.isArray(receipt.negativeControls), 'INVALID_OBSERVED_EVIDENCE', `observed negative controls missing for ${observed.allocationId}`);
    const observedControls = receipt.negativeControls.map((control, controlIndex) => {
      assertPlainObject(control, `${observed.allocationId}.negativeControls[${controlIndex}]`);
      assertExactKeys(control, ['name', 'result'], `${observed.allocationId}.negativeControls[${controlIndex}]`);
      invariant(control.result === 'PASS', 'NEGATIVE_CONTROL_FAILED', `observed negative control did not pass: ${control.name}`);
      return control.name;
    });
    assertUnique(observedControls, `${observed.allocationId}.observedNegativeControls`);
    const allocatedControls = allocation.negativeControls.map(({ name }) => name);
    invariant(
      observedControls.length === allocatedControls.length && observedControls.every((name) => allocatedControls.includes(name)),
      'OBSERVED_NEGATIVE_CONTROL_MISMATCH',
      `observed negative controls differ for ${observed.allocationId}`,
    );
  }
  assertUnique(observedIds, 'observedEvidence[].allocationId');
  invariant(
    observedIds.length === allocations.length && allocations.every(({ allocationId }) => observedIds.includes(allocationId)),
    'OBSERVED_EVIDENCE_SET_MISMATCH',
    'observed evidence set differs from proof allocations',
  );
  return { ...structural, observedEvidenceCount: observedIds.length };
}
