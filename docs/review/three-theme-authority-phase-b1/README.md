# Three-theme authority — Phase B-1 evidence

All screenshots are real Expo Web runtime captures at 390×844 using production primitives and semantic theme values.

The JPG/PNG captures named below are reproducible local-only outputs and are
ignored by Git. Recreate them with `node app/scripts/three-theme-phase-b1-qa.mjs`;
tracked reports, inventories, and runtime-error text remain the durable
evidence.

- `three-theme-component-system-board.jpg`: controls, fields, sheets, and modals across Day / Sunset / Night.
- `surface-ladder-board.jpg`: page → record → elevated card → sheet/modal → active action.
- `production-regression-board.jpg`: matched before/after captures for Home, Friends, Trails, and Settings.
- `contrast-report.json`: computed foreground/background colors and WCAG contrast for representative rendered controls.
- `protected-screen-pixel-regression.json`: matched Auth/Home screenshot-difference metrics.
- `before/` and `after/`: exact 390×844 source captures.
- `runtime-errors-before.txt` and `runtime-errors-after.txt`: captured browser runtime errors.
- `CONSUMER_INVENTORY.md`: current production consumers and reachability classification.

The component lab is registered with lazy `getComponent` only inside `__DEV__`, also returns `null` outside development, and has no production eager import.
