# CairnNZ visual guardrail

Before visual work, read `docs/VISUAL_SYSTEM.md` and `docs/VISUAL_MIGRATION_STATE.md`, inspect `docs/VISUAL_ASSET_MANIFEST.json` and the QA boards, and reuse the canonical assets, tokens, and components. Preserve strong original artwork and derive related artwork from the locked Home family. Validate meaningful changes through Expo Web at mobile size. Never independently reinvent CairnNZ's visual direction, layout, or core visual anchors without an explicit user request.

For production backend deployment, follow `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`. If there is no backend change, do not push or deploy merely for client OTA work.

Generated QA screenshots, boards, and captures should not normally be committed to deploy-bearing `master`. Keep textual/JSON review authority in Git, use ignored local outputs for reproducible visuals, and use external artifact storage when long-term visual retention is required.
