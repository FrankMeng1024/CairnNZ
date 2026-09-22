# F6 Settings normal-handler disposition

Completed: `2026-09-20T11:12:51+08:00`

## Verdict

**PASS for the focused F6 Settings handler boundary at exact product
fingerprint
`a695bdf5c1db67110f0638d3c0f7e8247ff60d47461ee1a37296c9c23d229c5d`
(636 files).** The preserved three-case RED remains historical evidence of the
pre-fix behavior and is stale for the current source. This is focused handler
and source-contract evidence, not loaded UI, native-device, or broad product
acceptance evidence.

## Candidate and preflight

- Candidate patch:
  `/Users/mzm/Desktop/cairn_revision03_work/candidates/settings-f6-20260920T103339+0800/settings-f6.patch`
- Required and observed patch SHA-256:
  `1b1e172fce98285c0f7bbb026d7d780f91ca1067f99c512813e5d37bf7a0062d`.
- `app/src/screens/SettingsScreen.tsx` preimage SHA-256:
  `796bfae3e3ec32f0a4a630f7ca5f238b4343dea220be786ce9a4b7a580afc584`.
- `app/src/screens/__tests__/settingsAccountBoundary.test.tsx` SHA-256:
  `3f9704adf9aa0f0a60f63be9d84129dd1b044084a6a51f3394ab08815d6a9583`.
- Preserved RED log SHA-256:
  `a54c198c79f31d8a2713e072de33996b813b88b2119c583fcb73a5495de12486`.
- Pre-apply product fingerprint:
  `dabf6ee6a60bbb7d5650d58a34978fab9413c3e0b03717ea8b3357be8f80836a`
  (636 files).
- `git apply --check <candidate>` exited 0 before integration.
- After integration, `git apply --reverse --check <candidate>` and
  `git diff --check -- app/src/screens/SettingsScreen.tsx` both exited 0.
- Patched file SHA-256 exactly matches the candidate manifest:
  `66cc4d4920f8c00a8528d8f3d6a1b68492b6af210773f33f444b77e9fd4dfbb9`.

## Demonstrated correction

Only `app/src/screens/SettingsScreen.tsx` changed in the product source for
this integration:

- profile refresh captures the current account owner and accepts the response
  only if both the response owner and live store owner still match;
- name save captures the submission owner, rejects a stale completion without
  closing the draft, and merges a valid response into the matching live user;
- exploration-history deletion has a synchronous ref-backed single-flight
  lock, with disabled/busy accessibility state exposed on the action row.

These are the three conditions reproduced by the preserved RED. No threshold,
test expectation, marker, app/runtime version, backend, database, deployment,
OTA, or supervision hook changed.

## Focused verification

1. Account/action boundary:

   `cd app && ./node_modules/.bin/jest src/screens/__tests__/settingsAccountBoundary.test.tsx --runInBand --no-cache --json --outputFile=../docs/review/v1-closure/20260918T222838+0800/evidence/f6/a695bdf5c1db67110f0638d3c0f7e8247ff60d47461ee1a37296c9c23d229c5d/settings-account-boundary.json`

   Result: exit 0; **1/1 suite, 3/3 tests PASS**. The first invocation also
   passed all 3 assertions but exited 1 after the run because its JSON parent
   directory had mistakenly been created under `app/docs`; that operator path
   error was corrected without changing source or test semantics. The empty
   mistaken F6 directory was removed.

   Artifact SHA-256:
   `afaeee73a94e4f543545cdb11b3464962c78d313b8cf18324a6d4a0dcf1cc867`.

2. Adjacent Settings product convergence:

   `cd app && ./node_modules/.bin/jest src/screens/__tests__/settingsProductConvergence.test.ts --runInBand --no-cache --json --outputFile=../docs/review/v1-closure/20260918T222838+0800/evidence/f6/a695bdf5c1db67110f0638d3c0f7e8247ff60d47461ee1a37296c9c23d229c5d/settings-product-convergence.json`

   Result: exit 0; **1/1 suite, 11/11 tests PASS**.

   Artifact SHA-256:
   `56dc1a666be81d2d279ed97b3bef077520048e23ef87d2232c554e6b066721f4`.

3. Smallest changed-scope gate:

   `cd app && npm run verify:changed -- --file=app/src/screens/SettingsScreen.tsx`

   Result: exit 0; `Activity Changed Verification — PASS`; no Activity-impact
   rule matched and no Activity suite ran.

The Jest configuration emitted its existing
`setupFilesAfterFramework` validation warning in both focused commands. It did
not change either PASS result.

## Boundaries

No browser, database, performance workload, backend test, native/device run,
deployment, OTA, or broad acceptance suite was run. No owned process remains
running.
