# Source identity

- Baseline O93 commit: `37e34ae885caed8c47edf4d5157b970dac1532e3`
- Baseline tree: `d6742d6bf6c449ff79073f0be6523adafe020621`
- Isolated implementation branch: `codex/o94-memory-ux`
- Isolated implementation commit: `885a3fc6a51c10a74c5c05ba390c0bbea479eac9`
- Main integration commit: `2948a33ce0397e4172c22a30bf4896c3ae1d074e`
- QA runner correction commit: `198d4197` (full SHA retained by Git history)
- Published O94 commit: `2577ecad2e643f26c8cace34862f9bb334043a1f`
- Published O94 tree: `e18e012910245b483e040811d90be1aa3f04fe4b`

The published commit was clean and on local `main`. Parallel visual, launch-audit, #21/#22 and other worktrees were inspected but not reset, merged, overwritten or included.

Product/runtime changes are restricted to Memory presentation, city camera target, Cairns control, shared current-location style, tests/QA runner and the one O93→O94 Home marker. Backend/API/database/native configuration were not changed.
