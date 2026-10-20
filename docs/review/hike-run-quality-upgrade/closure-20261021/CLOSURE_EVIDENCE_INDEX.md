# Closure evidence index

All paths below are relative to the root of the CORE archive unless marked VISUAL.

| Claim or question | Primary evidence | Notes |
|---|---|---|
| Exact code under test | `identity/SOURCE_IDENTITY.json`, `identity/GIT_IDENTITY.txt`, `identity/81574c0d-to-ab76e419.patch` | Product/evidence scripts ran at `ab76e419...`, tree `5457ef40...`. |
| What changed | `source/tested-tree/`, `source/SOURCE_SELECTION.json`, the patch, `reports/CLOSURE_REPORT_CN.md` | Full changed files and required unchanged dependencies, not excerpts. |
| Original strict findings | `strict-review/REVIEW_CN.md`, `EVIDENCE.md`, `CODEX_CLOSURE_PROMPT_EN.md` | Includes independent audit and closure contract verbatim. |
| Independent metrics and original probes | `strict-review/independent_metrics.json`, `diagnostic_lifecycle_probe_results.json`, `independent_pack_audit.json` | Negative findings retained. |
| Same GPS inputs / Q08 correction | `q08/FIXTURE_REPAIR_REPORT.json`, `FROZEN_CORPUS_MANIFEST.json`, both authentic fixtures | Repair changes delivery schedule, not coordinates or observation times. |
| Q08 outcomes and re-grade | `q08/run/SUMMARY.json`, both `CLOSURE_RESULT.json`, `q08-authentic-evaluation.json` | Other corpus cases are explicitly `NOT_RUN`; no blanket re-grade. |
| Diagnostics alone reproduce behavior | `diagnostic-replay/SUMMARY.json`, 18 per-case receipts | Raw/provider are execution inputs; saved outputs are comparison only. |
| Durable diagnostics | source, focused tests, original lifecycle probe | Original broken probe is retained beside fixed tests. |
| Save → ACK → phone cleanup | `client-backend/CLIENT_BACKEND_CLOSURE.json`, DB/HTTP files | Real client modules, loopback backend, disposable DB. |
| Lost ACK / retry / idempotency | same result plus `DB_IDEMPOTENCY_ASSERTIONS.tsv` | No genuine production records mutated. |
| Plant while recording | `plant-lifecycle/RESULT.json`, `PUBLIC_INPUT.json`; VISUAL screenshots | Web application-handler scope only. |
| Activity → Route correction | `route-correction/` and old strict-review result; VISUAL screenshots | New difficult attempts failed before correction due missing token. |
| Mapbox request accounting | `provider/mapbox-request-ledger.json`, `provider/LEDGER_NOTE.md` | Entry 120 unresolved; no fabricated completion. |
| Tests, failures and typecheck boundary | `verification/`, `reports/CLOSURE_VERIFICATION.md` | Includes explicit repo-wide full-gate failures. |
| Visual ordinary/run/stop/restart/turn/retraversal/drift/trail/worst/live/final | VISUAL `same-viewport/`, `live-frames/`, `atlases/`, `metadata/IMAGE_INDEX.tsv` | Old captures preserved without altering map geometry. |
| Remaining limitations | `reports/CLOSURE_REPORT_CN.md`, `CLOSURE_ISSUE_LEDGER.md` | HOLD and native pending are explicit. |

The original complete archive remains outside these closure packages and is identified by SHA-256 `5f85d0c8ee5bf5dd1cc3303596b1a77be222a829e4fc58b0a46fff0fd3c658d7` and byte size `18,042,156`.
