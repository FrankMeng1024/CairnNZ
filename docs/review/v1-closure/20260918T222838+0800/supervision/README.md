# V1 closure supervision — PREPARE_ONLY packet and live checkpoint

This directory is a derived supervision view for the existing closure run. It does not replace `04_WORK_QUEUE.json`, `03_ACCEPTANCE_PLAN.json`, the Revision‑03 contract, or the Public contract.

Current boundary: the owner activated the trusted project Stop hook, the one allowed fresh-nonce T01 rerun passed in this resumed root session, and the prior T04 PASS was not rerun. `CORE_GUARDS_VERIFIED` is recorded with Fast OFF; T08 remains pending owner-live. Supervised feature execution resumed at A4. Root integrated the bounded Revision-03 Memory correction after read-only diagnosis; the next business action is the frozen full-scale gate followed by exact-fingerprint loaded Raw GPS browser verification. Public remains gated behind the Revision-03 software gate.

## Prepared controls

- `.codex/hooks.json`: exact project-local `Stop` definition only. It does not configure `SubagentStop` or `Interrupt`.
- `.codex/hooks/cairn-v1-stop-gate.mjs`: exact-root/event/run gate. It allows PREPARE_ONLY, RECOVER_ONLY, explicit owner pause, classified recoverable pauses, and verified local closure. It bounds unchanged continuation to one retry and never overrides an owner pause.
- `queue-adapter.mjs`: deterministic read-only projection of the existing queue and acceptance plan.
- `observer.mjs`: optional standard-library metadata observer. It never starts Codex, sends prompts, changes permissions, merges, kills, or repairs.
- `test-preparation.mjs` and `fixtures/supervision-cases.json`: disposable deterministic tests derived from the supplied supervision specification.

`PREPARATION_RESULTS.json`, `QUEUE_PROJECTION.json`, and `OBSERVER_SAMPLE.json` are generated receipts. They are not live-hook evidence.

`LIVE_DRILL_RESULTS.json` preserves the earlier pre-reload result. The later active-runtime T01 receipt and nonce are recorded in `CONTROL.json` and `t01-runtime/`; they are the authoritative live Stop-hook proof for this resumed root session.

## Owner trust and loading boundary

1. In this exact root session, run `/hooks`.
2. Inspect the project source `/Users/mzm/Desktop/cairn/CairnNZ/.codex/hooks.json`, its command/hash, and the handler before explicitly trusting it.
3. Confirm `/hooks` reports the definition enabled, trusted, and loaded. Never use `--dangerously-bypass-hook-trust`.
4. If this new project-local hook cannot load into the already-running client, first keep the repository checkpointed and verify no other coordinator is active. Then exit only this client and run:

   ```sh
   cd /Users/mzm/Desktop/cairn/CairnNZ
   codex resume 01a0b4c1-b498-76e0-95bd-1976d11586f2
   ```

   Re-observe agents/processes, run `/hooks`, and explicitly trust/confirm the exact definition.
5. The next mode is `VERIFY_THEN_RUN`, not `RUN`: arm a disposable verification state and execute live T01 and T04 before resuming feature writing. The project Goal is also intentionally not created or changed during PREPARE_ONLY.

## Commands prepared, not activated

Regenerate the deterministic projection:

```sh
node docs/review/v1-closure/20260918T222838+0800/supervision/queue-adapter.mjs
```

Run deterministic preparation tests:

```sh
node docs/review/v1-closure/20260918T222838+0800/supervision/test-preparation.mjs
```

Take one read-only observer sample:

```sh
node docs/review/v1-closure/20260918T222838+0800/supervision/observer.mjs --once
```

An optional future foreground observer may use `--watch`; stop it with `Ctrl-C`. Do not install it as a LaunchAgent or cron job. PREPARE_ONLY leaves no observer running.
