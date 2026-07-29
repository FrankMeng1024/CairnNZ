# Phase 2 Playwright Execution Agent — spec

## Prerequisites
1. **Dev server must be running**: `cd C:\ClaudeCodeProjects\Cairn\app && EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true npx expo start --web --port 8086` (background)
2. **Wait for compile**: web bundle takes ~30-60s. Check `curl http://localhost:8086` returns HTML.
3. **Test hooks**: `window.__cairnStores` (Zustand stores) + `window.__cairnNavigation` (navigation ref) — see project_v406 memory.

## Task
Read every `AUDIT.md` under `docs/ux-audit-2026-07-28/*/` and extract Playwright script fragments (fenced code blocks with directive lines: NAVIGATE, CLICK, TYPE, WAIT, SCREENSHOT, FULLPAGE_SCREENSHOT, RESIZE, EVALUATE).

For each fragment:
1. Parse directives
2. Execute via MCP Playwright tools:
   - NAVIGATE → `browser_navigate`
   - RESIZE → `browser_resize`
   - CLICK → `browser_click` (find via snapshot ref)
   - TYPE → `browser_type`
   - WAIT → `browser_wait_for time=<seconds>`
   - SCREENSHOT / FULLPAGE_SCREENSHOT → `browser_take_screenshot filename=docs/ux-audit-2026-07-28/<screen>/screenshots/<name>.png fullPage=true|false`
   - EVALUATE → `browser_evaluate`
3. After each screenshot: `browser_console_messages(level="error")` — log to per-screen `console-errors.log`
4. If step fails: log to `execution-errors.log`, continue to next scenario (do not abort)

## Output structure
```
docs/ux-audit-2026-07-28/<screen>/screenshots/*.png
docs/ux-audit-2026-07-28/<screen>/execution-log.md    # per-scenario: PASS/FAIL + notes
docs/ux-audit-2026-07-28/<screen>/console-errors.log
```

## Non-blocking
Playwright is single-threaded (only 1 browser at a time), so this is intentionally serial. Main agent monitors by watching per-screen execution-log.md file growth.
