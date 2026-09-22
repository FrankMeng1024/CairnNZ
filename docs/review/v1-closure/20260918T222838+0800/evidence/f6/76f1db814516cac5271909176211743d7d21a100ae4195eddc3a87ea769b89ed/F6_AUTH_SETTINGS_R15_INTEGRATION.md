# F6 Auth/Settings authority R15 integration

Status: **INTEGRATED / VERIFIED**

- Integrated: `2026-09-20`
- Recovery HEAD: `0520b102eae78a1dd77aa39418a919d85f5648c1`
- Exact preimage fingerprint: `5388999b94c33b2d87474e6f9606eefc26e56c5a2192313f240f68279dd4c1b4` / 647 files
- Exact integrated fingerprint: `76f1db814516cac5271909176211743d7d21a100ae4195eddc3a87ea769b89ed` / 657 files
- Integrated patch SHA-256: `3fbbe71d4edf171fbf6c81cbc6f18f8d3c4b1e4712eb8a25957d6ce1128443e9`
- Source ledger SHA-256: `5704e1fd1658dbd6c033c29e47026e24d38e63a2f4ad0b1765f9fa030192f306`
- Apply result: 28/28 paths applied cleanly with `git apply --verbose --whitespace=error-all`; no fuzz or whitespace error
- Postimage result: 28/28 exact candidate hashes matched
- Reverse-apply check: PASS
- `git diff --check`: PASS

Fresh primary-tree verification:

- Focused authority suite: 10/10 suites, 81/81 tests passed
- Selected retained regressions: 5/5 suites, 24/24 tests passed
- C1 strict-storage/cache regressions: 1/1 suite, 38/38 tests passed
- Direct TypeScript parse: 28/28 changed `.ts`/`.tsx` paths, zero syntax diagnostics
- `tsc --noEmit --pretty false`: exit 2 with 153 existing repository diagnostics; zero diagnostics name an R15 changed path. No global TypeScript pass is claimed.
- Existing Jest `setupFilesAfterFramework` validation warning remained visible and did not affect results.

Fresh receipt SHA-256:

- Focused 81 JSON: `9ffb9cc2bc64b41d8d1aa044a50e3f2dee0332242785ddaac3ffc096d71e1ee9`
- Selected 24 JSON: `9f5e3da9ad5d7343c33a27e9a64c61b3268f07457ced24b188ad201409f55d53`
- C1 38 JSON: `10dfc420f2fcae0a37414b6be51f0cf4e30d47e0b766ce974f342bab52ad9c17`

The receipts and recovery material are in `/Users/mzm/Desktop/cairn_revision03_work/checkpoints/f6-auth-authority-r15-primary-integration-20260920T234236+0800/`. The pre-integration tracked diff is `pre-integration-tracked.patch`, SHA-256 `1d330ac2b6da40d897b1f34967f8ef5daa6953484eeec7ff4b614ff4e697695c`.

Existing unrelated tracked and untracked work was preserved. No browser, native device, API, database, MySQL, service, deployment, OTA, heavy suite, full suite, Home marker, or app/runtime/build version action occurred.
