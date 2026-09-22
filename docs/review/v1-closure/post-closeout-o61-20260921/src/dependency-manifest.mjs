import {
  assertExactKeys,
  assertPlainObject,
  assertSha256,
  assertUnique,
  bytesOf,
  canonicalRepoPath,
  invariant,
  sha256,
} from './common.mjs';
import { semanticDigest } from './canonical-json.mjs';

export const DEPENDENCY_MANIFEST_SCHEMA = 'cairnnz.external.dependency-manifest.v1';
export const O61_FINGERPRINT_SCOPE = Object.freeze([
  'app/src',
  'app/scripts',
  'app/package.json',
  'app/package-lock.json',
  'backend/src',
  'backend/scripts',
  'backend/package.json',
  'backend/package-lock.json',
]);
export const O61_FINGERPRINT_DIGEST = '46aa7e1af18fb8187512991bd3a3d3450f892eebd2bb01867a03c0cd8d534040';
export const O61_FINGERPRINT_FILE_COUNT = 664;

function validateFingerprint(value, field) {
  assertPlainObject(value, field);
  assertExactKeys(value, ['algorithm', 'digest', 'fileCount', 'scope'], field);
  invariant(value.algorithm === 'sha256', 'INVALID_FINGERPRINT', `${field}.algorithm must be sha256`);
  assertSha256(value.digest, `${field}.digest`);
  invariant(Number.isSafeInteger(value.fileCount) && value.fileCount >= 0, 'INVALID_FINGERPRINT', `${field}.fileCount must be non-negative`);
  invariant(Array.isArray(value.scope), 'INVALID_FINGERPRINT_SCOPE', `${field}.scope must be an ordered array`);
  const scope = value.scope.map((entry, index) => canonicalRepoPath(entry, `${field}.scope[${index}]`));
  invariant(
    scope.length === O61_FINGERPRINT_SCOPE.length && scope.every((entry, index) => entry === O61_FINGERPRINT_SCOPE[index]),
    'INVALID_FINGERPRINT_SCOPE',
    `${field}.scope does not match the canonical O61 scope order`,
  );
  return value;
}

export function validatePrePostFingerprint(before, after) {
  validateFingerprint(before, 'fingerprintBefore');
  validateFingerprint(after, 'fingerprintAfter');
  invariant(semanticDigest(before) === semanticDigest(after), 'FINGERPRINT_DRIFT', 'pre/post fingerprints differ');
  invariant(
    before.digest === O61_FINGERPRINT_DIGEST && before.fileCount === O61_FINGERPRINT_FILE_COUNT,
    'FINGERPRINT_NOT_FROZEN_O61',
    'fingerprint does not identify the frozen O61 46aa/664 source set',
  );
  return Object.freeze({ ...before, scope: Object.freeze([...before.scope]) });
}

function unsignedManifest(manifest) {
  const { manifestDigest: _discard, ...unsigned } = manifest;
  return unsigned;
}

export function sealDependencyManifest(draft) {
  assertPlainObject(draft, 'manifest');
  invariant(!Object.hasOwn(draft, 'manifestDigest'), 'ALREADY_SEALED', 'draft already has manifestDigest');
  return { ...draft, manifestDigest: semanticDigest(draft) };
}

// Structural-only: validates the sealed claim graph, not bytes observed from storage.
export function validateDependencyManifestStructure(manifest, { requiredDependencies = [] } = {}) {
  assertPlainObject(manifest, 'manifest');
  assertExactKeys(
    manifest,
    ['schema', 'entrypoints', 'files', 'requiredDependencies', 'fingerprintBefore', 'fingerprintAfter', 'manifestDigest'],
    'manifest',
  );
  invariant(manifest.schema === DEPENDENCY_MANIFEST_SCHEMA, 'INVALID_SCHEMA', 'dependency manifest schema mismatch');
  assertSha256(manifest.manifestDigest, 'manifestDigest');
  invariant(semanticDigest(unsignedManifest(manifest)) === manifest.manifestDigest, 'MANIFEST_DIGEST_MISMATCH', 'dependency manifest was mutated after sealing');
  validatePrePostFingerprint(manifest.fingerprintBefore, manifest.fingerprintAfter);

  invariant(Array.isArray(manifest.files) && manifest.files.length > 0, 'INVALID_FILES', 'files must be a non-empty array');
  const filePaths = manifest.files.map((file, index) => {
    assertPlainObject(file, `files[${index}]`);
    assertExactKeys(file, ['path', 'sha256'], `files[${index}]`);
    canonicalRepoPath(file.path, `files[${index}].path`);
    assertSha256(file.sha256, `files[${index}].sha256`);
    return file.path;
  });
  assertUnique(filePaths, 'files[].path');
  const fileSet = new Set(filePaths);

  invariant(Array.isArray(manifest.requiredDependencies), 'INVALID_REQUIRED_DEPENDENCIES', 'requiredDependencies must be an array');
  const declaredRequired = manifest.requiredDependencies.map((item, index) => canonicalRepoPath(item, `requiredDependencies[${index}]`));
  assertUnique(declaredRequired, 'requiredDependencies');
  for (const item of declaredRequired) {
    invariant(fileSet.has(item), 'OMITTED_DEPENDENCY', `declared required dependency is absent from files: ${item}`);
  }
  for (const item of requiredDependencies.map((entry, index) => canonicalRepoPath(entry, `required option[${index}]`))) {
    invariant(declaredRequired.includes(item), 'OMITTED_DEPENDENCY', `caller-required dependency is not declared: ${item}`);
  }

  invariant(Array.isArray(manifest.entrypoints) && manifest.entrypoints.length > 0, 'INVALID_ENTRYPOINTS', 'entrypoints must be a non-empty array');
  const entrypointPaths = [];
  const reachable = new Set();
  for (const [index, entrypoint] of manifest.entrypoints.entries()) {
    assertPlainObject(entrypoint, `entrypoints[${index}]`);
    assertExactKeys(entrypoint, ['path', 'closure'], `entrypoints[${index}]`);
    canonicalRepoPath(entrypoint.path, `entrypoints[${index}].path`);
    entrypointPaths.push(entrypoint.path);
    invariant(fileSet.has(entrypoint.path), 'OMITTED_ENTRYPOINT', `entrypoint is absent from files: ${entrypoint.path}`);
    invariant(Array.isArray(entrypoint.closure) && entrypoint.closure.length > 0, 'INVALID_CLOSURE', `entrypoint closure must be non-empty: ${entrypoint.path}`);
    const closure = entrypoint.closure.map((item, closureIndex) => canonicalRepoPath(item, `entrypoints[${index}].closure[${closureIndex}]`));
    assertUnique(closure, `entrypoints[${index}].closure`);
    invariant(closure.includes(entrypoint.path), 'INCOMPLETE_CLOSURE', `closure must include entrypoint: ${entrypoint.path}`);
    for (const item of closure) {
      invariant(fileSet.has(item), 'UNKNOWN_CLOSURE_FILE', `closure references undeclared file: ${item}`);
      reachable.add(item);
    }
  }
  assertUnique(entrypointPaths, 'entrypoints[].path');
  const orphaned = filePaths.filter((item) => !reachable.has(item));
  invariant(orphaned.length === 0, 'ORPHANED_DEPENDENCY', 'all manifest files must be in an entrypoint closure', orphaned);
  for (const item of declaredRequired) {
    invariant(reachable.has(item), 'INCOMPLETE_CLOSURE', `required dependency is outside entrypoint closures: ${item}`);
  }
  return { manifestDigest: manifest.manifestDigest, fileCount: filePaths.length, entrypointCount: entrypointPaths.length };
}

// Authoritative boundary: requires a complete observed byte inventory and recomputes every file digest.
export function validateObservedDependencyManifest(manifest, { requiredDependencies = [], observedFiles }) {
  const structural = validateDependencyManifestStructure(manifest, { requiredDependencies });
  invariant(Array.isArray(observedFiles), 'OBSERVED_FILES_REQUIRED', 'authoritative observed file bytes are required');
  const observed = observedFiles.map((file, index) => {
    assertPlainObject(file, `observedFiles[${index}]`);
    assertExactKeys(file, ['path', 'content'], `observedFiles[${index}]`);
    const filePath = canonicalRepoPath(file.path, `observedFiles[${index}].path`);
    return { path: filePath, sha256: sha256(bytesOf(file.content)) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  assertUnique(observed.map(({ path }) => path), 'observedFiles[].path');
  const declared = manifest.files.map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  invariant(
    observed.length === declared.length && observed.every((file, index) => file.path === declared[index].path),
    'OBSERVED_DEPENDENCY_SET_MISMATCH',
    'observed file set differs from the sealed dependency manifest',
  );
  for (let index = 0; index < declared.length; index += 1) {
    invariant(
      observed[index].sha256 === declared[index].sha256,
      'OBSERVED_DEPENDENCY_DIGEST_MISMATCH',
      `observed bytes differ for ${declared[index].path}`,
    );
  }
  return {
    ...structural,
    observationDigest: semanticDigest(observed),
    observedFileCount: observed.length,
  };
}
