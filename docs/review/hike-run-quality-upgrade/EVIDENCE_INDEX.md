# Evidence index

- `reports/`: Chinese product report, regression audit, structured visual review, native pending checklist, grades and source identity.
- `source/`: exact committed source archive and review patch.
- `corpus/`: frozen public sensor inputs, private diaries, feasibility records, schedules and clean-reference provenance.
- `new-campaign/`: compact per-Activity QA records, exact development/holdout results, metrics and selected screenshots.
- `old-regression/`: current captured-response probes and metrics plus prior comparison metrics.
- `diagnostics/`: complete per-Activity replay exports are embedded in each `QA_ACTIVITY.json`; fresh-process command and result are included.
- `backend/`: isolated real backend/database outcome.
- `route-correction/`: Activity→Route transaction, hashes and screenshots.
- `visual/`: physical route atlas and final Activity output atlas.
- `provider/`: sanitized request ledger and the unique captured-response cassette set used by exact replay.
- `tests/`: verification summary.

Large browser profiles, Metro caches, dependencies, duplicated screenshots, failed intermediate output directories and redundant copies of identical responses are intentionally excluded.
