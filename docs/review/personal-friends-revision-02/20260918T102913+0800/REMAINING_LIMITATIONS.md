# Remaining limitations

- No OTA was published and O60 was not loaded onto an owner phone by this task.
- No physical iOS/native Mapbox, background/foreground, process-death, safe-area, keyboard, haptic, or battery run was performed.
- No physical GPS or friend proximity was tested; synthetic source-contract observations are not real presence and are not New Zealand field validation.
- Expo Web emitted one known Mapbox GL v2 request-callback error during direct QA route teardown. It is preserved in `qa/web-loaded/renderer-warnings.txt`; every subsequent Memory capture independently required `map.loaded()` and a hidden loading veil.
- Jest reports an existing invalid `setupFilesAfterFramework` configuration key and an open-handle warning after the focused run. Assertions still complete and the process exits successfully; the warnings are retained rather than edited outside scope.
- Repository-wide TypeScript still contains pre-existing unrelated errors. The required changed-file scoped check is clean and the CORE gate reports 59/59 static checks.
- Local Docker MySQL could not start under the host seccomp/thread restriction. The failure logs are retained. Disposable rehearsal and final A/B/C/D verification therefore ran against isolated remote MySQL 8.0.45 under the authorized review procedure.
- Offline revocation cannot be learned until reconnect; cached shared content therefore uses the approved non-renewing 24-hour maximum and truthful last-checked context.
- Encounter evidence is policy-checked client GPS evidence, not cryptographic proof of a human visit.
- Public/stranger discovery, media, voice, pricing, planner, turn-by-turn navigation, App Store work, and owner acceptance remain out of scope.

