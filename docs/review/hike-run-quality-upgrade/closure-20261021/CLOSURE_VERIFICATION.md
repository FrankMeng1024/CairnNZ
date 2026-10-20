# Verification record

## Source-bound closure runs

All listed successful closure runs identify source head `ab76e4195373e1372d689ab651451faba2320b2c` and tree `5457ef40a95d0f00d39727a49b24bf297890ff65` in their machine-readable results.

- Authentic Q08: 2/2 completed, no unexpected external network request.
- Raw-only diagnostic replay: 18/18 completed, no unexpected external network request.
- Plant/application flow: 18/18 assertions pass, explicitly Web-only application-handler scope.
- Actual client modules → isolated backend/MySQL: 4/4 scenarios pass; DB assertions pass; teardown occurs after evidence capture.
- Focused diagnostic/delivery/UI/background tests: four suites pass; 26 assertions pass and one environment-gated assertion skips.
- Pre-commit changed-file routing selected Activity CORE and passed 650/650 (continuity 128, cadence 5, background 32, gap 15, elevation 5, matching 42, telemetry 40, integration 114, memory-gap 12, journal 60, memory 37, offline-sync 68, simulator 56, server 23, static 13).
- Post-commit explicit `--gate=core` passed 670/670 with the same functional group counts and static 33/33. The 20-test difference is expected: with no working-tree change, explicit gate validation scopes static checking to the selected test sources rather than the 13 changed TypeScript files. The unedited log is `verification/verify-changed-core.log`.
- `git diff --check`, Node syntax and shell syntax checks passed before the source commit.

## Later expanded full-gate negative result

After the source commit, `npm run verify:changed -- --gate=full` deliberately expanded beyond the change-routed set and failed. Its unedited log is `verification/verify-changed-full.log`:

- 237 suites passed, 4 failed, 1 skipped (241 of 242 run).
- 2346 tests passed, 6 failed, 5 skipped (2357 total).
- Failures: `revision03MemoryScale.test.ts` timing budget; `activityJournalProjection.test.ts` timing budget; three assertions in `memoryLivePresentationEvidence.test.ts` (timeout/timing); and `cairnCommitSingleFlight.test.ts` static contract.
- This was one run, was not retried to green, and did not trigger code changes in this Hike/Run closure round.
- The shell pipeline used `tee`, so the outer shell's displayed status was 0; the embedded test runner output clearly says `Activity client verification — FAIL` and is authoritative.

## TypeScript boundary

A repository-wide `npx tsc --noEmit` was attempted and reached known baseline errors including absent `@playwright/test` declarations and unrelated generated preview/type issues. No parser failure from the changed files was observed. This is not represented as a clean full typecheck.

## Packaging validation

Each closure ZIP is built with standard `ZIP_DEFLATED`, contains no symlinks or nested ZIP dependency, is freshly extracted into an empty temporary directory, and validates every file against its root `MANIFEST.sha256`. `ZIP_VALIDATION.json` records counts and status. Inspection requires no absolute path.
