import { assertExactKeys, assertPlainObject, assertUnique, invariant } from './common.mjs';
import { semanticDigest, semanticEqual } from './canonical-json.mjs';

export const CLEANUP_RECEIPT_SCHEMA = 'cairnnz.external.cleanup-receipt.v1';

function processKey(identity) {
  return `${identity.pid}\0${identity.startToken}\0${identity.processGroupId}\0${identity.runId}\0${identity.ownerToken}`;
}

function containerKey(identity) {
  return `${identity.id}\0${identity.name}\0${identity.labels.runId}\0${identity.labels.ownerToken}`;
}

function validateProcessIdentity(value, field) {
  assertPlainObject(value, field);
  assertExactKeys(value, ['pid', 'startToken', 'processGroupId', 'runId', 'ownerToken'], field);
  invariant(Number.isSafeInteger(value.pid) && value.pid > 0, 'INVALID_PROCESS_IDENTITY', `${field}.pid must be positive`);
  invariant(typeof value.startToken === 'string' && value.startToken.length > 0, 'INVALID_PROCESS_IDENTITY', `${field}.startToken required`);
  invariant(Number.isSafeInteger(value.processGroupId) && value.processGroupId > 0, 'INVALID_PROCESS_IDENTITY', `${field}.processGroupId must be positive`);
  invariant(typeof value.runId === 'string' && typeof value.ownerToken === 'string', 'INVALID_PROCESS_IDENTITY', `${field} ownership required`);
}

function validateContainerIdentity(value, field) {
  assertPlainObject(value, field);
  assertExactKeys(value, ['id', 'name', 'labels'], field);
  assertPlainObject(value.labels, `${field}.labels`);
  assertExactKeys(value.labels, ['runId', 'ownerToken'], `${field}.labels`);
  invariant(typeof value.id === 'string' && value.id.length > 0, 'INVALID_CONTAINER_IDENTITY', `${field}.id required`);
  invariant(typeof value.name === 'string' && value.name.length > 0, 'INVALID_CONTAINER_IDENTITY', `${field}.name required`);
  invariant(typeof value.labels.runId === 'string' && typeof value.labels.ownerToken === 'string', 'INVALID_CONTAINER_IDENTITY', `${field} labels required`);
}

export function evaluateCleanupTranscript({ expected, events }) {
  assertPlainObject(expected, 'expected');
  assertExactKeys(expected, ['runId', 'ownerToken', 'processes', 'container'], 'expected');
  invariant(typeof expected.runId === 'string' && expected.runId.length > 0, 'INVALID_OWNERSHIP', 'runId required');
  invariant(typeof expected.ownerToken === 'string' && expected.ownerToken.length > 0, 'INVALID_OWNERSHIP', 'ownerToken required');
  invariant(Array.isArray(expected.processes), 'INVALID_PROCESSES', 'processes must be an array');
  invariant(Array.isArray(events), 'INVALID_EVENTS', 'events must be an array');

  const processes = new Map();
  for (const [index, identity] of expected.processes.entries()) {
    validateProcessIdentity(identity, `expected.processes[${index}]`);
    invariant(identity.runId === expected.runId && identity.ownerToken === expected.ownerToken, 'OWNERSHIP_MISMATCH', 'process ownership does not match run');
    const key = processKey(identity);
    invariant(!processes.has(identity.pid), 'DUPLICATE_VALUE', `duplicate expected pid: ${identity.pid}`);
    processes.set(identity.pid, { key, state: 'NEW', identity });
  }
  if (expected.container !== null) {
    validateContainerIdentity(expected.container, 'expected.container');
    invariant(expected.container.labels.runId === expected.runId && expected.container.labels.ownerToken === expected.ownerToken, 'OWNERSHIP_MISMATCH', 'container labels do not match run');
  }
  let containerState = expected.container === null ? 'ABSENT_VERIFIED' : 'NEW';

  for (const [index, event] of events.entries()) {
    assertPlainObject(event, `events[${index}]`);
    invariant(typeof event.kind === 'string', 'INVALID_EVENT', 'cleanup event kind required');
    if (event.kind.startsWith('PROCESS_')) {
      assertExactKeys(event, ['kind', 'identity'], `events[${index}]`);
      validateProcessIdentity(event.identity, `events[${index}].identity`);
      const current = processes.get(event.identity.pid);
      invariant(current, 'ALIEN_PROCESS', `process is not owned by this run: ${event.identity.pid}`);
      invariant(processKey(event.identity) === current.key, 'PROCESS_IDENTITY_MISMATCH', `process identity changed for pid ${event.identity.pid}`);
      const transitions = {
        NEW: { PROCESS_IDENTITY_VERIFIED: 'VERIFIED', PROCESS_ALREADY_EXITED: 'EXITED' },
        VERIFIED: { PROCESS_TERM_SENT: 'TERM_SENT' },
        TERM_SENT: { PROCESS_EXIT_OBSERVED: 'EXITED', PROCESS_TERM_TIMEOUT: 'TERM_TIMEOUT' },
        TERM_TIMEOUT: { PROCESS_IDENTITY_REVERIFIED: 'REVERIFIED' },
        REVERIFIED: { PROCESS_KILL_SENT: 'KILL_SENT' },
        KILL_SENT: { PROCESS_EXIT_OBSERVED: 'EXITED' },
        EXITED: { PROCESS_WAIT_REAPED: 'REAPED' },
      };
      const next = transitions[current.state]?.[event.kind];
      invariant(next, 'INVALID_CLEANUP_TRANSITION', `${event.kind} is invalid from ${current.state}`);
      current.state = next;
    } else if (event.kind.startsWith('CONTAINER_')) {
      assertExactKeys(event, ['kind', 'identity'], `events[${index}]`);
      invariant(expected.container !== null, 'ALIEN_CONTAINER', 'no container is owned by this run');
      validateContainerIdentity(event.identity, `events[${index}].identity`);
      invariant(containerKey(event.identity) === containerKey(expected.container), 'CONTAINER_IDENTITY_MISMATCH', 'container id/name/labels changed');
      const transitions = {
        NEW: { CONTAINER_IDENTITY_VERIFIED: 'VERIFIED', CONTAINER_ALREADY_ABSENT: 'ABSENT_VERIFIED' },
        VERIFIED: { CONTAINER_IDENTITY_REVERIFIED: 'REVERIFIED' },
        REVERIFIED: { CONTAINER_REMOVE_REQUESTED: 'REMOVE_REQUESTED' },
        REMOVE_REQUESTED: { CONTAINER_ABSENT_VERIFIED: 'ABSENT_VERIFIED' },
      };
      const next = transitions[containerState]?.[event.kind];
      invariant(next, 'INVALID_CLEANUP_TRANSITION', `${event.kind} is invalid from ${containerState}`);
      containerState = next;
    } else {
      invariant(false, 'UNKNOWN_EVENT', `unknown cleanup event: ${event.kind}`);
    }
  }

  const incomplete = [...processes.values()].filter(({ state }) => state !== 'REAPED').map(({ identity, state }) => ({ pid: identity.pid, state }));
  invariant(incomplete.length === 0, 'INCOMPLETE_PROCESS_CLEANUP', 'owned processes were not deterministically reaped', incomplete);
  invariant(containerState === 'ABSENT_VERIFIED', 'INCOMPLETE_CONTAINER_CLEANUP', `container ended in ${containerState}`);
  const unsigned = {
    schema: CLEANUP_RECEIPT_SCHEMA,
    runId: expected.runId,
    ownerToken: expected.ownerToken,
    processes: [...processes.values()].map(({ identity }) => ({ ...identity })),
    container: expected.container === null
      ? null
      : { ...expected.container, labels: { ...expected.container.labels } },
    eventCount: events.length,
    transcriptSha256: semanticDigest(events),
    terminalState: 'CLEAN',
  };
  return { ...unsigned, receiptDigest: semanticDigest(unsigned) };
}

export function validateCleanupReceipt(receipt, { expected, events }) {
  assertPlainObject(receipt, 'cleanup receipt');
  assertExactKeys(
    receipt,
    ['schema', 'runId', 'ownerToken', 'processes', 'container', 'eventCount', 'transcriptSha256', 'terminalState', 'receiptDigest'],
    'cleanup receipt',
  );
  invariant(receipt.schema === CLEANUP_RECEIPT_SCHEMA, 'INVALID_SCHEMA', 'cleanup receipt schema mismatch');
  invariant(receipt.terminalState === 'CLEAN', 'INCOMPLETE_CLEANUP_RECEIPT', 'cleanup receipt is not CLEAN');
  const expectedReceipt = evaluateCleanupTranscript({ expected, events });
  invariant(semanticEqual(receipt, expectedReceipt), 'CLEANUP_RECEIPT_MISMATCH', 'cleanup receipt does not match the owned transcript');
  return { receiptDigest: receipt.receiptDigest, eventCount: receipt.eventCount };
}

export function validateReadinessIdentity(receipt, expected) {
  assertPlainObject(receipt, 'readiness receipt');
  assertPlainObject(expected, 'expected readiness identity');
  const keys = ['runId', 'ownerToken', 'apiOrigin', 'apiPid', 'apiStartToken', 'database', 'realm', 'fixtureNamespace'];
  assertExactKeys(receipt, keys, 'readiness receipt');
  assertExactKeys(expected, keys, 'expected readiness identity');
  for (const [field, value] of [['readiness receipt', receipt], ['expected readiness identity', expected]]) {
    invariant(
      typeof value.runId === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.runId),
      'INVALID_READINESS_RUN_ID',
      `${field}.runId must be a canonical identifier`,
    );
    invariant(
      typeof value.ownerToken === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.ownerToken),
      'INVALID_READINESS_OWNER_TOKEN',
      `${field}.ownerToken must be a canonical identifier`,
    );
    invariant(
      Number.isSafeInteger(value.apiPid) && value.apiPid > 0,
      'INVALID_READINESS_PID',
      `${field}.apiPid must be a positive safe integer`,
    );
    invariant(
      typeof value.apiStartToken === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value.apiStartToken),
      'INVALID_READINESS_START_TOKEN',
      `${field}.apiStartToken must be a canonical identifier`,
    );
    invariant(
      typeof value.database === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.database),
      'INVALID_READINESS_DATABASE',
      `${field}.database must be a canonical database identifier`,
    );
    invariant(
      typeof value.realm === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.realm),
      'INVALID_READINESS_REALM',
      `${field}.realm must be a canonical realm identifier`,
    );
    invariant(
      typeof value.fixtureNamespace === 'string' && /^[a-z0-9][a-z0-9_]{2,63}$/.test(value.fixtureNamespace),
      'INVALID_READINESS_FIXTURE_NAMESPACE',
      `${field}.fixtureNamespace must be a canonical fixture namespace`,
    );
    let parsedOrigin;
    try {
      parsedOrigin = new URL(value.apiOrigin);
    } catch {
      invariant(false, 'INVALID_READINESS_ORIGIN', `${field}.apiOrigin must be an absolute http(s) origin`);
    }
    invariant(
      (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
        parsedOrigin.origin === value.apiOrigin && parsedOrigin.username === '' && parsedOrigin.password === '' &&
        parsedOrigin.pathname === '/' && parsedOrigin.search === '' && parsedOrigin.hash === '',
      'INVALID_READINESS_ORIGIN',
      `${field}.apiOrigin must be a canonical http(s) origin without credentials, path, query, or fragment`,
    );
  }
  const mismatched = keys.filter((key) => receipt[key] !== expected[key]);
  invariant(mismatched.length === 0, 'ALIEN_READINESS_IDENTITY', 'readiness came from a different owned stack', mismatched);
  return Object.freeze({ ...receipt });
}
