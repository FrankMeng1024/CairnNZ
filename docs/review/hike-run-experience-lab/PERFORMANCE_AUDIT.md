# Focused baseline/candidate performance audit

This audit addresses the independent review’s five wall-time failures without changing budgets or retrying selectively.

## Method

- Baseline: `ab76e4195373e1372d689ab651451faba2320b2c`, tree `5457ef40a95d0f00d39727a49b24bf297890ff65`.
- Candidate: `a9ff27769798b1595b8ac1bacd481d49e4b37677`, tree `ac23e61ec299ad6352b8077682e537b653264504`.
- Host: Intel Core i5-5350U 1.8 GHz, 4 logical CPUs, 8 GB RAM; Node 24.11.1.
- Three isolated files, three trials per commit, serialized, Jest `--runInBand --no-cache`.
- Odd trials run baseline then candidate; even trials reverse the order.
- Thresholds are the existing checked-in thresholds. No run was discarded or selectively repeated.
- Each worktree had an untracked `app/node_modules` symlink to the same lockfile installation. Its HEAD and tree provide the tested source identity; the symlink is not source.

## Results

| Test | Baseline | Candidate | Existing budget evidence |
|---|---:|---:|---|
| `revision03MemoryScale` | 2/3 pass | 3/3 pass | Baseline trial 2 `union_group` slice 277 ms > 150 ms. Baseline other maxima 53/56 ms; candidate maxima 73/28/55 ms. |
| `activityJournalProjection` | 3/3 pass | 3/3 pass | 20k max synchronous slices baseline 64/66/51 ms; candidate 50/73/13 ms; budget 120 ms. |
| `memoryLivePresentationEvidence` | 3/3 pass | 3/3 pass | All existing per-slice and foreground-response assertions passed. |

Candidate total: 9/9. Baseline total: 8/9. The retained baseline failure is intermittent on this host and is not evidence of a candidate regression. Conversely, passing these Node/Jest budgets is not proof of iPhone UI frame rate, battery, thermal behavior or concurrent native-map load.

## Evidence

`PERFORMANCE_TRIALS.json` is the complete normalized ledger. `PERFORMANCE_SUMMARY.json` carries every assertion and failure message. `MACHINE_AND_POLICY.json` records host/policy. Every invocation also retains raw Jest JSON and stdout/stderr. `/usr/bin/time -l` raw lines are authoritative for real/user/sys/RSS; the runner parses the macOS output order explicitly.
