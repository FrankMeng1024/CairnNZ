import { invariant } from './common.mjs';

export const TERMINAL_STATUSES = Object.freeze(['PASS', 'FAIL', 'HOLD', 'UNVERIFIED', 'NOT_RUN']);

const ALIASES = new Map([
  ['PASS', 'PASS'],
  ['SUCCESS', 'PASS'],
  ['FAIL', 'FAIL'],
  ['FAILED', 'FAIL'],
  ['ERROR', 'FAIL'],
  ['HOLD', 'HOLD'],
  ['BLOCKED', 'HOLD'],
  ['UNVERIFIED', 'UNVERIFIED'],
  ['UNKNOWN', 'UNVERIFIED'],
  ['NOT_RUN', 'NOT_RUN'],
  ['NOT_REACHED', 'NOT_RUN'],
  ['PENDING', 'NOT_RUN'],
]);

const STATUS_PATHS = [
  ['terminalStatus'],
  ['terminal_status'],
  ['outcome'],
  ['status'],
  ['verdict'],
  ['result'],
  ['summary', 'result'],
  ['summary', 'status'],
];

function atPath(value, path) {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

export function normalizeTerminalStatus(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim().toUpperCase().replaceAll('-', '_').replaceAll(/\s+/g, '_');
  return ALIASES.get(token) ?? null;
}

export function deriveTerminalStatus(document, { exitCode = 0 } = {}) {
  invariant(document !== null && typeof document === 'object' && !Array.isArray(document), 'INVALID_TERMINAL_DOCUMENT', 'terminal document must be an object');
  invariant(Number.isInteger(exitCode), 'INVALID_EXIT_CODE', 'exitCode must be an integer');

  const observations = [];
  for (const path of STATUS_PATHS) {
    const raw = atPath(document, path);
    if (raw === undefined || raw === null || raw === '') continue;
    observations.push({ path: path.join('.'), raw, normalized: normalizeTerminalStatus(raw) });
  }
  if (typeof document.success === 'boolean') {
    observations.push({ path: 'success', raw: document.success, normalized: document.success ? 'PASS' : 'FAIL' });
  }

  const reasons = [];
  const invalid = observations.filter(({ normalized }) => normalized === null);
  if (invalid.length) reasons.push('UNRECOGNIZED_STATUS');
  const statuses = [...new Set(observations.map(({ normalized }) => normalized).filter(Boolean))];
  if (statuses.length === 0) reasons.push('MISSING_STATUS');
  if (statuses.length > 1) reasons.push('CONTRADICTORY_STATUS');
  if (exitCode !== 0 && statuses.some((status) => status === 'PASS')) reasons.push('PASS_WITH_NONZERO_EXIT');

  const status = reasons.length > 0 ? 'UNVERIFIED' : statuses[0];
  return { status, exitCode, observations, reasons };
}
