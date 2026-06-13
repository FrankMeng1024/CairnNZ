# Stage 3 Code Review — MapMatchingClient
**Verdict**: PASS

## Spec compliance
- DEFAULT_RADIUS_M = 25 confirmed at MapMatchingClient.ts:80, comment cites spike-fresh-v63-summary.md and prior empirical results (J1-036). Plan §1.2 satisfied.
- profile=walking unchanged (line 36).
- annotations: NOT in URL params — plan says "annotations + tidy + geojson + overview unchanged". The existing build only sets geometries=geojson, overview=full, tidy=true. No annotations param was present pre-change and none added — neutral, matches "unchanged".
- 8s timeout via AbortController: unchanged (lines 37, 50–67).
- 1 retry on 5xx/network: unchanged (MAX_RETRIES=1, lines 138, 147–158, 192–204).
- 429 no-retry: unchanged (line 141, returns immediately).

## Anti-cheating
- No TODO/FIXME in either file.
- Production diff is scope-disciplined: only DEFAULT_RADIUS_M 50→25 plus rationale comment. No drive-by edits.
- Test "radiuses=25;25;25;25;25" is the literal output of buildUrl for a 5-coord segment with all-null radiuses — not a magic number, derived from contract.
- Other test values (status codes, confidence 0.93, coord counts) are spec/contract-driven, not synthetic shortcuts.

## Test rigor
- Coverage matches plan: NoMatch, NoSegment, TooManyCoordinates, 401, 403, 429, 5xx (retry-exhausted + retry-then-success), thrown network, timeout, happy path, <2 / >100 input, empty matchings, URL radiuses=25.
- Retry-count assertions correct: 5xx → 2 calls (line 161), 429 → 1 call (line 150), thrown network → 2 calls (line 199). Matches MAX_RETRIES=1 semantics.
- Isolation: realFetch saved/restored per test; fetchMock recreated in beforeEach; no shared state between tests.
- Module-load env timing: `process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'test-token'` set at line 27 BEFORE the `require('../MapMatchingClient')` on line 31. Comment explicitly explains hoisting risk and uses require() to defeat ES import hoisting. Correct approach.
- Note: "missing token" path (lines 111–118 in SUT) is NOT covered by a test despite being mentioned in test-file header. Minor gap — not blocking; covered indirectly because token is set.

## Recommendation
PASS. Production change is minimal and traceable. Tests are contract-driven, isolated, and verify retry semantics rigorously. Optional follow-up: add one isolated-module test for the missing-token branch to close the documented gap, but not required for v6.3.
