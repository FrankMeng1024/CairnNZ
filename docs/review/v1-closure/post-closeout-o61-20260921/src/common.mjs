import { createHash } from 'node:crypto';
import path from 'node:path';

export class ValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details = undefined) {
  if (!condition) {
    throw new ValidationError(code, message, details);
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertSha256(value, field = 'sha256') {
  invariant(
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    'INVALID_SHA256',
    `${field} must be a lowercase SHA-256 hex digest`,
  );
}

export function assertPlainObject(value, field = 'value') {
  invariant(
    value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    'INVALID_OBJECT',
    `${field} must be a plain object`,
  );
}

export function assertExactKeys(object, requiredKeys, field = 'object') {
  const required = new Set(requiredKeys);
  const actualKeys = Object.keys(object);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(object, key));
  invariant(missing.length === 0, 'MISSING_KEY', `${field} is missing required keys`, missing);
  const extras = actualKeys.filter((key) => !required.has(key));
  invariant(extras.length === 0, 'UNEXPECTED_KEY', `${field} has unexpected keys`, extras);
}

export function canonicalRepoPath(value, field = 'path') {
  invariant(typeof value === 'string' && value.length > 0, 'INVALID_PATH', `${field} must be non-empty`);
  invariant(value === value.trim(), 'INVALID_PATH', `${field} must not have surrounding whitespace`);
  invariant(!value.includes('\\'), 'INVALID_PATH', `${field} must use POSIX separators`);
  invariant(!value.includes('\0') && !/[\x00-\x1f\x7f]/.test(value), 'INVALID_PATH', `${field} contains control characters`);
  invariant(!path.posix.isAbsolute(value), 'INVALID_PATH', `${field} must be repository-relative`);
  invariant(!/^[A-Za-z]:/.test(value), 'INVALID_PATH', `${field} must not be drive-absolute`);
  invariant(value !== '.' && value !== '..', 'INVALID_PATH', `${field} must name a file`);
  invariant(path.posix.normalize(value) === value, 'INVALID_PATH', `${field} is not canonical`);
  const segments = value.split('/');
  invariant(segments.every((segment) => segment && segment !== '.' && segment !== '..'), 'INVALID_PATH', `${field} has invalid segments`);
  return value;
}

export function assertUnique(values, field = 'values') {
  const seen = new Set();
  for (const value of values) {
    invariant(!seen.has(value), 'DUPLICATE_VALUE', `${field} contains a duplicate`, value);
    seen.add(value);
  }
}

export function bytesOf(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  invariant(typeof value === 'string', 'INVALID_BYTES', 'artifact content must be a string, Buffer, or Uint8Array');
  return Buffer.from(value, 'utf8');
}
