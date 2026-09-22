# CairnNZ visual guardrail

Before visual work, read `docs/VISUAL_SYSTEM.md` and `docs/VISUAL_MIGRATION_STATE.md`, inspect `docs/VISUAL_ASSET_MANIFEST.json` and the QA boards, and reuse the canonical assets, tokens, and components. Preserve strong original artwork and derive related artwork from the locked Home family. Validate meaningful changes through Expo Web at mobile size. Never independently reinvent CairnNZ's visual direction, layout, or core visual anchors without an explicit user request.

For production backend deployment, follow `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`. If there is no backend change, do not push or deploy merely for client OTA work.

Generated QA screenshots, boards, and captures should not normally be committed to deploy-bearing `master`. Keep textual/JSON review authority in Git, use ignored local outputs for reproducible visuals, and use external artifact storage when long-term visual retention is required.

For a validated, human-testable client OTA candidate, increment the one existing Home `O<number>` marker by exactly one. Do not increment it for investigation, backend/docs-only work, failed validation, or a HOLD verdict. Do not change app/runtime/build versions; the human publishes OTA manually.

For Activity changes, start with `cd app && npm run verify:changed`; do not default to repo-wide tests. Product-contract changes require an explicit regression audit, flaky tests must be diagnosed rather than retried to green, and native GPS changes still require native telemetry evidence. See `docs/operations/ACTIVITY_VERIFICATION.md`.
