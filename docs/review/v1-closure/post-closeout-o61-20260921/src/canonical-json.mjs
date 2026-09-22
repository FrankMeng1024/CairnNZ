import { bytesOf, sha256, invariant } from './common.mjs';

function normalize(value, ancestors, pointer) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'NON_JSON_NUMBER', `${pointer} is not a finite JSON number`);
    return Object.is(value, -0) ? 0 : value;
  }
  invariant(typeof value === 'object', 'NON_JSON_VALUE', `${pointer} is not a JSON value`);
  invariant(!ancestors.has(value), 'CYCLIC_JSON', `${pointer} creates a cycle`);

  ancestors.add(value);
  let output;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      invariant(Object.hasOwn(value, index), 'SPARSE_JSON_ARRAY', `${pointer}/${index} is an array hole`);
    }
    const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index));
    invariant(
      Object.keys(value).length === expectedKeys.length && Object.keys(value).every((key, index) => key === expectedKeys[index]),
      'NON_JSON_ARRAY_PROPERTY',
      `${pointer} has non-index array properties`,
    );
    output = value.map((item, index) => normalize(item, ancestors, `${pointer}/${index}`));
  } else {
    invariant(Object.getPrototypeOf(value) === Object.prototype, 'NON_PLAIN_JSON_OBJECT', `${pointer} must be a plain object`);
    output = {};
    for (const key of Object.keys(value).sort()) {
      invariant(value[key] !== undefined, 'UNDEFINED_JSON_VALUE', `${pointer}/${key} is undefined`);
      output[key] = normalize(value[key], ancestors, `${pointer}/${escapePointer(key)}`);
    }
  }
  ancestors.delete(value);
  return output;
}

function escapePointer(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePointer(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value, new Set(), '#'));
}

export function semanticDigest(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

export function rawByteDigest(value) {
  return sha256(bytesOf(value));
}

export function semanticEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function getJsonPointer(value, pointer) {
  invariant(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')), 'INVALID_JSON_POINTER', 'pointer must be empty or start with /');
  if (pointer === '') return value;
  return pointer.slice(1).split('/').map(unescapePointer).reduce((node, key) => {
    invariant(node !== null && typeof node === 'object' && Object.hasOwn(node, key), 'MISSING_JSON_POINTER', `missing JSON pointer ${pointer}`);
    return node[key];
  }, value);
}

export function requireSemanticChange(before, after, { requiredChangedPointers = [] } = {}) {
  invariant(!semanticEqual(before, after), 'NO_SEMANTIC_CHANGE', 'before and after are semantically equal');
  for (const pointer of requiredChangedPointers) {
    invariant(
      !semanticEqual(getJsonPointer(before, pointer), getJsonPointer(after, pointer)),
      'REQUIRED_FIELD_UNCHANGED',
      `required field did not change: ${pointer}`,
    );
  }
  return {
    beforeSemanticSha256: semanticDigest(before),
    afterSemanticSha256: semanticDigest(after),
    requiredChangedPointers: [...requiredChangedPointers],
  };
}
