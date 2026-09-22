import { assertExactKeys, assertPlainObject, assertUnique, invariant } from './common.mjs';

function assertTimestamp(value, field) {
  invariant(Number.isFinite(value) && value >= 0, 'INVALID_TIMESTAMP', `${field} must be a non-negative finite number`);
}

function exactOrigin(url, origin, field) {
  let parsed;
  let expected;
  try {
    parsed = new URL(url);
    expected = new URL(origin);
  } catch {
    invariant(false, 'INVALID_URL', `${field} must be an absolute URL`);
  }
  invariant(parsed.origin === expected.origin, 'HOST_MISMATCH', `${field} origin ${parsed.origin} is not ${expected.origin}`);
}

function tuple(value) {
  return `${value.requestId}\0${value.method}\0${value.url}\0${value.phase}`;
}

function validateIdentity(value, field, exactHost) {
  invariant(typeof value.requestId === 'string' && value.requestId.length > 0, 'INVALID_REQUEST_ID', `${field}.requestId must be non-empty`);
  invariant(typeof value.method === 'string' && /^[A-Z]+$/.test(value.method), 'INVALID_METHOD', `${field}.method must be uppercase`);
  invariant(typeof value.url === 'string', 'INVALID_URL', `${field}.url must be a string`);
  exactOrigin(value.url, exactHost, `${field}.url`);
  invariant(typeof value.phase === 'string' && value.phase.length > 0, 'INVALID_PHASE', `${field}.phase must be non-empty`);
}

export function correlateNetworkEvidence({ exactHost, expectedErrors, expectedDialogs = [], events }) {
  invariant(typeof exactHost === 'string', 'INVALID_HOST', 'exactHost is required');
  exactOrigin(exactHost, exactHost, 'exactHost');
  invariant(Array.isArray(expectedErrors), 'INVALID_EXPECTATIONS', 'expectedErrors must be an array');
  invariant(Array.isArray(expectedDialogs), 'INVALID_EXPECTATIONS', 'expectedDialogs must be an array');
  invariant(Array.isArray(events), 'INVALID_EVENTS', 'events must be an array');

  const expectations = new Map();
  for (const [index, expected] of expectedErrors.entries()) {
    assertPlainObject(expected, `expectedErrors[${index}]`);
    assertExactKeys(expected, ['requestId', 'method', 'url', 'phase', 'errorCode', 'consoleMessage'], `expectedErrors[${index}]`);
    validateIdentity(expected, `expectedErrors[${index}]`, exactHost);
    invariant(typeof expected.errorCode === 'string' && expected.errorCode.length > 0, 'INVALID_EXPECTATION', 'errorCode is required');
    invariant(expected.consoleMessage === null || typeof expected.consoleMessage === 'string', 'INVALID_EXPECTATION', 'consoleMessage must be a string or null');
    invariant(!expectations.has(expected.requestId), 'DUPLICATE_VALUE', `duplicate expected requestId: ${expected.requestId}`);
    expectations.set(expected.requestId, expected);
  }

  const expectedDialogKeys = expectedDialogs.map((dialog, index) => {
    assertPlainObject(dialog, `expectedDialogs[${index}]`);
    assertExactKeys(dialog, ['phase', 'type', 'message'], `expectedDialogs[${index}]`);
    invariant(['alert', 'confirm', 'prompt', 'beforeunload'].includes(dialog.type), 'INVALID_DIALOG', `invalid dialog type: ${dialog.type}`);
    invariant(typeof dialog.phase === 'string' && typeof dialog.message === 'string', 'INVALID_DIALOG', 'dialog phase/message must be strings');
    return `${dialog.phase}\0${dialog.type}\0${dialog.message}`;
  });
  assertUnique(expectedDialogKeys, 'expectedDialogs');

  const requests = new Map();
  const errors = new Map();
  const responses = new Map();
  const consoles = new Map();
  const actualDialogKeys = [];
  for (const [index, event] of events.entries()) {
    assertPlainObject(event, `events[${index}]`);
    invariant(typeof event.kind === 'string', 'INVALID_EVENT', `events[${index}].kind is required`);
    assertTimestamp(event.atMs, `events[${index}].atMs`);
    if (event.kind === 'request') {
      assertExactKeys(event, ['kind', 'atMs', 'requestId', 'method', 'url', 'phase'], `events[${index}]`);
      validateIdentity(event, `events[${index}]`, exactHost);
      invariant(!requests.has(event.requestId), 'DUPLICATE_REQUEST', `duplicate request event: ${event.requestId}`);
      requests.set(event.requestId, event);
    } else if (event.kind === 'network-error') {
      assertExactKeys(event, ['kind', 'atMs', 'requestId', 'method', 'url', 'phase', 'errorCode'], `events[${index}]`);
      validateIdentity(event, `events[${index}]`, exactHost);
      if (!errors.has(event.requestId)) errors.set(event.requestId, []);
      errors.get(event.requestId).push(event);
    } else if (event.kind === 'response') {
      assertExactKeys(event, ['kind', 'atMs', 'requestId', 'method', 'url', 'phase', 'status'], `events[${index}]`);
      validateIdentity(event, `events[${index}]`, exactHost);
      invariant(Number.isInteger(event.status) && event.status >= 100 && event.status <= 599, 'INVALID_STATUS_CODE', 'response status must be 100..599');
      invariant(event.status < 500, 'UNEXPECTED_5XX', `unexpected ${event.status} for ${event.requestId}`);
      if (!responses.has(event.requestId)) responses.set(event.requestId, []);
      responses.get(event.requestId).push(event);
    } else if (event.kind === 'console-error') {
      assertExactKeys(event, ['kind', 'atMs', 'requestId', 'method', 'url', 'phase', 'message'], `events[${index}]`);
      validateIdentity(event, `events[${index}]`, exactHost);
      invariant(typeof event.message === 'string', 'INVALID_CONSOLE_EVENT', 'console message must be a string');
      if (!consoles.has(event.requestId)) consoles.set(event.requestId, []);
      consoles.get(event.requestId).push(event);
    } else if (event.kind === 'dialog') {
      assertExactKeys(event, ['kind', 'atMs', 'phase', 'type', 'message'], `events[${index}]`);
      invariant(typeof event.phase === 'string' && typeof event.type === 'string' && typeof event.message === 'string', 'INVALID_DIALOG', 'dialog fields must be strings');
      actualDialogKeys.push(`${event.phase}\0${event.type}\0${event.message}`);
    } else {
      invariant(false, 'UNKNOWN_EVENT', `unsupported event kind: ${event.kind}`);
    }
  }

  assertUnique(actualDialogKeys, 'actual dialogs');
  invariant(
    actualDialogKeys.length === expectedDialogKeys.length && actualDialogKeys.every((key) => expectedDialogKeys.includes(key)),
    'UNEXPECTED_DIALOG',
    'actual dialogs do not exactly match the explicit dialog allowlist',
  );

  for (const [requestId, responseEvents] of responses) {
    invariant(requests.has(requestId), 'UNMATCHED_RESPONSE', `response has no request: ${requestId}`);
    const request = requests.get(requestId);
    for (const response of responseEvents) {
      invariant(tuple(response) === tuple(request), 'REQUEST_IDENTITY_MISMATCH', `response identity changed: ${requestId}`);
      invariant(response.atMs >= request.atMs, 'CAUSAL_ORDER_VIOLATION', `response precedes request: ${requestId}`);
    }
  }
  for (const [requestId, errorEvents] of errors) {
    invariant(requests.has(requestId), 'UNMATCHED_RUNTIME_ERROR', `network error has no request: ${requestId}`);
    const request = requests.get(requestId);
    for (const error of errorEvents) {
      invariant(tuple(error) === tuple(request), 'REQUEST_IDENTITY_MISMATCH', `network error identity changed: ${requestId}`);
      invariant(error.atMs >= request.atMs, 'CAUSAL_ORDER_VIOLATION', `network error precedes request: ${requestId}`);
    }
  }
  for (const requestId of requests.keys()) {
    const responseCount = (responses.get(requestId) ?? []).length;
    const errorCount = (errors.get(requestId) ?? []).length;
    invariant(
      responseCount + errorCount === 1,
      'OUTCOME_CARDINALITY',
      `request ${requestId} must have exactly one terminal response xor network error`,
      { responseCount, errorCount },
    );
  }

  for (const [requestId, expected] of expectations) {
    const request = requests.get(requestId);
    invariant(request, 'MISSING_EXPECTED_REQUEST', `expected request was not observed: ${requestId}`);
    invariant(tuple(request) === tuple(expected), 'REQUEST_IDENTITY_MISMATCH', `request does not match expectation: ${requestId}`);
    const requestErrors = errors.get(requestId) ?? [];
    invariant(requestErrors.length === 1, 'ERROR_CARDINALITY', `expected exactly one network error for ${requestId}`);
    invariant((responses.get(requestId) ?? []).length === 0, 'OUTCOME_CARDINALITY', `offline request also received a response: ${requestId}`);
    const error = requestErrors[0];
    invariant(tuple(error) === tuple(expected) && error.errorCode === expected.errorCode, 'ERROR_IDENTITY_MISMATCH', `network error does not match expectation: ${requestId}`);
    invariant(error.atMs >= request.atMs, 'CAUSAL_ORDER_VIOLATION', `network error precedes request: ${requestId}`);
    const requestConsoles = consoles.get(requestId) ?? [];
    if (expected.consoleMessage === null) {
      invariant(requestConsoles.length === 0, 'UNEXPECTED_CONSOLE_ERROR', `unexpected console error for ${requestId}`);
    } else {
      invariant(requestConsoles.length === 1, 'CONSOLE_CARDINALITY', `expected exactly one correlated console error for ${requestId}`);
      const consoleEvent = requestConsoles[0];
      invariant(tuple(consoleEvent) === tuple(expected) && consoleEvent.message === expected.consoleMessage, 'CONSOLE_IDENTITY_MISMATCH', `console error does not match expectation: ${requestId}`);
      invariant(consoleEvent.atMs >= request.atMs && consoleEvent.atMs >= error.atMs, 'CAUSAL_ORDER_VIOLATION', `console error precedes its cause: ${requestId}`);
    }
  }

  for (const requestId of [...errors.keys(), ...consoles.keys()]) {
    invariant(expectations.has(requestId), 'UNMATCHED_RUNTIME_ERROR', `runtime error is not allowlisted: ${requestId}`);
  }

  return {
    expectedErrorCount: expectations.size,
    requestCount: requests.size,
    dialogCount: actualDialogKeys.length,
  };
}
