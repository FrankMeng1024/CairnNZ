# Test results

| Command / evidence | Result | Log |
|---|---:|---|
| Two focused pre-fix regressions on the recovered candidate | Expected FAIL: 2 failed / 18 passed | `test-output/pre-fix-defect-reproduction.log` |
| 18 focused client Route/Activity/Cairn/Trails/offline suites | PASS: 18 suites, 164 tests | `test-output/client-focused-regression.log` |
| Focused backend Route origin/delete and Activity contracts | PASS: 18/18 | `test-output/backend-focused-regression.log` |
| Real MySQL Route origin/delete integration | PASS: 1/1 | `test-output/mysql-route-origin-integration.log` |
| Migration runner first application | PASS: 036 applied and verified | `test-output/mysql-migration-first-run-with-container-client.log` |
| Migration runner rerun | PASS: 0 new, last 036 | `test-output/mysql-migration-rerun-with-container-client.log` |
| Schema verifier | PASS | `test-output/mysql-schema-verification.log` |
| `cd app && npm run verify:changed` | PASS: 552/552 | `test-output/verify-changed.log` |
| Expo Web visual/interaction capture | PASS: 13/13, 0 runtime errors | `test-output/visual-capture.log` |
| Full app TypeScript check | FAIL: existing baseline, 253 diagnostic lines; 0 revision-02 touched paths | `test-output/typescript.log` |

The focused client command and exact suites are printed in `test-output/client-focused-regression.log`. The Jest `setupFilesAfterFramework` validation warning is a pre-existing configuration warning. No assertion was weakened and no flaky failure was retried to green.

