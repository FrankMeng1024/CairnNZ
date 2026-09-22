# O61 post-closeout harness hardening kit

This is an **external, post-closeout** validation library. It is intentionally outside the frozen O61 `664`-file authority and does not amend, reinterpret, or replace the signed v1 closure evidence. It has no runtime dependencies and performs no browser, API, MySQL, process, container, filesystem, or network operations. Its inputs are explicit in-memory observations collected by a future external harness.

The library consolidates reusable fail-closed logic that should not be copied into product code or the frozen harness:

- exact terminal status parsing, with explicit aliases and contradiction detection;
- canonical semantic JSON equality/digests alongside raw byte digests;
- sealed dependency closures with strict repository-relative paths, byte observations, and pre/post O61 fingerprint fencing;
- plan-assertion proof authorization and named negative controls;
- causal request/error/console/dialog correlation with exact-origin checking;
- explicit terminal-artifact selection, observed exit-code provenance, and complete byte-sealed artifact inventories;
- pure owned-process/container cleanup transcript state validation and readiness identity binding;
- accessible role/name selector uniqueness with optional test-id agreement;
- fixture namespace, table inventory, unique row-key, and zero-preexisting-row checks.

## Run the isolated unit tests

From this directory:

```sh
npm test
```

Or from the repository root:

```sh
node --test docs/review/v1-closure/post-closeout-o61-20260921/tests/*.test.mjs
```

Both commands run only deterministic unit tests. They do not start or attach to a connected journey.

## Use from an external harness

```js
import {
  correlateNetworkEvidence,
  sealDependencyManifest,
  validateObservedDependencyManifest,
} from './src/index.mjs';

const sealed = sealDependencyManifest(unsignedManifest);
validateObservedDependencyManifest(sealed, {
  requiredDependencies: ['backend/src/app.js'],
  observedFiles, // complete [{ path, content }] inventory captured from the run
});

correlateNetworkEvidence({
  exactHost: 'http://127.0.0.1:33012',
  expectedErrors,
  expectedDialogs: [],
  events,
});
```

Callers should create one immutable run identity and bind it into the dependency, readiness, fixture, network, artifact, and cleanup receipts. Capture raw bytes before parsing JSON. Supply complete artifact and dependency inventories, never glob for a “latest” terminal result, seal `observedTerminalExitCode` into the artifact manifest, and retain the returned receipt digests with the external evidence bundle.

`validateDependencyManifestStructure` and `validateAssertionProofStructure` are deliberately named structural-only checks. They detect malformed or internally inconsistent caller claims but do **not** establish provenance. A gate claiming observed evidence must use `validateObservedDependencyManifest` and `validateObservedAssertionProofs`, which recompute raw digests from complete byte inventories and inspect the observed proof receipt content.

## Contracts

| Module | Fail-closed boundary |
| --- | --- |
| `status.mjs` | Unknown tokens such as `BYPASS` and `NOT PASS`, contradictory terminal fields, missing status, and PASS with nonzero exit become `UNVERIFIED`. |
| `canonical-json.mjs` | Object key order is semantic noise; non-JSON values, cycles, and non-finite numbers are rejected. Required-field edit proof demands an actual semantic change. |
| `dependency-manifest.mjs` | Files are unique canonical repository-relative paths. Every file is in an explicit entrypoint closure, caller-required dependencies are declared, observed bytes match, the manifest seal matches, and the exact eight-entry O61 scope is equal before/after. |
| `proof-policy.mjs` | A proof can satisfy only its allowlisted plan assertion, must carry every named negative control with result `PASS`, and at the authoritative boundary must match observed JSON bytes with an unambiguous receipt-level `PASS` and exactly one target-assertion `PASS`. |
| `network-correlation.mjs` | Every request has exactly one terminal response xor network error. Offline failures match by ID, method, URL, phase, exact origin, and time order. Duplicate/unmatched errors, unallowlisted console errors/dialogs, and all 5xx responses fail. |
| `artifact-receipt.mjs` | The terminal JSON path and observed exit code are explicit. PASS requires exit `0`; embedded `exitCode`/`exit_code` values must be integers that agree with the seal; declared and observed artifact sets are identical, byte hashes/sizes match, JSON semantic hashes match, and the manifest seal is intact. |
| `cleanup-model.mjs` | Destructive transitions require the original PID/start-token/group/run/owner or container ID/name/labels, including re-verification before escalation/removal. Exit never implies reap: every owned process needs an explicit reap observation, and the container is verified absent. |
| `selector-contract.mjs` | Exactly one visible, enabled role/name match exists; an optional test ID must resolve to that same element. |
| `fixture-contract.mjs` | Canonical non-empty run/database/realm/namespace identifiers match exactly, required table coverage is exact, every preexisting count is zero, and created rows have unique canonical namespace-prefixed keys. |

Readiness identities likewise require canonical non-empty ownership/start/scope identifiers, a positive safe-integer API PID, and an exact `http` or `https` origin without credentials, path, query, or fragment.

## Scope limits

This kit validates evidence structure and causal bookkeeping; it does not establish product correctness by itself. In particular, semantic JSON equality prevents a key-order permutation from masquerading as an edit, but a product assertion must still name the field that was required to change. Structural-only validators cannot be presented as observed provenance. Likewise, cleanup evaluation validates a supplied transcript; the external runner remains responsible for capturing trustworthy OS/container observations before each destructive action.

Do not import this kit into the frozen O61 closure, modify the historical evidence to match it, or treat these tests as a rerun of the connected Public journey. A future external runner may wrap browser/API/MySQL orchestration around these pure contracts while keeping its fixtures, ports, database, realm, process group, container labels, and artifacts in one run-scoped namespace.
