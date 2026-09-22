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
import { deriveTerminalStatus } from './status.mjs';

export const ARTIFACT_MANIFEST_SCHEMA = 'cairnnz.external.artifact-manifest.v1';

function unsignedReceipt(receipt) {
  const { manifestDigest: _discard, ...unsigned } = receipt;
  return unsigned;
}

function assertObservedExitCode(value) {
  invariant(
    Number.isSafeInteger(value) && value >= 0 && value <= 255,
    'INVALID_TERMINAL_EXIT_CODE',
    'observedTerminalExitCode must be an integer from 0 through 255',
  );
}

function normalizeArtifact(artifact, index) {
  assertPlainObject(artifact, `artifacts[${index}]`);
  assertExactKeys(artifact, ['path', 'mediaType', 'content'], `artifacts[${index}]`);
  const artifactPath = canonicalRepoPath(artifact.path, `artifacts[${index}].path`);
  invariant(typeof artifact.mediaType === 'string' && artifact.mediaType.length > 0, 'INVALID_MEDIA_TYPE', 'mediaType is required');
  const bytes = bytesOf(artifact.content);
  const sealed = {
    path: artifactPath,
    mediaType: artifact.mediaType,
    size: bytes.length,
    rawSha256: sha256(bytes),
  };
  if (artifact.mediaType === 'application/json') {
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      invariant(false, 'INVALID_JSON_ARTIFACT', `${artifactPath} is not valid JSON`);
    }
    sealed.semanticSha256 = semanticDigest(parsed);
  }
  return sealed;
}

export function sealArtifactManifest({ terminalArtifact, observedTerminalExitCode, artifacts }) {
  canonicalRepoPath(terminalArtifact, 'terminalArtifact');
  assertObservedExitCode(observedTerminalExitCode);
  invariant(Array.isArray(artifacts) && artifacts.length > 0, 'INVALID_ARTIFACTS', 'artifacts must be non-empty');
  const sealedArtifacts = artifacts.map(normalizeArtifact).sort((left, right) => left.path.localeCompare(right.path));
  assertUnique(sealedArtifacts.map(({ path }) => path), 'artifacts[].path');
  invariant(sealedArtifacts.some(({ path }) => path === terminalArtifact), 'TERMINAL_ARTIFACT_UNDECLARED', 'terminalArtifact must name a declared artifact');
  const unsigned = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    terminalArtifact,
    observedTerminalExitCode,
    artifacts: sealedArtifacts,
  };
  return { ...unsigned, manifestDigest: semanticDigest(unsigned) };
}

export function validateArtifactManifest(receipt, { artifacts, requirePassingTerminal = false }) {
  assertPlainObject(receipt, 'receipt');
  assertExactKeys(receipt, ['schema', 'terminalArtifact', 'observedTerminalExitCode', 'artifacts', 'manifestDigest'], 'receipt');
  invariant(receipt.schema === ARTIFACT_MANIFEST_SCHEMA, 'INVALID_SCHEMA', 'artifact manifest schema mismatch');
  canonicalRepoPath(receipt.terminalArtifact, 'terminalArtifact');
  assertObservedExitCode(receipt.observedTerminalExitCode);
  assertSha256(receipt.manifestDigest, 'manifestDigest');
  invariant(semanticDigest(unsignedReceipt(receipt)) === receipt.manifestDigest, 'MANIFEST_DIGEST_MISMATCH', 'artifact manifest was mutated after sealing');
  invariant(Array.isArray(receipt.artifacts) && receipt.artifacts.length > 0, 'INVALID_ARTIFACTS', 'receipt.artifacts must be non-empty');

  const declaredPaths = receipt.artifacts.map((artifact, index) => {
    assertPlainObject(artifact, `receipt.artifacts[${index}]`);
    assertExactKeys(artifact, artifact.mediaType === 'application/json'
      ? ['path', 'mediaType', 'size', 'rawSha256', 'semanticSha256']
      : ['path', 'mediaType', 'size', 'rawSha256'], `receipt.artifacts[${index}]`);
    canonicalRepoPath(artifact.path, `receipt.artifacts[${index}].path`);
    invariant(Number.isSafeInteger(artifact.size) && artifact.size >= 0, 'INVALID_ARTIFACT_SIZE', 'artifact size must be non-negative');
    assertSha256(artifact.rawSha256, 'rawSha256');
    if (artifact.mediaType === 'application/json') assertSha256(artifact.semanticSha256, 'semanticSha256');
    return artifact.path;
  });
  assertUnique(declaredPaths, 'receipt.artifacts[].path');
  invariant(declaredPaths.includes(receipt.terminalArtifact), 'TERMINAL_ARTIFACT_UNDECLARED', 'terminal artifact is not declared');

  invariant(Array.isArray(artifacts), 'ACTUAL_ARTIFACTS_REQUIRED', 'complete actual artifact inventory is required');
  const resealed = artifacts.map(normalizeArtifact).sort((left, right) => left.path.localeCompare(right.path));
  const actualPaths = resealed.map(({ path }) => path);
  assertUnique(actualPaths, 'actual artifacts[].path');
  invariant(
    declaredPaths.length === actualPaths.length && declaredPaths.every((item) => actualPaths.includes(item)),
    'INCOMPLETE_ARTIFACT_MANIFEST',
    'declared and actual artifact sets differ',
    { declaredPaths, actualPaths },
  );
  const declaredByPath = new Map(receipt.artifacts.map((item) => [item.path, item]));
  for (const actual of resealed) {
    invariant(semanticDigest(actual) === semanticDigest(declaredByPath.get(actual.path)), 'ARTIFACT_MISMATCH', `artifact bytes or metadata changed: ${actual.path}`);
  }

  const terminalSource = artifacts.find(({ path }) => path === receipt.terminalArtifact);
  invariant(terminalSource?.mediaType === 'application/json', 'INVALID_TERMINAL_ARTIFACT', 'terminal artifact must be JSON');
  let terminalDocument;
  try {
    terminalDocument = JSON.parse(bytesOf(terminalSource.content).toString('utf8'));
  } catch {
    invariant(false, 'INVALID_TERMINAL_ARTIFACT', 'terminal artifact is not valid JSON');
  }
  assertPlainObject(terminalDocument, 'terminal artifact');
  const embeddedExitCodes = [];
  for (const key of ['exitCode', 'exit_code']) {
    if (!Object.hasOwn(terminalDocument, key)) continue;
    invariant(
      Number.isSafeInteger(terminalDocument[key]),
      'INVALID_EMBEDDED_EXIT_CODE',
      `terminal artifact ${key} must be an integer`,
    );
    embeddedExitCodes.push({ key, value: terminalDocument[key] });
  }
  invariant(
    new Set(embeddedExitCodes.map(({ value }) => value)).size <= 1,
    'CONTRADICTORY_EMBEDDED_EXIT_CODES',
    'terminal artifact exitCode and exit_code conflict',
  );
  for (const { key, value } of embeddedExitCodes) {
    invariant(
      value === receipt.observedTerminalExitCode,
      'TERMINAL_EXIT_CODE_MISMATCH',
      `terminal artifact ${key} does not match observedTerminalExitCode`,
    );
  }
  const terminal = deriveTerminalStatus(terminalDocument, { exitCode: receipt.observedTerminalExitCode });
  const claimsPass = terminal.observations.some(({ normalized }) => normalized === 'PASS');
  if (claimsPass) {
    invariant(receipt.observedTerminalExitCode === 0, 'PASS_WITH_NONZERO_EXIT', 'PASS terminal artifact has a nonzero observed exit code');
  }
  if (requirePassingTerminal) {
    invariant(receipt.observedTerminalExitCode === 0 && terminal.status === 'PASS', 'TERMINAL_NOT_PASS', 'terminal artifact does not prove PASS', terminal);
  }
  return { manifestDigest: receipt.manifestDigest, artifactCount: declaredPaths.length, terminal };
}
