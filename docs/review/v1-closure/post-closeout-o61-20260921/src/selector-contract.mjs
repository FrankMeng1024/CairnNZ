import { invariant } from './common.mjs';

export function resolveSelectorContract(elements, contract) {
  invariant(Array.isArray(elements), 'INVALID_ELEMENTS', 'elements must be an array');
  invariant(contract && typeof contract === 'object' && !Array.isArray(contract), 'INVALID_SELECTOR_CONTRACT', 'contract must be an object');
  invariant(typeof contract.role === 'string' && contract.role.length > 0, 'INVALID_SELECTOR_CONTRACT', 'role is required');
  invariant(typeof contract.name === 'string' && contract.name.length > 0, 'INVALID_SELECTOR_CONTRACT', 'accessible name is required');
  invariant(contract.testId === undefined || (typeof contract.testId === 'string' && contract.testId.length > 0), 'INVALID_SELECTOR_CONTRACT', 'testId must be non-empty when supplied');

  const roleNameMatches = elements.map((element, index) => ({ element, index }))
    .filter(({ element }) => element?.role === contract.role && element?.name === contract.name);
  invariant(roleNameMatches.length === 1, 'ROLE_NAME_CARDINALITY', `expected exactly one ${contract.role} named ${contract.name}`);
  const selected = roleNameMatches[0];
  invariant(selected.element.visible === true, 'SELECTOR_NOT_VISIBLE', 'selected element is not visible');
  invariant(selected.element.enabled === true, 'SELECTOR_NOT_ENABLED', 'selected element is not enabled');

  if (contract.testId !== undefined) {
    const testIdMatches = elements.map((element, index) => ({ element, index }))
      .filter(({ element }) => element?.testId === contract.testId);
    invariant(testIdMatches.length === 1, 'TEST_ID_CARDINALITY', `expected exactly one testId ${contract.testId}`);
    invariant(testIdMatches[0].index === selected.index, 'SELECTOR_DISAGREEMENT', 'role/name and testId resolve to different elements');
  }
  return {
    index: selected.index,
    role: contract.role,
    name: contract.name,
    testId: contract.testId ?? null,
  };
}
