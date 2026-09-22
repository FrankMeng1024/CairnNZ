# F6 reopened Settings/account-boundary disposition

Completed: `2026-09-20T12:14:22+08:00`

## Verdict

**PASS for the reopened F6 owner/order/modal counterexamples at exact product
fingerprint `097d36a59d0744b83962e8d16ca6671bd2aa11d6ad6b8f955ec6eb374ce6acbf`
(638 files).** A delayed account-A Memory delete cannot clear hydrated B or
show stale A feedback; an A-owned name draft cannot be retried under B; only
the latest same-owner profile refresh may update the store; and the name
modal close affordance is absent during Save.

The earlier `a695bdf5...` F6 evidence is retained but source-stale. This is
focused handler/service evidence, not loaded UI or native-device acceptance.

## RED and diagnosis

- Assigned baseline: `5fb82a42407b7bcbe07ac5af62fe821245a92a36687932f63925ee73c8a3b75c`
  (637 files).
- Service command:
  `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/memorySyncReconcile.test.ts --runInBand --no-cache --json --outputFile=/tmp/cairn-memory-delete-red.json`.
- Result: exit 1, **3/4 passed**. The deletion omitted
  `expectedUserId`, then would return true and clear the live global Memory
  store after A detached and B attached. Artifact SHA-256:
  `07af582a89b37d07b34455493d9c52fe68331f250d68ab2621902737e19449f8`.
- Settings command:
  `cd app && ./node_modules/.bin/jest src/screens/__tests__/settingsAccountBoundary.test.tsx --runInBand --no-cache --json --outputFile=/tmp/cairn-settings-boundary-red.json`.
- Result under the then-active unrelated F5 Metro load: exit 1, **2/6 passed**.
  The three new fail-sensitive assertions were valid: name retry called B a
  second time, the older same-owner profile overwrote the newer one, and the
  header close remained present during Save. The fourth failure was the
  already-green account-switch case timing out under contention; it is not
  product RED evidence. Artifact SHA-256:
  `e1c9456f966fcb5c1809e1cdaf3235fe250db4bd8f0cd0c643781020ba4ae2f7`.

## Smallest demonstrated correction

`app/src/services/memorySync.ts` now requires the initiating owner for delete,
passes it as `expectedUserId` through `authenticatedFetch`, and accepts a
successful response only when the captured epoch, active sync owner, and live
app-store owner still match before `clearAll()`.

`app/src/screens/SettingsScreen.tsx` now:

- captures the delete owner, suppresses stale feedback, and uses an
  account-sensitive generation so B inherits neither A's busy state nor A's
  single-flight completion;
- binds the name draft to its opening owner and disables/rejects retry under a
  different owner while retaining the draft for explicit review;
- accepts only the latest profile refresh generation for a given live owner;
- omits the header close callback while Save is in flight, consistent with
  the existing backdrop and Cancel gates.

No optimistic success, account data, marker/version, backend, database,
deployment, OTA, or supervision behavior changed.

Final SHA-256:

- `memorySync.ts`: `c162ec4b1eb6af5ae99ee533181926b971cc8ef4a6b7372921f1c98ef289cc06`.
- `SettingsScreen.tsx`: `05c65de477de4a0563bf4a6358f70a5d2bb6fd78ee5ab6183a765a980a1ba438`.
- `memorySyncReconcile.test.ts`:
  `cfe5e92aaf8795e5550a373edeb86135522bebe4b7423ec90a553b175986f87b`.
- `settingsAccountBoundary.test.tsx`:
  `2155eb0641741267b0fd60ff6a5d00c70e714e0eac707df3a2b5d02a214e70e2`.

## GREEN and adjacent verification

1. Consolidated focused command:

   `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/fogBoundaryCounterexamples.test.ts src/features/memory/__tests__/memorySyncReconcile.test.ts src/screens/__tests__/settingsAccountBoundary.test.tsx --runInBand --no-cache --json --outputFile=/tmp/cairn-a4-f6-focused-green-final.json`

   Result: exit 0, **3/3 suites, 16/16 tests**. This includes the service
   delete-owner fence and seven Settings normal-handler cases, including the
   added stale delete-feedback/B-busy-state regression. Artifact SHA-256:
   `2fdcf56f0abfe5fa5d845faaefa2927ebc20c83ea7165b8b3d6b8180e7c5d145`.

2. Isolated Settings boundary:

   `cd app && ./node_modules/.bin/jest src/screens/__tests__/settingsAccountBoundary.test.tsx --runInBand --no-cache --json --outputFile=/tmp/cairn-settings-boundary-green.json`

   Result: exit 0, **7/7**. Artifact SHA-256:
   `f53e064a40f8e110a2269ac36699ff2f38eac2b8a57a83ec678aeddd036ee9c5`.

3. Adjacent Settings product/server/API convergence:

   `cd app && ./node_modules/.bin/jest src/screens/__tests__/settingsProductConvergence.test.ts src/services/__tests__/settingsServerActions.test.ts src/services/__tests__/apiService-401-iron-rule.test.ts --runInBand --no-cache --json --outputFile=/tmp/cairn-settings-adjacent-green.json`

   Result: exit 0, **3/3 suites, 25/25 tests**. Jest emitted its delayed-exit
   warning after writing the passing report; no assertion failed and no
   process remained. Artifact SHA-256:
   `083014a0d0dfd1668a78de637b368469c3f34de3c9ae35cb30269abb723247bb`.

4. The same simulated-owned-file changed-scope Activity CORE command recorded
   in the A4 disposition passed **457/457**, including scoped static 6/6 and
   server 23/23.

## Boundaries

The prior `a695bdf5...` F6 JSON/disposition and its 3/3 handler scope are stale
for current source; they remain historical evidence rather than being
rewritten. No browser/native Settings replay was run. The F1/F2 harness was
untouched, and no owned process remained after this checkpoint.

